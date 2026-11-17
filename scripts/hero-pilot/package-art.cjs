// Deterministic packaging only: generated artwork is never repainted or retouched.
// Requires sharp 0.35.5, resolved from runtime or NODE_PATH; no product dependency.
const sharp = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/sharp' : 'sharp');
const fs = require('node:fs');
const crypto = require('node:crypto');
const root = 'web/assets/hero-pilot/';
const source = 'art/hero-pilot/';
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async () => {
  fs.mkdirSync(root, {recursive:true});
  await sharp(source+'siheng-portrait-v1.png').resize({height:1152,withoutEnlargement:true}).webp({quality:92,alphaQuality:100}).toFile(root+'siheng-portrait-v1.webp');
  for(const size of [64,128,256]) await sharp(source+'siheng-avatar-master-v1.png').resize(size,size).webp({quality:92}).toFile(root+`siheng-avatar-${size}-v1.webp`);
  const inputs=[source+'siheng-portrait-v1.png',source+'siheng-avatar-master-v1.png'];
  const outputs=[root+'siheng-portrait-v1.webp',...[64,128,256].map(n=>root+`siheng-avatar-${n}-v1.webp`)];
  const files=[];
  for(const path of [...inputs,...outputs]) {
    const m=await sharp(path).metadata();
    files.push({path,sha256:sha(path),bytes:fs.statSync(path).size,width:m.width,height:m.height,format:m.format,hasAlpha:m.hasAlpha});
  }
  const strips=[];
  // QA contact sheet: original-color rendering at actual CSS sizes, on two grounds.
  const label=(text,width=500,height=32)=>Buffer.from(`<svg width="${width}" height="${height}"><text x="0" y="23" font-family="sans-serif" font-size="17" fill="#6b6254">${text}</text></svg>`);
  strips.push({input:await sharp(root+'siheng-portrait-v1.webp').resize({height:650}).toBuffer(),left:0,top:40});
  strips.push({input:label('SIHENG / FULL PORTRAIT'),left:20,top:8});
  strips.push({input:label('AVATAR / 256px'),left:490,top:8});
  strips.push({input:await sharp(root+'siheng-avatar-256-v1.webp').toBuffer(),left:490,top:42});
  for(const [row,bg] of [[0,'#eee6d7'],[1,'#243432']]) {
    strips.push({input:await sharp({create:{width:410,height:112,channels:3,background:bg}}).png().toBuffer(),left:470,top:350+row*170});
    for(const [i,size] of [48,64,96].entries()) {
      strips.push({input:await sharp(root+`siheng-avatar-${size<=64?64:128}-v1.webp`).resize(size,size).toBuffer(),left:490+i*130,top:358+row*170});
      strips.push({input:label(size+'px',80),left:490+i*130,top:466+row*170});
    }
  }
  await sharp({create:{width:900,height:710,channels:3,background:'#f5f0e6'}}).composite(strips).png().toFile('review/hero-pilot/ART_QA_CONTACT.png');
  fs.writeFileSync('review/hero-pilot/ART_ASSET_MANIFEST.json',JSON.stringify({version:'siheng-art-v1',tool:'built-in imagegen',packager:'sharp '+sharp.versions.sharp,operation:'unchanged original PNGs; proportional resize and WebP encoding only; no synthetic repainting',files,proofSheet:'review/hero-pilot/ART_QA_CONTACT.png'},null,2)+'\n');
  console.log(JSON.stringify({files:files.length,totalRuntimeBytes:files.filter(f=>f.path.startsWith('web/')).reduce((n,f)=>n+f.bytes,0)}));
})().catch(e=>{console.error(e);process.exitCode=1;});
