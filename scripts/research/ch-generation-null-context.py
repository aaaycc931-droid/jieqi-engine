"""Emit actual bridge responses under the corrected, still bounded C5 JSON shim.

No APK/radio/Android runtime. --bridge-ref is a read-only parent defect control.
"""
from pathlib import Path
import argparse, hashlib, importlib.util, json, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('generation', ROOT/'scripts/research/ch-generation-native.py')
generation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generation)

PROBE = r'''package com.jieqi.bluetooth;
import java.io.*;import android.bluetooth.*;import android.webkit.*;import org.json.*;import probe.Trace;
public class NullContextProbe {
 static String value(String c,String key){return GenerationProbe.extract(c,key);}
 static JSONObject row(String id,GameWebBridge b,ByteArrayOutputStream wire,String raw,String instance,String generation)throws Exception{
  int before=wire.size();String response=b.sendCheckedScoped(raw,instance,generation);
  return new JSONObject().put("id",id).put("response",response).put("context",b.localTransportContext()).put("bytesBefore",before).put("bytesAfter",wire.size());
 }
 public static void main(String[] args)throws Exception{
  String raw=new String(System.in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
  JSONObject result=new JSONObject().put("javaNullRemoves",new JSONObject().put("x","old").put("x",null).toString())
    .put("sentinelPreservesNull",new JSONObject().put("x",JSONObject.NULL).toString());
  MainActivity activity=new MainActivity();GameWebBridge b=new GameWebBridge(activity,new WebView(),new BluetoothAdapter());
  try{
   LifecycleProbe.Input input=new LifecycleProbe.Input("",false,true);ByteArrayOutputStream wire=new ByteArrayOutputStream();
   BluetoothAdapter.sockets.add(new BluetoothSocket("null-context",input,wire));b.join("fixture");Trace.waitFor(input.entered);
   String context=b.localTransportContext(),instance=value(context,"instance"),generation=value(context,"generation");
   JSONArray refusals=new JSONArray();
   refusals.put(row("wrong-instance",b,wire,raw,"wrong-instance",generation));
   refusals.put(row("wrong-generation",b,wire,raw,instance,"999"));
   refusals.put(row("invalid-json",b,wire,"not-json",instance,generation));
   result.put("written",row("written",b,wire,raw,instance,generation));
   result.put("wire",wire.toString("UTF-8"));
   b.disconnect();context=b.localTransportContext();
   refusals.put(row("disconnected",b,wire,raw,value(context,"instance"),value(context,"generation")));
   result.put("refusals",refusals);System.out.println(result);
  }finally{b.close();}
 }
}'''


def run(bridge_ref=None):
    shims = dict(generation.SHIMS)
    shims['com/jieqi/bluetooth/NullContextProbe.java'] = PROBE
    production = ROOT/'android/app/src/main/java/com/jieqi/bluetooth'
    sources = {name: (production/name).read_bytes() for name in ['BluetoothGameSession.java', 'GameWebBridge.java']}
    if bridge_ref:
        sources['GameWebBridge.java'] = subprocess.check_output([
            'git', '-C', str(ROOT), 'show', f'{bridge_ref}:android/app/src/main/java/com/jieqi/bluetooth/GameWebBridge.java'])
    raw = '{"v":2,"type":"action","id":"null-context-control","payload":{"kind":"hero","hero":"shuffler"}}'
    with tempfile.TemporaryDirectory(prefix='c5-null-context-') as tmp:
        directory = Path(tmp)
        for path, source in shims.items():
            target = directory/path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(source+'\n')
        for name, source in sources.items():
            (directory/'com/jieqi/bluetooth'/name).write_bytes(source)
        compiled = subprocess.run(['java', '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-encoding', 'UTF-8',
            '-d', str(directory/'classes'), *map(str, directory.rglob('*.java'))], capture_output=True, text=True)
        if compiled.returncode:
            raise RuntimeError(compiled.stderr)
        actual = subprocess.run(['java', '-cp', str(directory/'classes'), 'com.jieqi.bluetooth.NullContextProbe'],
            input=raw, capture_output=True, text=True, timeout=20)
        if actual.returncode:
            raise RuntimeError(actual.stderr)
        result = json.loads(actual.stdout)
    assert result['javaNullRemoves'] == '{}'
    assert result['sentinelPreservesNull'] == '{"x":null}'
    assert all(row['bytesBefore'] == row['bytesAfter'] for row in result['refusals'])
    assert result['wire'] == raw+'\n'
    result['sourceSha256'] = {name: hashlib.sha256(source).hexdigest() for name, source in sources.items()}
    result['bridgeRef'] = bridge_ref or 'working-tree'
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bridge-ref')
    arguments = parser.parse_args()
    print(json.dumps(run(arguments.bridge_ref)))
