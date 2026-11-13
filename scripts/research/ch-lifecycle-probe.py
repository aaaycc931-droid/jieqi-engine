"""Bounded production receive/lock probes. No production source edits or radio.

Reuse PR22's explicitly narrow JSON/UI shims; replace transport and scheduling
shims with controllable streams and FIFO queues. JDK readers/writers/executor
are real. Each case runs in a separate JVM. No reflection is used.
"""
from pathlib import Path
import importlib.util, json, subprocess, tempfile, hashlib

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('base', ROOT/'scripts/research/native_send_jvm.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
SHIMS = dict(base.SHIMS)
SHIMS.pop('com/jieqi/bluetooth/NativeSendProbe.java')
SHIMS.update({
'probe/Trace.java': '''package probe;
import java.util.*; import java.util.concurrent.*;
public class Trace {
 public static final List<String> events=Collections.synchronizedList(new ArrayList<>());
 public static void log(String s){events.add(Thread.currentThread().getName()+":"+s);}
 public static void waitFor(CountDownLatch l)throws Exception{if(!l.await(5,TimeUnit.SECONDS))throw new AssertionError("latch timeout");}
}''',
'android/os/Handler.java': '''package android.os;
import java.util.concurrent.*;import probe.Trace;
public class Handler {
 public static final BlockingQueue<Runnable> queue=new LinkedBlockingQueue<>(), delayed=new LinkedBlockingQueue<>();
 public Handler(Looper l){}
 public boolean post(Runnable r){Trace.log("post:"+r.getClass().getName());queue.add(r);return true;}
 public boolean postDelayed(Runnable r,long d){Trace.log("delay:"+d);delayed.add(r);return true;}
 public static void drain(){Runnable r;while((r=queue.poll())!=null){Trace.log("execute:"+r.getClass().getName());r.run();}}
 public static void advanceDelay()throws Exception{Runnable r=delayed.poll(5,TimeUnit.SECONDS);if(r==null)throw new AssertionError("no delayed task");Trace.log("virtual-time:+1000");r.run();}
}''',
'android/bluetooth/BluetoothAdapter.java': '''package android.bluetooth;
import java.util.*;import java.util.concurrent.*;
public class BluetoothAdapter {
 public static final BlockingQueue<BluetoothSocket> sockets=new LinkedBlockingQueue<>();
 public boolean isEnabled(){return true;}public String getName(){return "offline";}public boolean cancelDiscovery(){return true;}
 public Set<BluetoothDevice> getBondedDevices(){return Set.of();}public BluetoothDevice getRemoteDevice(String a){return new BluetoothDevice();}
 public BluetoothServerSocket listenUsingRfcommWithServiceRecord(String s,UUID u){return new BluetoothServerSocket();}
 static BluetoothSocket next()throws java.io.IOException{try{BluetoothSocket s=sockets.poll(5,TimeUnit.SECONDS);if(s==null)throw new java.io.IOException("no fixture socket");return s;}catch(InterruptedException e){throw new java.io.IOException(e);}}
}''',
'android/bluetooth/BluetoothDevice.java': '''package android.bluetooth;
public class BluetoothDevice {public String getName(){return "offline";}public String getAddress(){return "offline";}
 public BluetoothSocket createRfcommSocketToServiceRecord(java.util.UUID u)throws java.io.IOException{return BluetoothAdapter.next();}}''',
'android/bluetooth/BluetoothServerSocket.java': '''package android.bluetooth;
public class BluetoothServerSocket {public BluetoothSocket accept()throws java.io.IOException{return BluetoothAdapter.next();}public void close()throws java.io.IOException{}}''',
'android/bluetooth/BluetoothSocket.java': '''package android.bluetooth;
import java.io.*;import java.util.concurrent.*;import probe.Trace;
public class BluetoothSocket {
 public final String name;public final InputStream input;public final OutputStream output;public volatile boolean closed;
 public BluetoothSocket(String n,InputStream i,OutputStream o){name=n;input=i;output=o;}
 public void connect(){Trace.log(name+":connect");}
 public InputStream getInputStream(){Trace.log(name+":readLoop-entry");return input;}
 public OutputStream getOutputStream(){Trace.log(name+":writer-install");return output;}
 public void close()throws IOException{if(!closed){closed=true;Trace.log(name+":socket-close");input.close();}}
}''',
'com/jieqi/bluetooth/LifecycleProbe.java': r'''package com.jieqi.bluetooth;
import java.io.*;import java.nio.charset.StandardCharsets;import java.util.concurrent.*;
import android.bluetooth.*;import android.os.Handler;import android.webkit.WebView;import org.json.*;import probe.Trace;
public class LifecycleProbe {
 static class Input extends InputStream {
  final byte[] bytes;final boolean error,gate;int offset;volatile boolean closed;
  final CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),finished=new CountDownLatch(1);
  Input(String s,boolean e,boolean g){bytes=s.getBytes(StandardCharsets.UTF_8);error=e;gate=g;}
  public int read(byte[] b,int o,int n)throws IOException{
   entered.countDown();
   if(offset<bytes.length){int count=Math.min(n,bytes.length-offset);System.arraycopy(bytes,offset,b,o,count);offset+=count;Trace.log("input:bytes:"+count);return count;}
   if(gate&&!closed)try{Trace.waitFor(release);}catch(Exception e){throw new IOException(e);}
   Trace.log(error?"input:IOException":"input:EOF");if(error)throw new IOException("injected input failure after bytes");return -1;
  }
  public int read()throws IOException{byte[] b=new byte[1];return read(b,0,1)<0?-1:b[0]&255;}
  public void close(){closed=true;Trace.log("input:close");release.countDown();finished.countDown();}
 }
 static class Output extends OutputStream {
  final CountDownLatch blocked=new CountDownLatch(1),release=new CountDownLatch(1);
  public void write(int b)throws IOException{write(new byte[]{(byte)b},0,1);}
  public void write(byte[] b,int o,int n)throws IOException{Trace.log("old:write-blocked");blocked.countDown();try{Trace.waitFor(release);}catch(Exception e){throw new IOException(e);}Trace.log("old:write-throws");throw new IOException("injected late old output failure");}
 }
 static void drain(MainActivity activity){Handler.drain();while(!activity.queue.isEmpty()){Trace.log("ui:execute");activity.queue.remove(0).run();}}
 public static void main(String[] args)throws Exception{
  String mode=args[0],raw=new String(System.in.readAllBytes(),StandardCharsets.UTF_8);
  MainActivity activity=new MainActivity();WebView web=new WebView();GameWebBridge bridge=new GameWebBridge(activity,web,new BluetoothAdapter());
  String sendResult=null;boolean replacementClosed=false;
  if(mode.startsWith("lock_")){
   Input oldInput=new Input("",false,true),newInput=new Input("",false,true);Output output=new Output();
   BluetoothSocket old=new BluetoothSocket("old",oldInput,output),next=new BluetoothSocket("new",newInput,new ByteArrayOutputStream());
   BluetoothAdapter.sockets.add(old);BluetoothAdapter.sockets.add(next);bridge.join("fixture");Trace.waitFor(oldInput.entered);drain(activity);
   final String[] result={null};Thread sender=new Thread(()->{result[0]=bridge.sendChecked(raw);Trace.log("old:send-return:"+result[0]);},"sender");sender.start();Trace.waitFor(output.blocked);
   oldInput.release.countDown();Trace.waitFor(oldInput.finished);
   if(mode.equals("lock_release_before")){output.release.countDown();sender.join(5000);if(sender.isAlive())throw new AssertionError("sender timeout");}
   // Execute only the actual delayed runnable. Virtual time, not Android timing.
   Handler.advanceDelay();Trace.waitFor(newInput.entered);Trace.log("new:read-entered-barrier");
   if(mode.equals("lock_release_after")){output.release.countDown();sender.join(5000);if(sender.isAlive())throw new AssertionError("sender timeout");}
   sendResult=result[0];replacementClosed=next.closed;drain(activity);
  }else{
   Input input=new Input(raw,mode.equals("ioexception"),false);
   BluetoothAdapter.sockets.add(new BluetoothSocket("receiver",input,new ByteArrayOutputStream()));
   bridge.host();Trace.waitFor(input.finished);
   // Error emission precedes input close. EOF/IOException schedules reconnect;
   // wait for that submission, but do not run it in receive-only cases.
   if(!mode.equals("partial")&&!mode.equals("invalid_version")){
    Runnable delayed=Handler.delayed.poll(5,TimeUnit.SECONDS);if(delayed==null)throw new AssertionError("no reconnect submission");
   }
   drain(activity);
  }
  JSONObject out=new JSONObject().put("mode",mode).put("status",bridge.status()).put("sendResult",sendResult).put("replacementClosed",replacementClosed);
  JSONArray scripts=new JSONArray();for(String s:web.events)scripts.put(s);out.put("scripts",scripts);
  JSONArray trace=new JSONArray();synchronized(Trace.events){for(String s:Trace.events)trace.put(s);}out.put("trace",trace);
  bridge.close();System.out.println(out);
 }
}'''
})

def main():
    prior=json.loads((ROOT/'review/native-send-accounting/JVM_RESULTS_20261030.json').read_text())
    fixture={r['mode']:r for r in prior['cases']}
    raw=fixture['newline']['actual']['wire']
    inputs={'eof':raw,'ioexception':raw,'partial':fixture['partial']['actual']['wire'],
            'newline':fixture['success']['actual']['wire'],'invalid_version':raw.replace('"v":2','"v":99'),
            'lock_release_before':raw,'lock_release_after':raw}
    hashes={n:hashlib.sha256((ROOT/'android/app/src/main/java/com/jieqi/bluetooth'/n).read_bytes()).hexdigest() for n in prior['source_sha256']}
    assert hashes==prior['source_sha256'], 'production sources must match pinned PR22'
    rows=[]
    with tempfile.TemporaryDirectory(prefix='ch-lifecycle-') as tmp:
        directory=Path(tmp)
        for p,s in SHIMS.items():
            dest=directory/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(s+'\n')
        for n in hashes:
            (directory/'com/jieqi/bluetooth'/n).write_bytes((ROOT/'android/app/src/main/java/com/jieqi/bluetooth'/n).read_bytes())
        command=['java','-m','jdk.compiler/com.sun.tools.javac.Main','-encoding','UTF-8','-d',str(directory/'classes'),*map(str,sorted(directory.rglob('*.java')))]
        compile_result=subprocess.run(command,capture_output=True,text=True)
        if compile_result.returncode:raise RuntimeError(compile_result.stderr)
        for mode,data in inputs.items():
            proc=subprocess.run(['java','-cp',str(directory/'classes'),'com.jieqi.bluetooth.LifecycleProbe',mode],input=data,text=True,capture_output=True,timeout=20)
            if proc.returncode:raise RuntimeError(mode+': '+proc.stderr)
            row=json.loads(proc.stdout)
            import re
            details=[json.loads(json.loads(re.search(r'detail:JSON.parse\((.*)\)\}\)\);$',s).group(1))) for s in row['scripts']]
            row.update(input=data,input_sha256=hashlib.sha256(data.encode()).hexdigest(),events=details)
            messages=[e['message'] for e in details if e['type']=='message']
            assert len(messages)==(1 if mode in ('eof','newline') else 0),(mode,messages)
            if messages:assert messages[0]==json.loads(raw)
            if mode.startswith('lock_'):
                assert json.loads(row['sendResult'])['status']=='unknown'
                assert not row['replacementClosed'] and json.loads(row['status'])['state']=='CONNECTED'
                trace=row['trace'];install=next(i for i,s in enumerate(trace) if 'new:writer-install' in s);throws=next(i for i,s in enumerate(trace) if 'old:write-throws' in s)
                assert (throws<install)==(mode=='lock_release_before')
            else:
                expected='ERROR' if mode in ('partial','invalid_version') else 'DISCONNECTED'
                assert json.loads(row['status'])['state']==expected
            rows.append(row)
    result={'schema':'lezi.chaos.lifecycle.jvm.v1','base':'71145df45ad17215a3731e53150b6728e079e375',
      'production_source_sha256':hashes,'cases':rows,'passed':len(rows),'failed':0,
      'environment':subprocess.run(['java','-version'],capture_output=True,text=True).stderr,
      'limits':['Real unmodified session + bridge + JDK21 reader/writer/single executor; Android transport/Handler/UI and narrow JSON shims.',
       'JSON shim validates only fixture braces and v/type; not general JSON or Android conformance. Node validates fixture payload later.',
       'Socket shim close releases input but deliberately does not release pending output; old output released by test latch. No radio/JNI proof.',
       'Delayed reconnect uses actual production runnable at virtual +1000ms; not wall-clock Android scheduling.',
       'MainActivity queues every runOnUiThread, unlike Android inline-on-UI behavior. Callback replay preserves this explicit model only.'],
      'commands':['python3 scripts/research/ch-lifecycle-probe.py','java -m jdk.compiler/com.sun.tools.javac.Main ...','java -cp <temporary classes> com.jieqi.bluetooth.LifecycleProbe <case>']}
    target=ROOT/'review/ch-lifecycle-validation/JVM_RESULTS.json';target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'passed':len(rows),'failed':0,'output':str(target)}))

if __name__=='__main__':main()
