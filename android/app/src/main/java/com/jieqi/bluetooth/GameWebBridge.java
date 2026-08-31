package com.jieqi.bluetooth;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.Set;

/** Trusted-local-page bridge. It exposes transport only, never Android storage or arbitrary APIs. */
public final class GameWebBridge implements BluetoothGameSession.Listener {
  private final MainActivity activity;
  private final WebView webView;
  private final BluetoothAdapter adapter;
  private final BluetoothGameSession session;

  public GameWebBridge(MainActivity activity, WebView webView, BluetoothAdapter adapter) {
    this.activity = activity;
    this.webView = webView;
    this.adapter = adapter;
    this.session = adapter == null ? null : new BluetoothGameSession(adapter, this);
  }

  @JavascriptInterface
  public String status() {
    JSONObject value = new JSONObject();
    try {
      value.put("available", adapter != null);
      value.put("role", session == null ? "NONE" : session.getRole().name());
      value.put("state", session == null ? "ERROR" : session.getState().name());
    } catch (JSONException ignored) { }
    return value.toString();
  }

  /** Returns devices paired through Android's system UI. No nearby-device scan happens here. */
  @JavascriptInterface
  @SuppressLint("MissingPermission")
  public String pairedDevices() {
    JSONArray devices = new JSONArray();
    if (adapter == null || !activity.hasBluetoothPermission()) return devices.toString();
    Set<BluetoothDevice> bonded = adapter.getBondedDevices();
    for (BluetoothDevice device : bonded) {
      JSONObject item = new JSONObject();
      try {
        item.put("name", device.getName() == null ? "未命名设备" : device.getName());
        item.put("address", device.getAddress());
        devices.put(item);
      } catch (JSONException ignored) { }
    }
    return devices.toString();
  }

  @JavascriptInterface
  public void host() {
    if (!activity.ensureBluetoothPermission()) return;
    if (session == null) { emitError("此设备不支持蓝牙"); return; }
    session.host();
  }

  @JavascriptInterface
  public void join(String address) {
    if (!activity.ensureBluetoothPermission()) return;
    if (session == null) { emitError("此设备不支持蓝牙"); return; }
    session.join(address);
  }

  @JavascriptInterface
  public void send(String rawMessage) {
    if (session == null) { emitError("此设备不支持蓝牙"); return; }
    try {
      session.send(new JSONObject(rawMessage));
    } catch (JSONException | IOException error) {
      emitError(error.getMessage() == null ? "发送联机消息失败" : error.getMessage());
    }
  }

  @JavascriptInterface
  public void disconnect() {
    if (session != null) session.disconnect();
  }

  void onPermissionResult(boolean granted) {
    JSONObject event = new JSONObject();
    try { event.put("type", granted ? "permission-granted" : "permission-denied"); } catch (JSONException ignored) { }
    emit(event);
  }

  @Override
  public void onStateChanged(BluetoothGameSession.Role role, BluetoothGameSession.State state, String detail) {
    JSONObject event = new JSONObject();
    try {
      event.put("type", "transport-state");
      event.put("role", role.name());
      event.put("state", state.name());
      event.put("detail", detail);
    } catch (JSONException ignored) { }
    emit(event);
  }

  @Override
  public void onMessage(JSONObject message) {
    JSONObject event = new JSONObject();
    try { event.put("type", "message"); event.put("message", message); } catch (JSONException ignored) { }
    emit(event);
  }

  private void emitError(String detail) {
    JSONObject event = new JSONObject();
    try { event.put("type", "transport-error"); event.put("detail", detail); } catch (JSONException ignored) { }
    emit(event);
  }

  private void emit(JSONObject event) {
    final String payload = event.toString();
    activity.runOnUiThread(() -> webView.evaluateJavascript(
      "window.dispatchEvent(new CustomEvent('jieqi-bluetooth', {detail:JSON.parse(" + JSONObject.quote(payload) + ")}));",
      null
    ));
  }

  public void close() {
    if (session != null) session.close();
  }
}
