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
  public static final int PROTOCOL_VERSION = 2;
  public static final int MAX_MESSAGE_BYTES = 48 * 1024;
  private static final String SERVICE_NAME = "Jieqi Bluetooth Room";
  private static final UUID SERVICE_UUID = UUID.fromString("b13eb75c-31ac-4630-8af1-79e0221fd7e2");

  public enum Role { NONE, HOST, GUEST }
  public enum State { IDLE, LISTENING, CONNECTING, CONNECTED, DISCONNECTED, ERROR }

  public interface Listener {
    void onStateChanged(Role role, State state, String detail);
    void onMessage(JSONObject message);
  }


  public interface GenerationListener extends Listener {
    void onStateChanged(Context context, Role role, State state, String detail);
    void onMessage(Context context, JSONObject message);
  }
  public static final class Context {
    public final String instance, generation, sequence;
    public final Role role;
    Context(String i, String g, String s, Role r) { instance=i; generation=g; sequence=s; role=r; }
    public JSONObject json() throws JSONException { return new JSONObject().put("instance",instance).put("generation",generation).put("sequence",sequence).put("role",role.name()); }
  }
  // Every resource belongs to one attempt, including a socket still connecting.
  // Ownership mutations use the session monitor. Connect/accept/read/write waits
  // run outside it; resource close retains the existing monitor semantics.
  private static final class Attempt {
    final String generation; final Role role; final String address;
    BluetoothSocket socket; BluetoothServerSocket server; BufferedWriter writer;
    boolean reconnectScheduled;
    Attempt(String g,Role r,String a){generation=g;role=r;address=a;}
  }
  private final BluetoothAdapter adapter;
  private final Listener listener;
  private final ExecutorService io=Executors.newSingleThreadExecutor();
  private final Handler mainHandler=new Handler(Looper.getMainLooper());
  private final Object writeLock=new Object();
  private final String instance=UUID.randomUUID().toString();
  private java.math.BigInteger generation=java.math.BigInteger.ZERO, sequence=java.math.BigInteger.ZERO;
  private Attempt current=new Attempt("0",Role.NONE,null);
  private boolean closed, autoReconnect, everConnected, disposed;
  private volatile State state=State.IDLE;
  public BluetoothGameSession(BluetoothAdapter a,Listener l){adapter=a;listener=l;}
  public synchronized Role getRole(){return current.role;}
  public State getState(){return state;}
  private Context context(Attempt a){return new Context(instance,a.generation,sequence.toString(),a.role);}
  public synchronized Context localContext(){return context(current);}
  private boolean owns(Attempt a){return current==a&&!closed&&!disposed;}
  private void closeSocket(Attempt a){if(a.socket!=null)try{a.socket.close();}catch(IOException ignored){}a.socket=null;a.writer=null;}
  private void closeServer(Attempt a){if(a.server!=null)try{a.server.close();}catch(IOException ignored){}a.server=null;}
  private Attempt replace(Role role,String address){closeServer(current);closeSocket(current);generation=generation.add(java.math.BigInteger.ONE);current=new Attempt(generation.toString(),role,address);return current;}
  public synchronized void disconnect(){autoReconnect=false;closed=true;everConnected=false;Attempt a=replace(Role.NONE,null);emit(a,State.DISCONNECTED,"已离开蓝牙房间");}
  public synchronized void host(){if(disposed)return;autoReconnect=true;everConnected=false;start(Role.HOST,null,false);}
  public synchronized void join(String address){if(disposed)return;autoReconnect=true;everConnected=false;start(Role.GUEST,address,false);}
  public synchronized void reconnect(){if(current.role!=Role.NONE&&!disposed){autoReconnect=true;scheduleReconnect(current);}}
  private synchronized void start(Role role,String address,boolean reconnecting){
    Attempt a=replace(role,address);closed=false;
    emit(a,role==Role.HOST?State.LISTENING:State.CONNECTING,role==Role.HOST?(reconnecting?"正在自动等待对方重新连接":"正在等待另一台手机加入"):(reconnecting?"正在自动重新连接房主":"正在连接房主"));
    io.execute(()->connect(a,reconnecting));
  }
  @SuppressLint("MissingPermission")
  private void connect(Attempt a,boolean reconnecting){
    BluetoothSocket candidate=null;BluetoothServerSocket server=null;
    try{
      synchronized(this){if(!owns(a))return;}
      if(a.role==Role.HOST){
        server=adapter.listenUsingRfcommWithServiceRecord(SERVICE_NAME,SERVICE_UUID);
        synchronized(this){if(!owns(a)){server.close();return;}a.server=server;}
        candidate=server.accept();
        synchronized(this){closeServer(a);}
      }else{
        BluetoothDevice device=adapter.getRemoteDevice(a.address);adapter.cancelDiscovery();
        candidate=device.createRfcommSocketToServiceRecord(SERVICE_UUID);
        synchronized(this){if(!owns(a)){candidate.close();return;}a.socket=candidate;}
        candidate.connect();
      }
      attach(a,candidate,reconnecting?"连接已恢复":a.role==Role.HOST?"对方已加入房间":"已连接房主");
    }catch(IllegalArgumentException error){failure(a,"蓝牙设备地址无效",true);}
     catch(SecurityException error){failure(a,"蓝牙权限已失效，请在系统设置重新允许",false);}
     catch(IOException error){failure(a,"蓝牙连接失败："+safeMessage(error),true);}
    finally{synchronized(this){closeServer(a);if(candidate!=null&&a.socket==candidate)closeSocket(a);else if(candidate!=null)try{candidate.close();}catch(IOException ignored){}}}
  }
  private void attach(Attempt a,BluetoothSocket connected,String detail)throws IOException{
    synchronized(this){if(!owns(a)){connected.close();return;}a.socket=connected;a.writer=new BufferedWriter(new OutputStreamWriter(connected.getOutputStream(),StandardCharsets.UTF_8));everConnected=true;emit(a,State.CONNECTED,detail);}
    readLoop(a,connected);
  }
  private void readLoop(Attempt a,BluetoothSocket connected){
    try(BufferedReader reader=new BufferedReader(new InputStreamReader(connected.getInputStream(),StandardCharsets.UTF_8))){
      String line;
      while(true){synchronized(this){if(!owns(a))return;}
        line=reader.readLine();if(line==null)break;
        synchronized(this){if(!owns(a))return;
          if(line.getBytes(StandardCharsets.UTF_8).length>MAX_MESSAGE_BYTES){failure(a,"收到超过大小上限的消息",false);return;}
          try{JSONObject message=new JSONObject(line);validateEnvelope(message);Context c=eventContext(a);
            mainHandler.post(()->{if(listener instanceof GenerationListener)((GenerationListener)listener).onMessage(c,message);else listener.onMessage(message);});
          }catch(JSONException error){failure(a,"收到无效联机消息",false);return;}
        }
      }
      failure(a,"对方已断开连接",true);
    }catch(IOException error){failure(a,"蓝牙连接已断开",true);}
    finally{synchronized(this){if(a.socket==connected)closeSocket(a);}}
  }
  private synchronized void failure(Attempt a,String detail,boolean recover){
    if(!owns(a))return;
    emit(a,recover&&everConnected?State.DISCONNECTED:State.ERROR,detail);closeSocket(a);closeServer(a);
    if(recover&&everConnected)scheduleReconnect(a);
  }
  private synchronized void scheduleReconnect(Attempt a){
    if(!owns(a)||!autoReconnect||a.role==Role.NONE||a.reconnectScheduled||state==State.CONNECTED)return;
    a.reconnectScheduled=true;
    mainHandler.postDelayed(()->{synchronized(this){
      if(!owns(a))return;a.reconnectScheduled=false;
      if(!autoReconnect||state==State.CONNECTED)return;
      try{if(!adapter.isEnabled()){emit(a,State.DISCONNECTED,"请开启蓝牙");scheduleReconnect(a);return;}}
      catch(SecurityException error){autoReconnect=false;failure(a,"蓝牙权限已失效",false);return;}
      start(a.role,a.address,true);
    }},1000);
  }
  // Capture once when producing the event. Neither Handler nor WebView delivery
  // is allowed to substitute the later current role/generation for this origin.
  private Context eventContext(Attempt a){sequence=sequence.add(java.math.BigInteger.ONE);return context(a);}
  private void emit(Attempt a,State next,String detail){state=next;Context c=eventContext(a);
    mainHandler.post(()->{if(listener instanceof GenerationListener)((GenerationListener)listener).onStateChanged(c,c.role,next,detail);else listener.onStateChanged(c.role,next,detail);});
  }
  public static final class SendFailure extends IOException{
    public final boolean writeAttempted;public final Context attemptedContext;
    SendFailure(String detail,boolean attempted,Context c,IOException cause){super(detail,cause);writeAttempted=attempted;attemptedContext=c;}
  }
  public void send(JSONObject message)throws IOException,JSONException{sendBound(message,null,null,false);}
  public Context sendScoped(JSONObject message,String expectedInstance,String expectedGeneration)throws IOException,JSONException{return sendBound(message,expectedInstance,expectedGeneration,true);}
  // writeLock serializes sends, not lifecycle replacement. The session monitor
  // atomically compares the expected context and captures this exact writer.
  private Context sendBound(JSONObject message,String expectedInstance,String expectedGeneration,boolean scoped)throws IOException,JSONException{
    validateEnvelope(message);String raw=message.toString();
    if(raw.getBytes(StandardCharsets.UTF_8).length>MAX_MESSAGE_BYTES)throw new SendFailure("消息超过大小上限",false,null,null);
    synchronized(writeLock){
      final Attempt a;final BufferedWriter output;final Context captured;
      synchronized(this){a=current;
        if(!owns(a)||state!=State.CONNECTED||a.writer==null||(scoped&&(!instance.equals(expectedInstance)||!a.generation.equals(expectedGeneration))))throw new SendFailure("连接上下文不匹配或未连接",false,null,null);
        output=a.writer;captured=context(a);
      }
      try{output.write(raw);output.newLine();output.flush();return captured;}
      catch(IOException error){synchronized(this){if(owns(a)&&a.writer==output){closeSocket(a);emit(a,State.DISCONNECTED,"发送结果未知，连接正在恢复");scheduleReconnect(a);}}
        throw new SendFailure(safeMessage(error),true,captured,error);
      }
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

  private static String safeMessage(Exception e){return e.getMessage()==null||e.getMessage().trim().isEmpty()?"系统蓝牙错误":e.getMessage();}
  @Override public synchronized void close(){if(disposed)return;autoReconnect=false;closed=true;replace(Role.NONE,null);disposed=true;state=State.IDLE;io.shutdownNow();}
}
