import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createStandardNp32Session, runStandardNp32, type NpBranch } from '../scripts/research/standard-np32.ts';
import { issueOriginalStandardNpTuple, withExactStandardNpTuple, withExactHalfChaosTuple, registerExactResearchRoom,
  withResearchSources, modeResearchPermits } from '../src/research-source-context.ts';
import { createRemoteRoom, joinRemoteRoom, submitRemoteHeroSelection, submitRemoteRps, submitRemoteMove, submitRemoteAssassination } from '../src/remote-room.ts';
import { applyAuthoritativeMove, applyAuthoritativeAssassination } from '../src/game.ts';
import { isGeneralInCheck, validatePublicMove } from '../src/rules.ts';
import { captureMechanismEvents } from '../src/mechanism-observer.ts';
import { openDestructionBatches } from '../src/settlement-context.ts';
import { GAME_MODES } from '../src/modes.ts';
import { applyHeroAbility } from '../src/hero-actions.ts';
import type { AssassinationCommand, GameState } from '../src/types.ts';

const base=new URL('./fixtures/standard-np32/',import.meta.url);
const [contract,rng,guards]=['NP_CONTRACT.json','RNG_CONTRACT.json','OBSERVATION_GUARD_MATRIX.json'].map(x=>readFileSync(new URL(x,base),'utf8'));
const witnesses=JSON.parse(readFileSync(new URL('M04_SYMBOLIC_WITNESSES.json',base),'utf8')).witnesses;
const code=(s:string)=>(e:any)=>e.code===s;
const session=(branch:NpBranch='AS',options:Parameters<typeof createStandardNp32Session>[4]={})=>createStandardNp32Session(contract,rng,guards,branch,options);
const run=(b:NpBranch)=>runStandardNp32(contract,rng,guards,b);
const roomMode={baseMode:'xiangqi' as const,heroesEnabled:true,mutationsEnabled:true};
const capability=()=>issueOriginalStandardNpTuple({roomId:'np-cap-test',tupleId:'STD-NP32-AS-AP-ES',branch:'AS',players:{red:'host',black:'guest'}},contract,rng);

for(const branch of ['AS','AP','ES'] as const)test(`NP32 ${branch}: actual full 32-piece original prefix and original branch oracle`,()=>{
  const r=run(branch);
  assert.equal(r.status,'ORIGINAL_NP32_CONDITIONAL_TAPE_PREFIX_EXECUTED',JSON.stringify(r.oracleIssues));
  assert.equal(r.actualRequests,branch==='AS'?11:13);assert.equal(r.actualRequests,r.plannedRequests);
  assert.equal(r.initial.game!.state.pieces.length,32);assert(r.initial.game!.state.pieces.every(p=>!p.faceDown));
  assert.deepEqual(r.initial.game!.secret.identities,{});assert.equal(r.initial.game!.state.gameMode,'xiangqi');
  assert.equal(r.initial.game!.state.featureRules!.mutation,'war_chariot');
  assert.equal(r.initial.game!.state.heroFormLock!.black!.packageId,'devout_zealot:front:v1:invincible');
  assert.equal(r.formalOrdinaryQualification,false);assert.equal(r.productionRandomSampling,false);assert.equal(GAME_MODES.xiangqi.featuresReady,false);
  for(const x of r.results){
    assert.equal(x.disposition,'accepted');assert.equal(x.duplicate,false);assert.equal(x.evidenceValid,true);
    const before=x.before.game!.state,after=x.after.game!.state,actor=before.turn,other=actor==='red'?'black':'red';
    assert(x.now<before.turnDeadlineAt!);
    const closed=x.events.filter(e=>e.kind==='main_action_atom_closed'),settled=x.events.filter(e=>e.kind==='formal_turn_settled');
    assert.equal(closed.length,1);assert.equal(settled.length,1);
    assert.deepEqual(closed[0].state.formalTurns,before.formalTurns);
    assert.equal(settled[0].state.formalTurns![actor],before.formalTurns![actor]+1);
    assert.equal(settled[0].state.formalTurns![other],before.formalTurns![other]);
    assert.equal(settled[0].state.turnDeadlineAt,before.turnDeadlineAt); // old clock until actual next begin
    assert.equal(after.formalClock!.side,other);assert.equal(after.turnStartedAt,x.now);assert.equal(after.turnDeadlineAt,x.now+60000);
    assert.equal(x.events.filter(e=>e.kind==='formal_turn_begin').length,1);assert.equal(x.events.filter(e=>e.kind==='formal_clock_start').length,1);
  }
});

for(const branch of ['AS','AP','ES'] as const)test(`NP32 ${branch}: B1-B4 prayer, full R5 response, real B5 draw order and free main`,()=>{
  const r=run(branch),by=(t:string)=>r.results.find(x=>x.declarationId===`NP-${branch}:${t}:main`)!;
  for(let i=1;i<=4;i++){
    const x=by('B'+i),state=x.after.game!.state;
    assert.equal(state.heroRuntime!.black!.invokeCount,i);assert.equal(state.formalTurns!.black,i);
    assert.equal(state.heroRuntime!.black!.descended,undefined);assert.equal(x.drawCount,1);
    assert.equal(state.lastMove!.classification!.opportunity,'main');assert(state.lastMove!.keywords!.includes('占步'));
  }
  assert.equal(by('B4').after.game!.state.heroRuntime!.black!.omen,true);
  const r5=by('R5'),settled=r5.events.findIndex(e=>e.kind==='formal_turn_settled'),firstDraw=r5.events.findIndex(e=>e.kind==='authority_random_draw');
  const begin=r5.events.findIndex(e=>e.kind==='formal_turn_begin'&&e.details.side==='black');
  assert(settled<firstDraw&&firstDraw<begin);assert.equal(r5.events[settled].state.heroRuntime!.black!.descended,undefined);
  assert.equal(r5.events[settled].state.formalTurns!.red,5);
  const draws=r5.events.filter(e=>e.kind==='authority_random_draw');assert.equal(draws.length,4);
  assert.deepEqual(draws.map(e=>e.details.maxExclusive),[15,14,13,12]);
  assert.deepEqual(draws[0].details.orderedCandidateIds,Array.from({length:15},(_,i)=>`covered-${String(i).padStart(2,'0')}`));
  const expected=branch==='AP'?['covered-10','covered-02','covered-03','covered-07']:['covered-01','covered-02','covered-03','covered-07'];
  assert.deepEqual(draws.map(e=>e.details.selectedId),expected);
  const after=r5.after.game!.state;assert.equal(after.heroRuntime!.black!.descended,true);assert.equal(after.heroRuntime!.black!.omen,undefined);
  assert.equal(after.formalTurns!.black,4);assert.equal(after.turnLifecycle!.phase,'before_main');assert.equal(after.turnLifecycle!.number,5);
  assert.equal(by('B5').after.game!.state.formalTurns!.black,5);assert.equal(by('B5').drawCount,5);
});

test('NP32 client JSON and legacy general source scopes never enable the product tuple',()=>{
  assert.equal(modeResearchPermits('xiangqi'),false);assert.equal(GAME_MODES.xiangqi.featuresReady,false);
  assert.throws(()=>createRemoteRoom('wire','host','invite',1000,{...roomMode,research:true,tupleId:'STD-NP32-AS-AP-ES'} as any),code('MODE_ADAPTATION_PENDING'));
  withResearchSources({roomId:'legacy',mode:'xiangqi',actors:{host:{hero:'rogue',enabled:true},guest:{hero:'shuffler',enabled:true}}},()=>{
    assert.equal(modeResearchPermits('xiangqi',{heroes:{red:'rogue',black:'devout_zealot'},mutation:'war_chariot'}),false);
    assert.throws(()=>withExactStandardNpTuple(capability(),()=>null),code('RESEARCH_SCOPE_INVALID'));
  });
});
test('NP32 immutable contract, RNG and observation sources reject any local tampering',()=>{
  for(const texts of [[contract+' ',rng,guards],[contract,rng+' ',guards],[contract,rng,guards+' ']])assert.throws(()=>createStandardNp32Session(texts[0],texts[1],texts[2],'AS'),/immutable source/);
  assert.throws(()=>createStandardNp32Session(contract,rng,guards,'NEW' as any),/source\/branch mismatch/);
});
test('NP32 capabilities reject copies, cross-mode nesting, foreign room and asynchronous use; finally clears',()=>{
  const cap=capability();
  assert.throws(()=>withExactStandardNpTuple(JSON.parse(JSON.stringify(cap)),()=>null),code('RESEARCH_SCOPE_INVALID'));
  assert.throws(()=>withExactHalfChaosTuple(cap as any,()=>null),code('RESEARCH_SCOPE_INVALID'));
  withExactStandardNpTuple(cap,()=>{
    assert.throws(()=>withExactStandardNpTuple(cap,()=>null),code('RESEARCH_SCOPE_INVALID'));
    assert.throws(()=>createRemoteRoom('foreign','host','invite',1000,roomMode),code('RESEARCH_SCOPE_INVALID'));
    assert.throws(()=>createRemoteRoom('np-cap-test','host','invite',1000,{...roomMode,baseMode:'half_chaos'}),code('MODE_ADAPTATION_PENDING'));
    assert.throws(()=>createRemoteRoom('np-cap-test','guest','invite',1000,roomMode),code('RESEARCH_SCOPE_INVALID'));
    assert.throws(()=>createRemoteRoom('np-cap-test','host','invite',1000,{...roomMode,mutationsEnabled:false}),code('RESEARCH_SCOPE_INVALID'));
  });
  assert.throws(()=>withExactStandardNpTuple(cap,()=>Promise.resolve()),/synchronous/);
  assert.throws(()=>withExactStandardNpTuple(cap,()=>{throw Error('stop');}),/stop/);
  assert.equal(modeResearchPermits('xiangqi'),false);
});
test('NP32 pre-RPS package selection and actual assignments reject drift before the first draw',()=>{
  const cap=capability();let room:any;
  const call=(fn:()=>any)=>withExactStandardNpTuple(cap,()=>{room=fn();registerExactResearchRoom(room);return room;});
  call(()=>createRemoteRoom('np-cap-test','host','invite',1000,roomMode));
  withExactStandardNpTuple(cap,()=>{
    assert.throws(()=>joinRemoteRoom(structuredClone(room),'guest','invite',1100),code('RESEARCH_SCOPE_INVALID'));
    assert.throws(()=>joinRemoteRoom(room,'outsider','invite',1100),code('RESEARCH_SCOPE_INVALID'));
  });
  call(()=>joinRemoteRoom(room,'guest','invite',1100).room);
  let draws=0;const random=()=>{draws++;return 3;};const before=structuredClone(room);
  withExactStandardNpTuple(cap,()=>{
    assert.throws(()=>submitRemoteHeroSelection(room,'host','warrior',random,1200),code('RESEARCH_SOURCE_MISMATCH'));
    assert.throws(()=>submitRemoteHeroSelection(room,'guest','devout_zealot',random,1200),code('RESEARCH_SOURCE_MISMATCH'));
    assert.throws(()=>submitRemoteHeroSelection(room,'guest','devout_zealot',random,1200,{variant:'nightmare'}),code('RESEARCH_SOURCE_MISMATCH'));
  });assert.deepEqual(room,before);assert.equal(draws,0);
  call(()=>submitRemoteHeroSelection(room,'host','rogue',random,1200));
  call(()=>submitRemoteHeroSelection(room,'guest','devout_zealot',random,1300,{variant:'invincible'}));
  call(()=>submitRemoteRps(room,'host','scissors',1,random,1400));
  withExactStandardNpTuple(cap,()=>assert.throws(()=>submitRemoteRps(room,'guest','rock',1,random,1500),code('RESEARCH_SCOPE_INVALID')));
  assert.equal(draws,0);assert.equal(room.game,undefined);
});
test('NP32 snapshot isolation, outsiders, stale versions, wrong actor and escaped assassination entry',()=>{
  const s=session(),before=s.snapshot(),copy=s.snapshot();copy.game!.state.pieces=[];
  assert.deepEqual(s.snapshot(),before);
  assert.equal(s.step('NP-AS:R1:main',{playerId:'outsider'}).disposition,'rejected');
  assert.equal(s.step('NP-AS:R1:main',{expectedRevision:-1}).disposition,'rejected');
  assert.equal(s.step('NP-AS:B1:main').disposition,'rejected');assert.deepEqual(s.snapshot(),before);
  assert.throws(()=>submitRemoteMove(s.snapshot(),s.binding.players.red,{actionId:'escaped',expectedRevision:0,from:{x:0,y:6},to:{x:0,y:5}},11000),code('MODE_ADAPTATION_PENDING'));
  assert.throws(()=>submitRemoteAssassination(s.snapshot(),s.binding.players.red,{kind:'assassination',source:'hero',actionId:'escaped-assassination',expectedRevision:0,from:{x:0,y:9},to:{x:0,y:8}},11000),code('MODE_ADAPTATION_PENDING'));
  assert.throws(()=>s.step('NEW'),/absent/);
});
test('NP32 actual R5 descent RNG exception refuses entire normal move without state or observer commit',()=>{
  const s=session('AS',{failDescent:true});for(const d of s.declarations.slice(0,8))assert.equal(s.step(d.id).disposition,'accepted');
  const before=s.snapshot();assert.equal(before.game!.state.heroRuntime!.black!.omen,true);
  const c=captureMechanismEvents(()=>s.step('NP-AS:R5:main'));
  assert.equal(c.result.disposition,'rejected');assert.equal(c.result.error!.name,'RangeError');assert.deepEqual(c.result.before,c.result.after);
  assert.deepEqual(c.events,[]);assert.deepEqual(s.snapshot(),before);assert.equal(s.draws().length,1);
});
test('NP32 actual R5 duplicate does not redraw, repeat begin, change revision or refresh clock',()=>{
  const s=session();for(const d of s.declarations.slice(0,9))assert.equal(s.step(d.id).disposition,'accepted');
  const before=s.snapshot(),draws=s.draws(),duplicate=s.step('NP-AS:R5:main');
  assert.equal(duplicate.disposition,'accepted');assert.equal(duplicate.duplicate,true);
  assert.deepEqual(duplicate.events,[]);assert.deepEqual(s.draws(),draws);assert.deepEqual(s.snapshot(),before);
});

function normalize(v:any,binding:any):any{
  if(typeof v==='string'){
    if(v===binding.players.red)return '<red-player>';if(v===binding.players.black)return '<black-player>';
    return v.replaceAll(binding.roomId,'<room>');
  }
  if(Array.isArray(v))return v.map(x=>normalize(x,binding));
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[normalize(k,binding),normalize(x,binding)]));return v;
}
for(const branch of ['AS','AP','ES'] as const)test(`NP32 ${branch}: observation on/off preserves every returned authority and exact RNG calls`,()=>{
  const a=session(branch),b=session(branch,{withoutObservation:true});
  for(const d of a.declarations){
    const x=a.step(d.id),y=b.step(d.id);assert.equal(y.disposition,'accepted');assert.deepEqual(y.events,[]);
    assert.deepEqual(normalize(x.after,a.binding),normalize(y.after,b.binding));assert.deepEqual(a.draws(),b.draws());
  }
});
test('NP32 actual player/public views contain no authority RNG receipts or private source maps',()=>{
  for(const branch of ['AS','AP','ES'] as const)for(const x of run(branch).results){
    const text=JSON.stringify(x.views);
    for(const key of ['authority_random_draw','orderedCandidateIds','destinyIdentities','processedActions','trainingOriginalSides','"identities"'])assert(!text.includes(key),key);
    assert.equal((x.views.red as any).viewerSide,'red');assert.equal((x.views.black as any).viewerSide,'black');
  }
});

// These four separately sourced symbolic fixtures are component evidence only.
// They are never admitted as a natural NP32 state or a real-room replay.
function symbolic(w:any,kind:'move'|'activation'|'continuing'){
  const initial=session().initial;const state=structuredClone(initial.game!.state),secret=structuredClone(initial.game!.secret);
  state.pieces=w.pieces.map(({id,color,type,x,y}:any)=>({id,color,type,x,y,faceDown:false}));
  state.effectsByPieceId={};state.captured=[];state.revision=0;state.turn='red';state.status='playing';
  delete state.turnLifecycle;delete secret.formalStart;
  state.formalTurns={red:kind==='continuing'?6:0,black:kind==='continuing'?6:0};
  for(const p of w.pieces)if(p.dragonScale)state.effectsByPieceId![p.id]={dragonScale:p.dragonScale,dragonClaw:true};
  if(kind==='continuing'){
    state.assassination!.red.heroChargeAvailable=false;state.assassination!.red.activePieceId=w.input.attackerRookId;
    state.effectsByPieceId![w.input.attackerRookId]={stealth:{owner:'red',remainingOwnerTurns:2,activatedOnFormalTurn:6,strongStrikeAvailable:true,source:'hero'}};
  }
  const move={actionId:'synthetic:'+w.id+':'+kind,expectedRevision:0,pieceId:w.input.attackerRookId,from:{x:w.input.source[0],y:w.input.source[1]},to:{x:w.input.destination[0],y:w.input.destination[1]}};
  const command={...move,kind:'assassination' as const,...(kind==='continuing'?{useStrongStrike:true}:{source:'hero' as const})};
  const cap=capability();
  return {state,secret,move,command,execute:()=>withExactStandardNpTuple(cap,()=>kind==='move'?applyAuthoritativeMove(state,secret,move):applyAuthoritativeAssassination(state,secret,command))};
}
for(const w of witnesses.slice(0,2))for(const kind of ['move','activation','continuing'] as const)test(`NP32 symbolic ${w.id}/${kind}: unsafe closed path/endpoint/return rejects original candidate`,()=>{
  const a=symbolic(w,kind),before=structuredClone({state:a.state,secret:a.secret});
  assert.equal(isGeneralInCheck(a.state,'red'),false);
  assert.equal(validatePublicMove(a.state,a.move,'red',{allowStealthSource:kind==='continuing',requireCapture:kind==='continuing'}).ok,true);
  const c=captureMechanismEvents(()=>assert.throws(a.execute,code('SELF_CHECK')));
  assert.deepEqual(c.events,[]);assert.deepEqual({state:a.state,secret:a.secret},before);
});
for(const w of witnesses.slice(2))for(const kind of ['move','activation','continuing'] as const)test(`NP32 symbolic ${w.id}/${kind}: shield-survival or enemy-check control remains legal`,()=>{
  const a=symbolic(w,kind),r=a.execute();assert.equal(isGeneralInCheck(r.state,'red'),false);
  if(w.input.pathShield){assert(r.state.pieces.some(p=>p.id===w.input.victimId));assert(!r.state.captured.some(p=>p.id===w.input.victimId));assert.equal(isGeneralInCheck(r.state,'black'),false);}
  else {assert.equal(isGeneralInCheck(r.state,'black'),true);assert.equal(r.state.captured.filter(p=>p.id===w.input.victimId).length,1);}
});
test('NP32 original authority open batch refuses both main and assassination before cloning',()=>{
  for(const kind of ['move','activation','continuing'] as const){
    const a=symbolic(witnesses[2],kind),before=structuredClone({state:a.state,secret:a.secret});
    openDestructionBatches.set(a.state,{batchId:'unclosed',targets:[]});
    try {assert.throws(a.execute,code('DESTRUCTION_BATCH_OPEN'));}finally{openDestructionBatches.delete(a.state);}
    assert.deepEqual({state:a.state,secret:a.secret},before);
  }
});

for(const shield of [false,true])for(const kind of ['move','activation','continuing'] as const)test(`NP32 synthetic checking path rook removal/${kind}/endpoint scale=${shield}: real closure resolves check`,()=>{
  const w={id:'checking-path-rook',input:{attackerRookId:'covered-15',source:[0,7],destination:[6,7]},pieces:[
    {id:'red-general',color:'red',type:'general',x:4,y:9},
    {id:'black-general',color:'black',type:'general',x:4,y:0},
    {id:'covered-15',color:'red',type:'rook',x:0,y:7},
    {id:'covered-00',color:'black',type:'rook',x:4,y:7},
    {id:'covered-27',color:'red',type:'pawn',x:4,y:4},
    {id:'covered-01',color:'black',type:'horse',x:6,y:7,...(shield?{dragonScale:1}:{})},
  ]};
  const a=symbolic(w,kind);assert.equal(isGeneralInCheck(a.state,'red'),true);
  assert.equal(validatePublicMove(a.state,a.move,'red',{allowStealthSource:kind==='continuing',requireCapture:kind==='continuing'}).code,'SELF_CHECK');
  const r=a.execute();assert.equal(isGeneralInCheck(r.state,'red'),false);
  assert.equal(r.state.captured.filter(p=>p.id==='covered-00').length,1);
  assert.equal(r.state.lastMove!.landed,!shield);assert.equal(r.state.formalTurns!.red,kind==='continuing'?7:1);
});
test('NP32 actual R5 timeout ends match before any B5 descent or extra random calls',()=>{
  const s=session();for(const d of s.declarations.slice(0,8))assert.equal(s.step(d.id).disposition,'accepted');
  const before=s.snapshot(),x=s.step('NP-AS:R5:main',{now:before.game!.state.turnDeadlineAt});
  assert.equal(x.after.phase,'finished');assert.equal(x.after.game!.state.reason,'timeout');
  assert.equal(x.after.game!.state.heroRuntime!.black!.descended,undefined);
  assert.equal(x.after.game!.state.formalTurns!.red,4);assert.equal(s.draws().length,1);
  assert(!x.events.some(e=>e.kind==='authority_random_draw'||e.kind==='formal_turn_begin'));
});
test('NP32 symbolic H21 prayer while checked refuses before resource or formal-counter mutation',()=>{
  const a=symbolic(witnesses[3],'move'),r=a.execute();assert.equal(isGeneralInCheck(r.state,'black'),true);
  const before=structuredClone(r),cap=capability();
  withExactStandardNpTuple(cap,()=>assert.throws(()=>applyHeroAbility(r.state,r.secret,{kind:'hero_ability',ability:'invoke',actionId:'checked-invoke',expectedRevision:r.state.revision},12000,()=>{throw Error('unexpected RNG');}),code('IN_CHECK')));
  assert.deepEqual(r,before);
});
test('NP32 synthetic deliberate own-general path death keeps its original terminal result',()=>{
  const a=symbolic(witnesses[2],'move');a.state.pieces=[
    {id:'red-general',faceDown:false,color:'red',type:'general',x:4,y:8},
    {id:'black-general',faceDown:false,color:'black',type:'general',x:5,y:0},
    {id:'covered-15',faceDown:false,color:'red',type:'rook',x:0,y:8},
    {id:'covered-01',faceDown:false,color:'black',type:'horse',x:6,y:8},
  ];a.state.effectsByPieceId={}; // synthetic source-terminal component; not a reachable NP32 board
  a.move.from={x:0,y:8};a.move.to={x:6,y:8};
  const c=captureMechanismEvents(a.execute);assert.equal(c.result.state.status,'finished');assert.equal(c.result.state.winner,'black');
  assert.equal(c.events.find(e=>e.kind==='main_action_atom_closed')!.details.sourceTerminal,true);
  assert(!c.events.some(e=>e.kind==='formal_turn_settled'));
});
