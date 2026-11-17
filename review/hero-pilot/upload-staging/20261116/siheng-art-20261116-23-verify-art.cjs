const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sharp = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/sharp' : 'sharp');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
  const manifest=JSON.parse(fs.readFileSync('review/hero-pilot/ART_ASSET_MANIFEST.json','utf8'));
  const checked=[];
  for(const f of manifest.files){
    const bytes=fs.readFileSync(f.path),m=await sharp(bytes).metadata();
    assert.equal(sha(bytes),f.sha256);assert.equal(m.width,f.width);assert.equal(m.height,f.height);assert.equal(m.hasAlpha,f.hasAlpha);
    if(f.path.startsWith('web/')) assert.equal(sha(fs.readFileSync('dist/'+f.path)),f.sha256);
    checked.push(f.path);
  }
  const portrait=await sharp('web/assets/hero-pilot/siheng-portrait-v1.webp').raw().toBuffer({resolveWithObject:true});
  assert.equal(portrait.info.channels,4);assert.equal(portrait.data[3],0);
  const port=4187, server=spawn(process.execPath,['scripts/serve-web.ts'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  const served=[];
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Local asset server readiness timeout')),10000);
      server.once('error',e=>{clearTimeout(timer);reject(e);});
      server.once('exit',code=>{clearTimeout(timer);reject(Error('Asset server exited '+code));});
      server.stdout.once('data',()=>{clearTimeout(timer);resolve();});
    });
    for(const f of manifest.files.filter(f=>f.path.startsWith('web/'))){
      const response=await fetch(`http://127.0.0.1:${port}/${f.path}`);
      assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');
      assert.equal(sha(Buffer.from(await response.arrayBuffer())),f.sha256);served.push(f.path);
    }
  }finally{server.kill();}
  const report={kind:'art_binary_build_and_real_local_http',manifestFiles:checked.length,buildCopies:4,httpAssets:served.length,httpContentType:'image/webp',sourceHashesMatch:true,transparentPortraitCorner:true,passed:true,browserLayoutVerified:false,served};
  fs.writeFileSync('review/hero-pilot/ART_DELIVERY_CHECK.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
