import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOriginalHalfChaosSession } from './original-half-chaos.ts';

const arg=(k:string)=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1);
const root=arg('--baseline-root');if(!root)throw Error('Use blob-verified PR18 parent via --baseline-root');
const parent=await import(pathToFileURL(resolve(root,'scripts/research/original-half-chaos.ts')).href);
const dir=new URL('../../tests/fixtures/half-chaos-original/',import.meta.url);
const [initial,replays]=['INITIALIZATION_WITNESS_DATA.json','REPLAY_ACTION_DATA.json'].map(x=>readFileSync(new URL(x,dir),'utf8'));
function normalize(v:any,b:any):any{
  if(typeof v==='string'){
    if(v===b.roomId)return'<room>';if(v===b.players.red)return'<red-player>';if(v===b.players.black)return'<black-player>';
    if(v.startsWith(b.roomId+':')||v.startsWith('system:'+b.roomId+':')||v.startsWith('server:'+b.roomId+':'))return v.replace(b.roomId,'<room>').replaceAll(b.replayId,'<replay>');return v;
  }
  if(Array.isArray(v))return v.map(x=>normalize(x,b));
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[normalize(k,b),normalize(x,b)]));return v;
}
const hash=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rows=[];let ambientRandom=0,ambientClock=0,projections=0;
for(const spec of JSON.parse(replays).replays){
  const old=parent.createOriginalHalfChaosSession(initial,replays,spec.replay_id),off=createOriginalHalfChaosSession(initial,replays,spec.replay_id),on=createOriginalHalfChaosSession(initial,replays,spec.replay_id,{stageProjections:true}),none=createOriginalHalfChaosSession(initial,replays,spec.replay_id,{withoutObservation:true});
  assert.deepEqual(old.draws,off.draws);assert.deepEqual(old.draws,on.draws);assert.deepEqual(on.draws,none.draws);
  for(const turn of old.replay.source_prescribed_turns)for(const request of [...turn.pre_main_requests,turn.normal_main]){
    const a=old.step(request.declaration_id),b=off.step(request.declaration_id),d=none.step(request.declaration_id);
    const random=Math.random,now=Date.now;let c;
    try{Math.random=()=>{ambientRandom++;throw Error('unexpected ambient random');};Date.now=()=>{ambientClock++;throw Error('unexpected ambient clock');};c=on.step(request.declaration_id);}finally{Math.random=random;Date.now=now;}
    const clean={...c,events:c.events.map(({checkpointProjection,...e})=>e)};projections+=c.events.filter(e=>e.checkpointProjection!==undefined).length;
    const na=normalize(a,old.binding),nb=normalize(b,off.binding),nc=normalize(clean,on.binding);
    assert.deepEqual(nb,na);assert.deepEqual(nc,nb);assert.deepEqual(d.events,[]);
    for(const key of ['before','after','views','command','disposition','error','now','duplicate'])assert.deepEqual(normalize(d[key],none.binding),normalize(b[key],off.binding));
    rows.push({replayId:spec.replay_id,declarationId:request.declaration_id,disposition:a.disposition,parentVsDefaultAllReturnedFieldsEqual:true,
      projectionVsDefaultAllReturnedFieldsEqualExcludingOnlyNewProjectionField:true,noObservationAuthorityViewsCommandOutcomeClockEqual:true,
      normalizedOriginalResultSha256:hash(na),projectionCount:c.events.filter(e=>e.checkpointProjection!==undefined).length});
  }
}
assert.equal(rows.length,110);assert.equal(projections,200);assert.equal(ambientRandom,0);assert.equal(ambientClock,0);
const report={schema:'lezi.hc.exact_stage_projection.differential.v1',executedLocalDate:'2026-10-29',baselineCommit:'099eca44dbaab39bdedb02a9986f7d54e9761121',
  originalRequestsCompared:110,versions:['immutable_parent','new_default_no_projection','new_exact_projection','new_without_any_observation'],
  parentVsDefaultRequestPairs:110,projectionVsDefaultRequestPairs:110,noObservationRequestPairs:110,newProjectionFieldsExcludedFromEventComparisonOnly:true,
  exactProjectionCount:200,ambientRandomCalls:ambientRandom,ambientClockCalls:ambientClock,
  normalization:'Only exact declared room/player/request identifier prefixes and associated object keys; no clock/RNG/authority/event/secret/history/source field omitted. New checkpointProjection is compared separately and is the sole additional event field.',
  rows,rawAuthoritySecretAndPlayerBodiesComparedInMemoryOnly:true,independentQA:false,formal64Accepted:0};
const output=arg('--output');if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({originalRequests:rows.length,projectionCount:projections,ambientRandom,ambientClock,status:'ALL_EQUAL'}));
