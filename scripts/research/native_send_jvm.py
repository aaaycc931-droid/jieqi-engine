"""Compile full production native classes with explicit offline Android/JSON shims.

The shims only support the exercised methods. This is neither Android framework
conformance nor radio/JNI evidence. No generated classes are committed.
"""
from pathlib import Path
import json,subprocess,tempfile,hashlib,argparse

ROOT=Path(__file__).resolve().parents[2]
SHIMS={
'android/annotation/SuppressLint.java':'package android.annotation; public @interface SuppressLint { String[] value(); }',
'android/webkit/JavascriptInterface.java':'package android.webkit; public @interface JavascriptInterface {}',
'android/webkit/WebView.java':'package android.webkit; public class WebView { public java.util.List<String> events=new java.util.ArrayList<>(); public void evaluateJavascript(String s,Object c){events.add(s);} }',
'android/content/Intent.java':'package android.content; public class Intent { public static final String ACTION_APPLICATION_DETAILS_SETTINGS="settings"; public Intent(String s){} public Intent setData(android.net.Uri u){return this;} }',
'android/net/Uri.java':'package android.net; public class Uri { public static Uri parse(String s){return new Uri();} }',
'android/provider/Settings.java':'package android.provider; public class Settings { public static final String ACTION_BLUETOOTH_SETTINGS="bluetooth", ACTION_APPLICATION_DETAILS_SETTINGS="app-settings"; }',
'android/os/Looper.java':'package android.os; public class Looper { public static Looper getMainLooper(){return new Looper();} }',
'android/os/Handler.java':'package android.os; public class Handler { public static java.util.List<Runnable> queue=new java.util.ArrayList<>(); public Handler(Looper l){} public boolean post(Runnable r){queue.add(r);return true;} public boolean postDelayed(Runnable r,long d){return true;} }',
'android/bluetooth/BluetoothAdapter.java':'''package android.bluetooth; public class BluetoothAdapter {
public boolean isEnabled(){return true;} public String getName(){return "offline";} public boolean cancelDiscovery(){return true;}
public java.util.Set<BluetoothDevice> getBondedDevices(){return java.util.Set.of();} public BluetoothDevice getRemoteDevice(String a){return new BluetoothDevice();}
public BluetoothServerSocket listenUsingRfcommWithServiceRecord(String s,java.util.UUID u) throws java.io.IOException{return new BluetoothServerSocket();}}''',
'android/bluetooth/BluetoothDevice.java':'''package android.bluetooth; public class BluetoothDevice { public String getName(){return "offline";} public String getAddress(){return "offline";}
public BluetoothSocket createRfcommSocketToServiceRecord(java.util.UUID u) throws java.io.IOException{return new BluetoothSocket();}}''',
'android/bluetooth/BluetoothServerSocket.java':'package android.bluetooth; public class BluetoothServerSocket { public BluetoothSocket accept() throws java.io.IOException{return new BluetoothSocket();} public void close() throws java.io.IOException{} }',
'android/bluetooth/BluetoothSocket.java':'''package android.bluetooth; public class BluetoothSocket { public boolean closed; public void connect() throws java.io.IOException{}
public java.io.InputStream getInputStream() throws java.io.IOException{return new java.io.ByteArrayInputStream(new byte[0]);}
public java.io.OutputStream getOutputStream() throws java.io.IOException{return new java.io.ByteArrayOutputStream();} public void close() throws java.io.IOException{closed=true;} }''',
'org/json/JSONException.java':'package org.json; public class JSONException extends Exception { public JSONException(String s){super(s);} }',
'org/json/JSONArray.java':'package org.json; public class JSONArray { public java.util.List<Object> values=new java.util.ArrayList<>(); public JSONArray put(Object o){values.add(o);return this;} public String toString(){java.util.StringJoiner j=new java.util.StringJoiner(",","[","]");for(Object o:values)j.add(o instanceof String?JSONObject.quote((String)o):o.toString());return j.toString();} }',
'org/json/JSONObject.java':r'''package org.json;
import java.util.*;import java.util.regex.*;
/** Narrow test substitute. It preserves supplied valid fixture bytes and only
 * extracts the exercised envelope header keys; not a general JSON parser. */
public class JSONObject {
 private String raw;private Map<String,Object> values=new LinkedHashMap<>();
 public JSONObject(){}
 public JSONObject(String s)throws JSONException{if(s==null||!s.trim().startsWith("{")||!s.trim().endsWith("}"))throw new JSONException("invalid fixture JSON");raw=s;}
 public JSONObject put(String k,Object v)throws JSONException{raw=null;values.put(k,v);return this;}
 private String field(String k){if(raw==null)return String.valueOf(values.get(k));Matcher m=Pattern.compile("\\\""+k+"\\\"\\s*:\\s*(?:\\\"([^\\\"]*)\\\"|([0-9]+))").matcher(raw);return m.find()?(m.group(1)!=null?m.group(1):m.group(2)):null;}
 public int optInt(String k,int d){try{return Integer.parseInt(field(k));}catch(Exception e){return d;}}
 public String optString(String k,String d){String s=field(k);return s==null?d:s;}
 public static String quote(String s){if(s==null)return "\"\"";return "\""+s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n").replace("\r","\\r").replace("\t","\\t")+"\"";}
 public String toString(){if(raw!=null)return raw;StringJoiner j=new StringJoiner(",","{","}");for(var e:values.entrySet()){Object v=e.getValue();j.add(quote(e.getKey())+":"+(v==null?"null":v instanceof String?quote((String)v):v.toString()));}return j.toString();}
}''',
'com/jieqi/bluetooth/MainActivity.java':'''package com.jieqi.bluetooth; public class MainActivity {
 public java.util.List<Runnable> queue=new java.util.ArrayList<>(); public boolean hasBluetoothPermission(){return true;} public boolean ensureBluetoothPermission(){return true;}
 public boolean canRequestBluetoothPermissionAgain(){return true;} public String getPackageName(){return "offline";} public void startActivity(android.content.Intent i){} public void runOnUiThread(Runnable r){queue.add(r);}
}''',
'com/jieqi/bluetooth/NativeSendProbe.java':r'''package com.jieqi.bluetooth;
import java.io.*;import java.lang.reflect.*;import org.json.*;import android.bluetooth.*;import android.webkit.*;
public class NativeSendProbe {
 static Field field(String n)throws Exception{Field f=BluetoothGameSession.class.getDeclaredField(n);f.setAccessible(true);return f;}
 static String checked(GameWebBridge bridge,String raw)throws Exception{try{return (String)GameWebBridge.class.getMethod("sendChecked",String.class).invoke(bridge,raw);}catch(NoSuchMethodException e){bridge.send(raw);return null;}}
 static class RecordingWriter extends BufferedWriter {
  String mode;StringBuilder bytes=new StringBuilder();int calls,flushes;BluetoothGameSession session;RecordingWriter replacement;
  RecordingWriter(String m){super(new StringWriter());mode=m;}
  @Override public void write(String s,int off,int len)throws IOException{calls++;if(calls==1&&mode.equals("write_zero"))throw new IOException("injected before bytes");
   if(calls==1&&mode.equals("partial")){bytes.append(s,off,off+Math.min(7,len));throw new IOException("injected partial");}
   if(mode.equals("old_writer")){try{replacement=new RecordingWriter("success");field("writer").set(session,replacement);field("socket").set(session,new BluetoothSocket());}catch(Exception e){throw new IOException(e);}throw new IOException("injected old writer");}
   bytes.append(s,off,off+len);}
  @Override public void newLine()throws IOException{if(calls==1&&mode.equals("newline"))throw new IOException("injected newline");bytes.append('\n');}
  @Override public void flush()throws IOException{flushes++;if(calls==1&&mode.equals("flush"))throw new IOException("injected flush after complete frame");}
 }
 public static void main(String[] args)throws Exception{
  String mode=args[0],raw=new String(System.in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);MainActivity activity=new MainActivity();WebView web=new WebView();
  GameWebBridge bridge=new GameWebBridge(activity,web,mode.equals("no_session")?null:new BluetoothAdapter());
  Field sf=GameWebBridge.class.getDeclaredField("session");sf.setAccessible(true);BluetoothGameSession session=(BluetoothGameSession)sf.get(bridge);
  RecordingWriter writer=new RecordingWriter(mode);BluetoothSocket socket=new BluetoothSocket();
  if(session!=null){writer.session=session;field("writer").set(session,writer);field("socket").set(session,socket);field("state").set(session,mode.equals("not_connected")?BluetoothGameSession.State.DISCONNECTED:BluetoothGameSession.State.CONNECTED);}
  String result=null;if(mode.equals("legacy_failure")){writer.mode="partial";bridge.send(raw);}else result=checked(bridge,raw);
  int queuedBeforeDrain=android.os.Handler.queue.size()+activity.queue.size();String second=null;
  if(session!=null&&(mode.equals("write_zero")||mode.equals("partial")||mode.equals("newline")||mode.equals("flush")))second=checked(bridge,"{\"v\":2,\"type\":\"ping\",\"id\":\"recorded:1\"}");
  while(!android.os.Handler.queue.isEmpty())android.os.Handler.queue.remove(0).run();while(!activity.queue.isEmpty())activity.queue.remove(0).run();
  JSONArray callbacks=new JSONArray();for(String script:web.events)callbacks.put(script);
  JSONObject out=new JSONObject().put("result",result).put("wire",writer.bytes.toString()).put("writeCalls",writer.calls).put("flushCalls",writer.flushes).put("callbacks",callbacks)
   .put("state",session==null?"NO_SESSION":session.getState().name()).put("writerCleared",session!=null&&field("writer").get(session)==null).put("socketClosed",socket.closed)
   .put("replacementPreserved",session!=null&&writer.replacement!=null&&field("writer").get(session)==writer.replacement).put("queuedCallbacksBeforeDrain",queuedBeforeDrain)
   .put("callbacksAfterDrain",web.events.size()).put("secondResult",second);
  if(session!=null)session.close();System.out.print(out);
 }
}'''
}

def compile_probe(directory:Path,source_root=ROOT):
 for p,s in SHIMS.items():
  f=directory/p;f.parent.mkdir(parents=True,exist_ok=True);f.write_text(s+'\n')
 native=source_root/'android/app/src/main/java/com/jieqi/bluetooth'
 for name in ['BluetoothGameSession.java','GameWebBridge.java']:(directory/'com/jieqi/bluetooth'/name).write_bytes((native/name).read_bytes())
 sources=sorted(str(p) for p in directory.rglob('*.java'))
 cmd=['java','-m','jdk.compiler/com.sun.tools.javac.Main','-encoding','UTF-8','-d',str(directory/'classes'),*sources]
 r=subprocess.run(cmd,capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr)

def probe(directory:Path,mode:str,raw:str):
 r=subprocess.run(['java','-cp',str(directory/'classes'),'com.jieqi.bluetooth.NativeSendProbe',mode],input=raw,capture_output=True,text=True,timeout=15)
 if r.returncode:raise RuntimeError(r.stderr)
 return json.loads(r.stdout)

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output');parser.add_argument('--parent-source-root');args=parser.parse_args()
 raw='{"v":2,"type":"action","id":"recorded:1","payload":{"kind":"hero","hero":"shuffler"}}'
 with tempfile.TemporaryDirectory(prefix='lezi-native-send-')as tmp:
  directory=Path(tmp);compile_probe(directory);rows=[]
  modes=['success','no_session','not_connected','bad_json','bad_version','oversize','write_zero','partial','newline','flush','old_writer','legacy_failure']
  for mode in modes:
   actual=raw
   if mode=='bad_json':actual='not-json'
   if mode=='bad_version':actual=raw.replace('"v":2','"v":99')
   if mode=='oversize':actual=json.dumps({'v':2,'type':'action','payload':'x'*50000})
   row=probe(directory,mode,actual);status=json.loads(row['result'])['status']if row['result'] else 'legacy_void'
   expected='written'if mode=='success'else 'not_sent'if mode in ['no_session','not_connected','bad_json','bad_version','oversize']else 'legacy_void'if mode=='legacy_failure'else 'unknown'
   assert status==expected,(mode,row)
   if mode in ['write_zero','partial','newline','flush']:
    assert row['writerCleared']and row['socketClosed']and row['state']=='DISCONNECTED',row
    assert json.loads(row['secondResult'])['status']=='not_sent'and row['writeCalls']==1,row
   if mode=='old_writer':assert row['replacementPreserved']and row['state']=='CONNECTED'and not row['socketClosed'],row
   if mode=='success':assert row['wire']==raw+'\n'and row['flushCalls']==1 and row['queuedCallbacksBeforeDrain']==0,row
   if mode=='legacy_failure':assert row['result'] is None and row['queuedCallbacksBeforeDrain']>0,row
   rows.append({'mode':mode,'status':status,'actual':row,'inputSha256':hashlib.sha256(actual.encode()).hexdigest()})
  ping='{"v":2,"type":"ping","id":"recorded:1"}';ping_rows=[]
  for mode in ['success','write_zero','flush','not_connected']:
   row=probe(directory,mode,ping);status=json.loads(row['result'])['status'];expected='written'if mode=='success'else 'not_sent'if mode=='not_connected'else 'unknown';assert status==expected
   ping_rows.append({'mode':mode,'status':status,'actual':row,'inputSha256':hashlib.sha256(ping.encode()).hexdigest()})
 parent_rows=[]
 if args.parent_source_root:
  with tempfile.TemporaryDirectory(prefix='lezi-parent-native-')as tmp:
   directory=Path(tmp);compile_probe(directory,Path(args.parent_source_root))
   for mode in ['write_zero','partial','flush']:
    row=probe(directory,mode,raw);assert row['result']is None and not row['writerCleared']and row['writeCalls']==2,row
    parent_rows.append({'mode':mode,'actual':row,'interpretation':'explicit writer fault injection in actual parent classes; void result, later ping attempted without quarantine'})
 result={'schema':'lezi.native_send.jvm_probe.v1','production_classes':['BluetoothGameSession','GameWebBridge'],'cases':rows,'ping_cases':ping_rows,'passed':len(rows)+len(ping_rows),'failed':0,'parent_native_fault_controls':parent_rows,
  'environment':'OpenJDK17 full production classes; Android/org.json/UI/writer explicit shims; no Android SDK/JNI/radio/device',
  'source_sha256':{n:hashlib.sha256((ROOT/'android/app/src/main/java/com/jieqi/bluetooth'/n).read_bytes()).hexdigest()for n in ['BluetoothGameSession.java','GameWebBridge.java']},
  'shim_sha256':hashlib.sha256(json.dumps(SHIMS,sort_keys=True).encode()).hexdigest(),'rawAuthorityPublished':False}
 if args.output:Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'passed':len(rows)+len(ping_rows),'parent_fault_controls':len(parent_rows),'failed':0}))

if __name__=='__main__':main()
