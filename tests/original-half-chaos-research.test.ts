import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createOriginalHalfChaosSession,runOriginalHalfChaos } from '../scripts/research/original-half-chaos.ts';
import { GAME_MODES } from '../src/modes.ts';
import { createRemoteRoom,joinRemoteRoom,submitRemoteHeroSelection,submitRemoteRps,submitRemoteMove } from '../src/remote-room.ts';
import { issueOriginalHalfChaosTuple,withExactHalfChaosTuple,withResearchSources,modeResearchPermits,registerExactResearchRoom } from '../src/research-source-context.ts';
const initial=readFileSync(new URL('./fixtures/half-chaos-original/INITIALIZATION_WITNESS_DATA.json',import.meta.url),'utf8');
const replay=readFileSync(new URL('./fixtures/half-chaos-original/REPLAY_ACTION_DATA.json',import.meta.url),'utf8');
const ids=JSON.parse(replay).replays.map((r:any)=>r.replay_id) as string[];
const researchMode={baseMode:'half_chaos' as const,heroesEnabled:true,mutationsEnabled:true};
const code=(s:string)=>(e:unknown)=>(e as {code:string}).code===s;
function capability(){return issueOriginalHalfChaosTuple({roomId:'cap-test',tupleId:'HC-ADM-PD-M04',players:{red:'host',black:'guest'}},initial,replay,'MA-PD01');}

for(const id of ids)test(`original HC ${id}: actual source requests, closed atom/end observations and intermediate oracle`,()=>{
 const r=runOriginalHalfChaos(initial,replay,id);
 assert.equal(r.status,'ORIGINAL_REQUEST_SEQUENCE_EXECUTED',JSON.stringify(r.results.filter(x=>x.outcomeIssues.length)));
 assert.equal(r.actualRequests,r.plannedRequests);assert.equal(r.ledgerMatched,true);
 for(const x of r.results){assert.equal(x.evidenceValid,true);assert.deepEqual(x.outcomeIssues,[]);}
 assert.equal(r.initial.game!.state.pieces.length,32);
 assert.equal(r.draws.length,id.startsWith('MA-DS')?30:29);
 assert.equal(r.initial.game!.state.turnDeadlineAt!-r.initial.game!.state.turnStartedAt!,id.startsWith('MA-DS')?75000:60000);
});

test('client JSON, missing capability and source input changes never open the product mode',()=>{
 assert.equal(GAME_MODES.half_chaos.featuresReady,false);assert.equal(modeResearchPermits('half_chaos'),false);
 assert.throws(()=>createRemoteRoom('client','host','invite',1000,{...researchMode,tupleId:'HC-ADM-PD-M04',research:true} as any),code('MODE_ADAPTATION_PENDING'));
 assert.throws(()=>createOriginalHalfChaosSession(initial+' ',replay,'MA-PD01'),/hash mismatch/);
 assert.throws(()=>createOriginalHalfChaosSession(initial,replay,'NEW'),/original twelve/);
 const cap=capability();assert.throws(()=>withExactHalfChaosTuple(JSON.parse(JSON.stringify(cap)),()=>null),code('RESEARCH_SCOPE_INVALID'));
});

test('exact source capability rejects nested, asynchronous, wrong room and wrong mode; finally clears it',()=>{
 const cap=capability();
 withExactHalfChaosTuple(cap,()=>{
  assert.throws(()=>withExactHalfChaosTuple(cap,()=>null),code('RESEARCH_SCOPE_INVALID'));
  assert.throws(()=>withResearchSources({roomId:'old',mode:'half_chaos',actors:{a:{hero:'shuffler',enabled:true},b:{hero:'shuffler',enabled:true}}},()=>null),code('RESEARCH_SCOPE_INVALID'));
  assert.throws(()=>createRemoteRoom('foreign','host','invite',1000,researchMode),code('RESEARCH_SCOPE_INVALID'));
  assert.throws(()=>createRemoteRoom('cap-test','guest','invite',1000,researchMode),code('RESEARCH_SCOPE_INVALID'));
  assert.throws(()=>createRemoteRoom('cap-test','host','invite',1000,{...researchMode,mutationsEnabled:false}),code('RESEARCH_SCOPE_INVALID'));
 });
 assert.throws(()=>withExactHalfChaosTuple(cap,()=>Promise.resolve()),/synchronous/);
 assert.throws(()=>withExactHalfChaosTuple(cap,()=>{throw Error('stop');}),/stop/);
 assert.equal(modeResearchPermits('half_chaos'),false);
 assert.throws(()=>createRemoteRoom('cap-test','host','invite',1000,researchMode),code('MODE_ADAPTATION_PENDING'));
});

test('authority instance provenance, seats, locked actor hero and real RPS mapping are checked before draw',()=>{
 const cap=capability();let room:any;
 const call=(fn:()=>any)=>withExactHalfChaosTuple(cap,()=>{room=fn();registerExactResearchRoom(room);return room;});
 call(()=>createRemoteRoom('cap-test','host','invite',1000,researchMode));
 withExactHalfChaosTuple(cap,()=>{
  assert.throws(()=>joinRemoteRoom(structuredClone(room),'guest','invite',1100),code('RESEARCH_SCOPE_INVALID'));
  assert.throws(()=>joinRemoteRoom(room,'stranger','invite',1100),code('RESEARCH_SCOPE_INVALID'));
 });
 call(()=>joinRemoteRoom(room,'guest','invite',1100).room);
 withExactHalfChaosTuple(cap,()=>assert.throws(()=>submitRemoteHeroSelection(room,'host','warrior',()=>0,1200),code('RESEARCH_SOURCE_MISMATCH')));
 call(()=>submitRemoteHeroSelection(room,'host','qin_long',()=>0,1200));call(()=>submitRemoteHeroSelection(room,'guest','warrior',()=>0,1300));
 call(()=>submitRemoteRps(room,'host','scissors',1,()=>0,1400));let draws=0;
 withExactHalfChaosTuple(cap,()=>assert.throws(()=>submitRemoteRps(room,'guest','rock',1,()=>{draws++;return 0;},1500),code('RESEARCH_SCOPE_INVALID')));
 assert.equal(draws,0);assert.equal(room.game,undefined);
});

test('exact tuple cannot gain mutation/side/disabled-package drift',()=>{
 const cap=capability(),base={mutation:'war_chariot' as const,heroes:{red:'qin_long' as const,black:'warrior' as const},heroSelections:{red:{heroId:'qin_long' as const,form:'front' as const,packageId:'qin_long:front:v1'},black:{heroId:'warrior' as const,form:'front' as const,packageId:'warrior:front:v1'}}};
 withExactHalfChaosTuple(cap,()=>{
  assert(modeResearchPermits('half_chaos',base,'cap-test'));
  for(const invalid of [{...base,mutation:'iron_steed'},{...base,heroes:{red:'warrior',black:'qin_long'}},{...base,heroes:{red:'qin_long'}},{...base,heroSelections:{...base.heroSelections,red:{...base.heroSelections.red,variant:'invincible'}}}])assert.equal(modeResearchPermits('half_chaos',invalid as any,'cap-test'),false);
 });
});

test('real session retains original authority on outsider, stale, wrong turn and duplicate requests; caller snapshots cannot mutate it',()=>{
 const s=createOriginalHalfChaosSession(initial,replay,'MA-PD01'),before=s.snapshot();
 assert.throws(()=>submitRemoteMove(before,s.binding.players.red,{actionId:'escaped',expectedRevision:before.game!.state.revision,from:{x:1,y:7},to:{x:1,y:6}},11000),code('MODE_ADAPTATION_PENDING'));
 const copy=s.snapshot();copy.game!.state.pieces=[];assert.deepEqual(s.snapshot(),before);
 assert.equal(s.step('MA-PD01:R1:main',{playerId:'outsider'}).disposition,'rejected');
 assert.equal(s.step('MA-PD01:R1:main',{expectedRevision:-1}).disposition,'rejected');
 assert.equal(s.step('MA-PD01:B1:main').disposition,'rejected');assert.deepEqual(s.snapshot(),before);
 const r=s.step('MA-PD01:R1:main');assert.equal(r.disposition,'accepted');
 const d=s.step('MA-PD01:R1:main');assert.equal(d.disposition,'accepted');assert.equal(d.duplicate,true);assert.deepEqual(d.after,r.after);assert.equal(d.events.length,0);
 assert.throws(()=>s.step('NEW:main'),/absent/);
});

function normalize(value:any,binding:any):any{
 if(typeof value==='string'){
  if(value===binding.players.red)return '<red-player>';if(value===binding.players.black)return '<black-player>';
  if(value===binding.roomId)return '<room>';
  if(value.startsWith(binding.roomId+':') || value.startsWith('system:'+binding.roomId+':') || value.startsWith('server:'+binding.roomId+':'))return value.replace(binding.roomId,'<room>').replace(binding.replayId,'<replay>');
  return value;
 }
 if(Array.isArray(value))return value.map(x=>normalize(x,binding));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[normalize(k,binding),normalize(v,binding)]));return value;
}
for(const pair of ['MA-PD05','MA-PD06'])test(`actual ${pair} paired red/black/public outputs equal after identity-only transport normalization`,()=>{
 const a=runOriginalHalfChaos(initial,replay,pair+'-A'),b=runOriginalHalfChaos(initial,replay,pair+'-B');
 assert.equal(a.status,'ORIGINAL_REQUEST_SEQUENCE_EXECUTED');assert.equal(b.status,'ORIGINAL_REQUEST_SEQUENCE_EXECUTED');
 assert.notDeepEqual(a.initial.game!.secret.identities,b.initial.game!.secret.identities);
 assert.equal(a.results.length,b.results.length);
 for(let i=0;i<a.results.length;i++)assert.deepEqual(normalize(a.results[i].views,a.binding),normalize(b.results[i].views,b.binding));
});

test('actual DS03 safety rejection retains hourglasses, body screen, revision, clock and next main',()=>{
 const r=runOriginalHalfChaos(initial,replay,'MA-DS03'),x=r.results.find(x=>x.declarationId==='MA-DS03:R4:pre-1')!;
 assert.equal(x.disposition,'rejected');assert.equal(x.error!.code,'IN_CHECK');assert.deepEqual(x.before,x.after);assert.equal(x.after.game!.state.hourglasses,5);
 assert.equal(r.results[r.results.indexOf(x)+1].disposition,'accepted');
});
test('actual DS04 B3 refusal is free; new safe B4 bomb spends one ammo/quota and preserves main/deadline',()=>{
 const r=runOriginalHalfChaos(initial,replay,'MA-DS04'),bad=r.results.find(x=>x.declarationId==='MA-DS04:B3:pre-1')!,good=r.results.find(x=>x.declarationId==='MA-DS04:B4:pre-1')!;
 assert.equal(bad.disposition,'rejected');assert.equal(bad.error!.code,'IN_CHECK');assert.deepEqual(bad.before,bad.after);
 assert.equal(good.disposition,'accepted');assert.equal(good.before.game!.state.turnDeadlineAt,good.after.game!.state.turnDeadlineAt);
 assert.deepEqual(good.after.game!.state.warps,[{x:4,y:2}]);
 const id=(good.command as any).pieceId;assert.equal(good.before.game!.state.effectsByPieceId![id].ammunition,1);assert.equal(good.after.game!.state.effectsByPieceId![id].ammunition,0);
 assert.equal(good.after.game!.secret.processedActions[`bomb:turn:black:${good.before.game!.state.formalTurns!.black}`],good.after.game!.state.revision);
 assert.equal(r.results[r.results.indexOf(good)+1].disposition,'accepted');
});
