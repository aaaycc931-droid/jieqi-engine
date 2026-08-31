package com.jieqi.bluetooth;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * One Bluetooth Classic RFCOMM channel for one face-to-face game room.
 *
 * <p>This layer intentionally transports only versioned JSON messages. Game-rule
 * validation remains in the host WebView/TypeScript engine; the guest can only
 * request an action and never receives the host's private state.</p>
 */
public final class BluetoothGameSession implements Closeable {
  public static final int PROTOCOL_VERSION = 1;
  public static final int MAX_MESSAGE_BYTES = 48 * 1024;
  private static final String SERVICE_NAME = "Jieqi Bluetooth Room";
  private static final UUID SERVICE_UUID = UUID.fromString("b13eb75c-31ac-4630-8af1-79e0221fd7e2");

  public enum Role { NONE, HOST, GUEST }
  public enum State { IDLE, LISTENING, CONNECTING, CONNECTED, DISCONNECTED, ERROR }

  public interface Listener {
    void onStateChanged(Role role, State state, String detail);
    void onMessage(JSONObject message);
  }

  private final BluetoothAdapter adapter;
  private final Listener listener;
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final Object writeLock = new Object();

  private BluetoothServerSocket serverSocket;
  private BluetoothSocket socket;
  private BufferedWriter writer;
  private volatile boolean closed;
  private volatile Role role = Role.NONE;
  private volatile State state = State.IDLE;

  public BluetoothGameSession(BluetoothAdapter adapter, Listener listener) {
    this.adapter = adapter;
    this.listener = listener;
  }

  public Role getRole() { return role; }
  public State getState() { return state; }

  /** Ends the current room but keeps the transport reusable for a new room. */
  public synchronized void disconnect() {
    resetConnection();
    emit(State.DISCONNECTED, "已离开蓝牙房间");
  }

  @SuppressLint("MissingPermission")
  public synchronized void host() {
    resetConnection();
    closed = false;
    role = Role.HOST;
    emit(State.LISTENING, "正在等待另一台手机加入");
    io.execute(() -> {
      try {
        serverSocket = adapter.listenUsingRfcommWithServiceRecord(SERVICE_NAME, SERVICE_UUID);
        BluetoothSocket accepted = serverSocket.accept();
        closeServerSocket();
        attach(accepted, "对方已加入房间");
      } catch (IOException error) {
        if (!closed) fail("创建或等待房间失败：" + safeMessage(error));
      }
    });
  }

  @SuppressLint("MissingPermission")
  public synchronized void join(String address) {
    resetConnection();
    closed = false;
    role = Role.GUEST;
    emit(State.CONNECTING, "正在连接房主");
    io.execute(() -> {
      try {
        BluetoothDevice device = adapter.getRemoteDevice(address);
        adapter.cancelDiscovery();
        BluetoothSocket candidate = device.createRfcommSocketToServiceRecord(SERVICE_UUID);
        candidate.connect();
        attach(candidate, "已连接房主");
      } catch (IllegalArgumentException error) {
        fail("蓝牙设备地址无效");
      } catch (IOException error) {
        if (!closed) fail("连接失败：" + safeMessage(error));
      }
    });
  }

  /** Sends one newline-delimited protocol envelope. May be called from the UI thread. */
  public void send(JSONObject message) throws IOException, JSONException {
    validateEnvelope(message);
    byte[] encoded = message.toString().getBytes(StandardCharsets.UTF_8);
    if (encoded.length > MAX_MESSAGE_BYTES) throw new IOException("消息超过大小上限");
    synchronized (writeLock) {
      if (writer == null || state != State.CONNECTED) throw new IOException("蓝牙房间尚未连接");
      writer.write(message.toString());
      writer.newLine();
      writer.flush();
    }
  }

  private void attach(BluetoothSocket connected, String detail) throws IOException {
    synchronized (this) {
      if (closed) {
        connected.close();
        return;
      }
      socket = connected;
      writer = new BufferedWriter(new OutputStreamWriter(connected.getOutputStream(), StandardCharsets.UTF_8));
    }
    emit(State.CONNECTED, detail);
    readLoop(connected);
  }

  private void readLoop(BluetoothSocket connected) {
    try (BufferedReader reader = new BufferedReader(new InputStreamReader(connected.getInputStream(), StandardCharsets.UTF_8))) {
      String line;
      while (!closed && (line = reader.readLine()) != null) {
        if (line.getBytes(StandardCharsets.UTF_8).length > MAX_MESSAGE_BYTES) {
          fail("收到超过大小上限的消息");
          return;
        }
        try {
          JSONObject message = new JSONObject(line);
          validateEnvelope(message);
          mainHandler.post(() -> listener.onMessage(message));
        } catch (JSONException error) {
          fail("收到无效联机消息");
          return;
        }
      }
      if (!closed) emit(State.DISCONNECTED, "对方已断开连接");
    } catch (IOException error) {
      if (!closed) emit(State.DISCONNECTED, "蓝牙连接已断开");
    } finally {
      synchronized (this) { closeSocket(); }
    }
  }

  private static void validateEnvelope(JSONObject message) throws JSONException {
    if (message.optInt("v", -1) != PROTOCOL_VERSION) throw new JSONException("协议版本不匹配");
    String type = message.optString("type", "");
    if (!("hello".equals(type) || "action".equals(type) || "snapshot".equals(type)
      || "error".equals(type) || "ping".equals(type) || "pong".equals(type))) {
      throw new JSONException("未知消息类型");
    }
  }

  private synchronized void resetConnection() {
    closed = true;
    closeServerSocket();
    closeSocket();
    writer = null;
    role = Role.NONE;
    state = State.IDLE;
  }

  private void closeServerSocket() {
    if (serverSocket == null) return;
    try { serverSocket.close(); } catch (IOException ignored) { }
    serverSocket = null;
  }

  private void closeSocket() {
    if (socket == null) return;
    try { socket.close(); } catch (IOException ignored) { }
    socket = null;
    writer = null;
  }

  private void emit(State next, String detail) {
    state = next;
    mainHandler.post(() -> listener.onStateChanged(role, next, detail));
  }

  private void fail(String detail) {
    emit(State.ERROR, detail);
    synchronized (this) { closeServerSocket(); closeSocket(); }
  }

  private static String safeMessage(Exception error) {
    String message = error.getMessage();
    return message == null || message.trim().isEmpty() ? "系统蓝牙错误" : message;
  }

  @Override
  public synchronized void close() {
    resetConnection();
    io.shutdownNow();
  }
}
