import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStandardNp32Session, createStandardNp32WindowSession } from './standard-np32.ts';

function normalize(v:any,binding:any):any{
  if(typeof v==='string'){if(v===binding.players.red)return '<red-player>';if(v===binding.players.black)return '<black-player>';return v.replaceAll(binding.roomId,'<room>');}
  if(Array.isArray(v))return v.map(x=>normalize(x,binding));
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[normalize(k,binding),normalize(x,binding)]));return v;
}
const hash=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const arg=(s:string)=>process.argv.find(x=>x.startsWith(s+'='))?.slice(s.length+1);
const baseline=arg('--baseline-root');if(!baseline)throw new Error('Use a blob-verified 1bda5bc parent checkout via --baseline-root');
const parent=await import(pathToFileURL(resolve(baseline,'scripts/research/standard-np32.ts')).href);
const root=new URL('../../tests/fixtures/standard-np32/',import.meta.url);
const [contract,rng,guards]=['NP_CONTRACT.json','RNG_CONTRACT.json','OBSERVATION_GUARD_MATRIX.json'].map(x=>readFileSync(new URL(x,root),'utf8'));
const originals=[],observation=[];
for(const branch of ['AS','AP','ES'] as const){
  const a=parent.createStandardNp32Session(contract,rng,guards,branch),b=createStandardNp32Session(contract,rng,guards,branch),checks=[];
  assert.deepEqual(a.declarations,b.declarations);
  for(const d of a.declarations){
    const x=a.step(d.id),y=b.step(d.id);assert.equal(x.disposition,'accepted');assert.equal(y.disposition,'accepted');
    const nx=normalize(x,a.binding),ny=normalize(y,b.binding);assert.deepEqual(ny,nx);assert.deepEqual(a.draws(),b.draws());
    checks.push({id:d.id,allReturnedFieldsEqual:true,normalizedResultSha256:hash(nx)});
  }
  originals.push({branch,requests:checks.length,checks});
}
for(const branch of ['AP','ES'] as const)for(const variant of ['R8_USE','R8_EXPIRE','R7_CARRIER_MOVE'] as const){
  const a=createStandardNp32WindowSession(contract,rng,guards,branch,variant),b=createStandardNp32WindowSession(contract,rng,guards,branch,variant,{withoutObservation:true}),checks=[];
  for(const d of a.declarations){
    const x=a.step(d.id),y=b.step(d.id);assert.equal(x.disposition,'accepted');assert.equal(y.disposition,'accepted');assert.deepEqual(y.events,[]);
    assert.deepEqual(normalize(x.after,a.binding),normalize(y.after,b.binding));assert.deepEqual(normalize(x.views,a.binding),normalize(y.views,b.binding));assert.deepEqual(a.draws(),b.draws());
    checks.push({id:d.id,authorityPlayerViewsAndRngEqual:true,normalizedAuthoritySha256:hash(normalize(x.after,a.binding))});
  }
  observation.push({branch,variant,requests:checks.length,checks});
}
const report={schema:'lezi.standard_np32.window_differential.v1',executedLocalDate:'2026-10-29',baselineCommit:'1bda5bc9f7840d0d601a85fb0faeda842753a199',
  originalRequestPairs:originals.reduce((n,x)=>n+x.requests,0),observationOnOffRequestPairs:observation.reduce((n,x)=>n+x.requests,0),
  normalization:'Only declared room/player identifiers, including object keys. No game, clock, event, secret, RNG, history or source field omitted.',
  originals,observation,rawBodiesComparedInMemoryOnly:true,rawAuthoritySecretEventBodiesPublished:false,productionRandomSampling:false,independentQA:false};
const output=arg('--output');if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({originalRequestPairs:report.originalRequestPairs,observationOnOffRequestPairs:report.observationOnOffRequestPairs,status:'ALL_EQUAL'}));
