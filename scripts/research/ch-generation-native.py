"""C5 production classes under explicit transport/JSON/UI models; no reflection."""
from pathlib import Path
import importlib.util,json,subprocess,tempfile,hashlib,re
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('old',ROOT/'scripts/research/ch-lifecycle-probe.py');old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
SHIMS=dict(old.SHIMS)
SHIMS['android/bluetooth/BluetoothAdapter.java']=SHIMS['android/bluetooth/BluetoothAdapter.java'].replace('public class BluetoothAdapter {','public class BluetoothAdapter { public static final java.util.concurrent.BlockingQueue<BluetoothServerSocket> servers=new java.util.concurrent.LinkedBlockingQueue<>();').replace('return new BluetoothServerSocket();','BluetoothServerSocket supplied=servers.poll();return supplied==null?new BluetoothServerSocket():supplied;')
SHIMS['com/jieqi/bluetooth/MainActivity.java']=SHIMS['com/jieqi/bluetooth/MainActivity.java'].replace('public class MainActivity {','public class MainActivity { public static boolean inline;').replace('queue.add(r);','if(inline)r.run();else queue.add(r);')
SHIMS['com/jieqi/bluetooth/GenerationProbe.java']=r'''package com.jieqi.bluetooth;
import java.io.*;import java.util.concurrent.*;import android.bluetooth.*;import android.webkit.*;import android.os.Handler;import org.json.*;import probe.Trace;
public class GenerationProbe {
 static void waitInput(LifecycleProbe.Input i)throws Exception{Trace.waitFor(i.entered);}
 static void drain(MainActivity a){LifecycleProbe.drain(a);}
 static class SlowSocket extends BluetoothSocket{
  final CountDownLatch connecting=new CountDownLatch(1),release=new CountDownLatch(1);
  SlowSocket(String n,InputStream i,OutputStream o){super(n,i,o);}
  @Override public void connect(){connecting.countDown();try{Trace.waitFor(release);}catch(Exception e){throw new RuntimeException(e);}super.connect();}
 }
 static class SlowServer extends BluetoothServerSocket {
  final CountDownLatch accepting=new CountDownLatch(1),release=new CountDownLatch(1);final BluetoothSocket accepted;
  SlowServer(BluetoothSocket s){accepted=s;}
  @Override public BluetoothSocket accept(){accepting.countDown();try{Trace.waitFor(release);}catch(Exception e){throw new RuntimeException(e);}return accepted;}
 }
 public static void main(String[] args)throws Exception{
  String mode=args[0],raw=new String(System.in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);MainActivity.inline=args[1].equals("inline");
  MainActivity a=new MainActivity();WebView web=new WebView();GameWebBridge b=new GameWebBridge(a,web,new BluetoothAdapter());
  JSONObject out=new JSONObject().put("mode",mode).put("uiModel",args[1]);
  if(mode.equals("eof")||mode.equals("ioexception")){
   LifecycleProbe.Input i=new LifecycleProbe.Input(raw,mode.equals("ioexception"),false);
   BluetoothAdapter.sockets.add(new BluetoothSocket("receiver",i,new ByteArrayOutputStream()));b.host();Trace.waitFor(i.finished);
   if(Handler.delayed.poll(5,TimeUnit.SECONDS)==null)throw new AssertionError("no delay");drain(a);out.put("context",b.localTransportContext());
  }else if(mode.equals("cancel_connect")){
   LifecycleProbe.Input i=new LifecycleProbe.Input("",false,true),n=new LifecycleProbe.Input("",false,true);
   SlowSocket old=new SlowSocket("old",i,new ByteArrayOutputStream());BluetoothSocket next=new BluetoothSocket("new",n,new ByteArrayOutputStream());
   BluetoothAdapter.sockets.add(old);BluetoothAdapter.sockets.add(next);b.join("old");Trace.waitFor(old.connecting);String before=b.localTransportContext();
   b.disconnect();b.host();old.release.countDown();waitInput(n);drain(a);
   out.put("before",before).put("context",b.localTransportContext()).put("oldClosed",old.closed).put("newClosed",next.closed);
  }else if(mode.equals("cancel_accept")){
   LifecycleProbe.Input i=new LifecycleProbe.Input("",false,true),n=new LifecycleProbe.Input("",false,true);
   BluetoothSocket oldSocket=new BluetoothSocket("old",i,new ByteArrayOutputStream()),next=new BluetoothSocket("new",n,new ByteArrayOutputStream());SlowServer server=new SlowServer(oldSocket);
   BluetoothAdapter.servers.add(server);BluetoothAdapter.sockets.add(next);b.host();Trace.waitFor(server.accepting);b.disconnect();b.join("new");server.release.countDown();waitInput(n);drain(a);
   out.put("context",b.localTransportContext()).put("oldClosed",oldSocket.closed).put("newClosed",next.closed);
  }else if(mode.equals("old_delay")){
   LifecycleProbe.Input i=new LifecycleProbe.Input("",false,false),n=new LifecycleProbe.Input("",false,true);
   BluetoothAdapter.sockets.add(new BluetoothSocket("old",i,new ByteArrayOutputStream()));b.join("old");Trace.waitFor(i.finished);
   Runnable delayed=Handler.delayed.poll(5,TimeUnit.SECONDS);if(delayed==null)throw new AssertionError("no delay");
   BluetoothSocket next=new BluetoothSocket("new",n,new ByteArrayOutputStream());BluetoothAdapter.sockets.add(next);b.host();waitInput(n);String before=b.localTransportContext();delayed.run();drain(a);
   out.put("before",before).put("context",b.localTransportContext()).put("newClosed",next.closed);
  }else if(mode.equals("late_send")){
   LifecycleProbe.Input i=new LifecycleProbe.Input("",false,true),n=new LifecycleProbe.Input("",false,true);LifecycleProbe.Output output=new LifecycleProbe.Output();
   BluetoothAdapter.sockets.add(new BluetoothSocket("old",i,output));BluetoothSocket next=new BluetoothSocket("new",n,new ByteArrayOutputStream());BluetoothAdapter.sockets.add(next);
   b.join("old");waitInput(i);String before=b.localTransportContext();JSONObject c=new JSONObject(before);
   // Narrow shim cannot parse nested object: read session-owned context through a
   // separate listener session is unnecessary; use exact regex only in fixture.
   String instance=extract(before,"instance"),generation=extract(before,"generation");final String[] result={null};
   Thread sender=new Thread(()->result[0]=b.sendCheckedScoped(raw,instance,generation),"sender");sender.start();Trace.waitFor(output.blocked);
   i.release.countDown();Trace.waitFor(i.finished);Handler.advanceDelay();waitInput(n);output.release.countDown();sender.join(5000);if(sender.isAlive())throw new AssertionError("sender timeout");drain(a);
   out.put("before",before).put("context",b.localTransportContext()).put("result",result[0]).put("newClosed",next.closed);
  }else if(mode.equals("scoped")){
   LifecycleProbe.Input i=new LifecycleProbe.Input("",false,true);ByteArrayOutputStream output=new ByteArrayOutputStream();
   BluetoothAdapter.sockets.add(new BluetoothSocket("one",i,output));b.join("fixture");waitInput(i);String context=b.localTransportContext(),instance=extract(context,"instance"),generation=extract(context,"generation");
   out.put("wrongInstance",b.sendCheckedScoped(raw,"wrong",generation)).put("wrongGeneration",b.sendCheckedScoped(raw,instance,"999"));
   out.put("beforeBytes",output.size()).put("result",b.sendCheckedScoped(raw,instance,generation));b.send(raw);
   out.put("wire",output.toString("UTF-8")).put("context",context);b.disconnect();out.put("disconnected",b.sendCheckedScoped(raw,instance,generation));
   GameWebBridge rebuilt=new GameWebBridge(new MainActivity(),new WebView(),new BluetoothAdapter());out.put("rebuilt",rebuilt.localTransportContext());rebuilt.close();drain(a);
  }else if(mode.equals("legacy")){
   b.close();final int[] counts={0,0};BluetoothGameSession session=new BluetoothGameSession(new BluetoothAdapter(),new BluetoothGameSession.Listener(){public void onStateChanged(BluetoothGameSession.Role r,BluetoothGameSession.State s,String d){counts[0]++;}public void onMessage(JSONObject m){counts[1]++;}});
   LifecycleProbe.Input i=new LifecycleProbe.Input(raw,false,false);BluetoothAdapter.sockets.add(new BluetoothSocket("legacy",i,new ByteArrayOutputStream()));session.host();Trace.waitFor(i.finished);
   if(Handler.delayed.poll(5,TimeUnit.SECONDS)==null)throw new AssertionError("delay");Handler.drain();out.put("stateCount",counts[0]).put("messageCount",counts[1]);session.close();
  }
  JSONArray scripts=new JSONArray();for(String s:web.events)scripts.put(s);out.put("scripts",scripts);JSONArray trace=new JSONArray();synchronized(Trace.events){for(String s:Trace.events)trace.put(s);}out.put("trace",trace);b.close();System.out.println(out);
 }
 static String extract(String s,String key){java.util.regex.Matcher m=java.util.regex.Pattern.compile("\\\""+key+"\\\":\\\"([^\\\"]*)\\\"").matcher(s);if(!m.find())throw new AssertionError(key);return m.group(1);}
}'''
def main():
 raw=json.loads((ROOT/'review/native-send-accounting/JVM_RESULTS_20261030.json').read_text())['cases'][0]['actual']['wire'].rstrip('\n');rows=[]
 with tempfile.TemporaryDirectory(prefix='ch-generation-') as tmp:
  d=Path(tmp)
  for p,s in SHIMS.items():
   dest=d/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(s+'\n')
  for n in ['BluetoothGameSession.java','GameWebBridge.java']:(d/'com/jieqi/bluetooth'/n).write_bytes((ROOT/'android/app/src/main/java/com/jieqi/bluetooth'/n).read_bytes())
  compile=subprocess.run(['java','-m','jdk.compiler/com.sun.tools.javac.Main','-encoding','UTF-8','-d',str(d/'classes'),*map(str,d.rglob('*.java'))],capture_output=True,text=True)
  if compile.returncode:raise RuntimeError(compile.stderr)
  for model in ['inline','queued']:
   for mode in ['eof','ioexception','cancel_connect','cancel_accept','old_delay','late_send','scoped','legacy']:
    r=subprocess.run(['java','-cp',str(d/'classes'),'com.jieqi.bluetooth.GenerationProbe',mode,model],input=raw,text=True,capture_output=True,timeout=20)
    if r.returncode:raise RuntimeError(mode+model+r.stderr)
    row=json.loads(r.stdout);row['events']=[json.loads(json.loads(re.search(r'detail:JSON.parse\((.*)\)\}\)\);$',s).group(1))) for s in row['scripts']]
    if mode in ['eof','ioexception']:assert sum(e['type']=='message' for e in row['events'])==(mode=='eof')
    if mode=='cancel_connect':
     assert row['oldClosed'] and not row['newClosed'];assert json.loads(row['context'])['context']['role']=='HOST'
     assert row['events'][0]['role']=='GUEST' and row['events'][0]['localContext']['role']=='GUEST'
    if mode=='cancel_accept':assert row['oldClosed'] and not row['newClosed'] and json.loads(row['context'])['context']['role']=='GUEST'
    if mode=='old_delay':assert row['before']==row['context'] and not row['newClosed']
    if mode=='late_send':
     answer=json.loads(row['result']);before=json.loads(row['before'])['context'];now=json.loads(row['context'])['context'];assert answer['status']=='unknown' and answer['attemptedContext']['generation']==before['generation'] and before['generation']!=now['generation'] and not row['newClosed']
    if mode=='scoped':
     for k in ['wrongInstance','wrongGeneration','disconnected']:assert json.loads(row[k])=={'status':'not_sent','attemptedContext':None}
     assert row['beforeBytes']==0 and row['wire']==(raw+'\n')*2 and json.loads(row['result'])['status']=='written'
     assert json.loads(row['context'])['context']['instance']!=json.loads(row['rebuilt'])['context']['instance']
    if mode=='legacy':assert row['messageCount']==1 and row['stateCount']==3
    sequences=[int(e['localContext']['sequence']) for e in row['events']];assert sequences==sorted(set(sequences))
    rows.append(row)
 result={'passed':len(rows),'failed':0,'cases':rows,'source_sha256':{n:hashlib.sha256((ROOT/'android/app/src/main/java/com/jieqi/bluetooth'/n).read_bytes()).hexdigest() for n in ['BluetoothGameSession.java','GameWebBridge.java']},'limits':['Real JDK21 io/executor; controlled socket/input/output, narrow JSON shim.','Explicit inline and queued MainActivity models; virtual delayed reconnect, no Android/JNI/radio.','No reflection or direct attach. Prior exact EOF fixture reused, no old-suite rerun.']}
 target=ROOT/'review/ch-local-generation/NATIVE_RESULTS.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'passed':len(rows),'failed':0}))
if __name__=='__main__':main()
