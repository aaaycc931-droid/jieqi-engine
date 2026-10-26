import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createRemoteRoom,joinRemoteRoom,submitRemoteHeroSelection,submitRemoteRps,completeRemoteHeroIntro,
  submitRemoteHeroPreparationChoice,completeRemoteHeroPreparation,advanceRemoteRoomTime,submitRemoteMove,
  submitRemoteHeroAbility,playerRoomView,publicRemoteRoom } from '../src/remote-room.ts';
import { captureMechanismEvents } from '../src/mechanism-observer.ts';
import { applyAuthoritativeMove,applyHeroAbility,initializeFeatureGameState } from '../src/index.ts';
import { beginFormalTurn,closeDirectDeaths,destroyPiece,initializeFeatureSecret } from '../src/settlement.ts';
import { configureHeroPreparation } from '../src/hero-progress.ts';
import { gameState,move,revealed,secretState,seededRandomInt } from './helpers.ts';

// Source: handoff e6bedab, CH05 seed92, CH06 seed476 and CH07 paired oracle.
// These tests actually create rooms and submit moves; no training/failed/history injection.
function prepared(seed:number,recruit?:number) {
  let r=createRemoteRoom('H15-source-room','A','invite',1000,{baseMode:'jieqi',heroesEnabled:true,mutationsEnabled:false});
  r=joinRemoteRoom(r,'B','invite',1001).room;
  r=submitRemoteHeroSelection(r,'A','sky_admiral',undefined,1002);
  r=submitRemoteHeroSelection(r,'B','shuffler',undefined,1003);
  const random=seededRandomInt(seed);
  r=submitRemoteRps(r,'A','scissors',1,random,1004);r=submitRemoteRps(r,'B','rock',1,random,1005);
  r=completeRemoteHeroIntro(r,'A',1006);r=completeRemoteHeroIntro(r,'B',1007);
  if(recruit!==undefined)r=submitRemoteHeroPreparationChoice(r,'A',{trainingType:'cannon'},1008,seededRandomInt(recruit));
  r=completeRemoteHeroPreparation(r,'A',1009);
  return advanceRemoteRoomTime(r,undefined,1010);
}
function A(recruit=0) {
  let r=prepared(476,recruit);
  r=submitRemoteMove(r,'A',move({x:0,y:9},{x:0,y:6},'A-red1',r.game!.state.revision),5000).room;
  return r;
}
function atA(recruit=0) {
  let r=A(recruit);r=submitRemoteMove(r,'B',move({x:0,y:3},{x:0,y:4},'A-black1',r.game!.state.revision),10000).room;
  assert.equal(r.game!.state.pendingShuffle?.window,'A');return r;
}
function wash(r:ReturnType<typeof atA>,id='wash') {
  const shuffle=seededRandomInt(12),rebind=seededRandomInt(1);let calls=0;
  const c=captureMechanismEvents(()=>submitRemoteHeroAbility(r,'B',{kind:'hero_ability',ability:'shuffle',actionId:id,expectedRevision:r.game!.state.revision},12000,
    max=>{calls++;return calls<=29?shuffle(max):rebind(max);}));
  return {...c,calls};
}
const views=(r:ReturnType<typeof atA>)=>({public:publicRemoteRoom(r),red:playerRoomView(r,'A'),black:playerRoomView(r,'B')});

test('H15-01 real pregraduation death fails once without recruiting another cannon',()=>{
  const r=A(0),t=r.game!.secret.training!.red!;
  assert.equal(t.pieceId,'covered-25');assert.equal(t.failed,true);assert.equal(t.progress,1);
  assert.equal(r.game!.state.heroRuntime!.red!.used,true);
  const death=r.game!.state.captured.find(p=>p.id==='covered-25')!;
  assert.equal(death.color,'red');assert.equal(death.type,'cannon'); // Lawful capture disclosure stays public.
});
test('H15-02 same public capture with another legitimate recruitment has identical two-player projections',()=>{
  const failed=A(0),live=A(1);
  assert.equal(live.game!.secret.training!.red!.pieceId,'covered-00');assert.equal(live.game!.secret.training!.red!.failed,undefined);
  assert.deepEqual(views(failed),views(live));
  for(const v of [views(failed).red,views(failed).black])assert.equal((v.ownHeroSecrets as any)?.training,undefined);
});
test('H15-03 real A shuffle restores board but never restarts failed lineage',()=>{
  const r=atA(0),c=wash(r),s=c.result.room.game!;
  assert.equal(c.calls,29);assert.equal(s.secret.training!.red!.failed,true);
  assert.equal(s.state.heroRuntime!.red!.used,true);assert.equal(s.secret.training!.red!.progress,1);
  assert(s.state.pieces.some(p=>p.id==='covered-25'));assert.equal(s.state.turn,'red');
  assert.equal(c.events.find(e=>e.kind==='shuffle_reset')!.secret!.training!.red!.failed,true);
});
test('H15-04 active A rebind preserves progress at reset, then increments only at actual red begin',()=>{
  const r=atA(1),c=wash(r),reset=c.events.find(e=>e.kind==='shuffle_reset')!,after=c.result.room.game!;
  const t=reset.secret!.training!.red!;
  assert.equal(c.calls,30);assert.equal(t.failed,undefined);assert.equal(t.progress,1);
  assert.equal(reset.secret!.identities[t.pieceId!]!.type,'cannon');assert.equal(reset.secret!.identities[t.pieceId!]!.color,'red');
  assert.equal(after.secret.training!.red!.progress,2);
  assert(c.events.indexOf(reset)<c.events.findIndex(e=>e.kind==='formal_turn_begin'&&e.details.side==='red'));
});
test('H15-05 no opening start retains unused opportunity through H11',()=>{
  let r=prepared(476);assert.equal(r.game!.secret.training?.red,undefined);
  r=submitRemoteMove(r,'A',move({x:0,y:9},{x:0,y:6},'N-red1',r.game!.state.revision),5000).room;
  r=submitRemoteMove(r,'B',move({x:0,y:3},{x:0,y:4},'N-black1',r.game!.state.revision),10000).room;
  const c=wash(r);assert.equal(c.result.room.game!.secret.training?.red,undefined);
  assert.equal(c.result.room.game!.state.heroRuntime!.red!.used,false);assert.equal(c.calls,29);
});
test('H15-06 actual B-window death pair distinguishes hidden failure without leaking it',()=>{
  function beforeB(recruit:number){let r=prepared(92,recruit);
    r=submitRemoteMove(r,'A',move({x:1,y:7},{x:1,y:4},'B-red1',r.game!.state.revision),5000).room;
    r=submitRemoteMove(r,'B',move({x:0,y:3},{x:0,y:4},'B-black1',r.game!.state.revision),10000).room;
    r=submitRemoteHeroAbility(r,'B',{kind:'hero_ability',ability:'shuffle',skip:true,actionId:'B-skip-A',expectedRevision:r.game!.state.revision},11000).room;
    return submitRemoteMove(r,'A',move({x:1,y:4},{x:1,y:2},'B-red2',r.game!.state.revision),12000).room;}
  const dead=beforeB(1),live=beforeB(0);
  assert.equal(dead.game!.state.pendingShuffle!.window,'B');assert.equal(dead.game!.secret.training!.red!.failed,true);
  assert.equal(live.game!.secret.training!.red!.failed,undefined);assert.equal(live.game!.secret.training!.red!.pieceId,'covered-13');
  assert.deepEqual(views(dead),views(live));
  const c=wash(dead,'B-wash');assert.equal(c.result.room.game!.secret.training!.red!.failed,true);assert.equal(c.calls,29);
});
test('H15-07 a later legitimate start is free, starts at zero, keeps deadline and the normal main',()=>{
  let r=prepared(476),deadline=r.game!.state.turnDeadlineAt;
  const started=submitRemoteHeroAbility(r,'A',{kind:'hero_ability',ability:'training',trainingType:'cannon',actionId:'late-training',expectedRevision:r.game!.state.revision},2000,seededRandomInt(1)).room;
  assert.equal(started.game!.secret.training!.red!.progress,0);assert.equal(started.game!.state.formalTurns!.red,0);
  assert.equal(started.game!.state.turn,'red');assert.equal(started.game!.state.turnDeadlineAt,deadline);
  const cmd=move({x:0,y:9},{x:0,y:6},'after-training',started.game!.state.revision);
  const moved=submitRemoteMove(started,'A',cmd,5000).room;
  assert.equal(moved.game!.state.formalTurns!.red,1);assert.equal(moved.game!.secret.training!.red!.progress,0);
  assert.throws(()=>submitRemoteHeroAbility(started,'A',{kind:'hero_ability',ability:'training',trainingType:'cannon',actionId:'second-training',expectedRevision:started.game!.state.revision},2001,()=>0),(e:any)=>e.code==='SKILL_USED');
});
test('H15-08 source-exact duplicate training/shuffle does not recruit or mutate twice',()=>{
  const r=atA(1),c=wash(r),out=c.result.room;
  const cmd={kind:'hero_ability' as const,ability:'shuffle' as const,actionId:'wash',expectedRevision:r.game!.state.revision};
  const dup=submitRemoteHeroAbility(out,'B',cmd,13000,()=>{throw Error('duplicate RNG');});
  assert.equal(dup.duplicate,true);assert.deepEqual(dup.room,out);
});
test('H15-09 pregraduation death closure never samples replacement RNG',()=>{
  const state=initializeFeatureGameState(gameState([revealed('one','red','horse',0,6),revealed('two','red','horse',2,6)]),{red:'sky_admiral'}),secret=secretState();
  configureHeroPreparation(state,secret,'red',{trainingType:'horse'},()=>0);initializeFeatureSecret(state,secret);
  destroyPiece(state,secret,'one','black','component-death');let calls=0;
  closeDirectDeaths(state,secret,'black',()=>{calls++;throw Error('reroll');});
  assert.equal(calls,0);assert.equal(secret.training!.red!.failed,true);assert.equal(secret.training!.red!.pieceId,'one');
});
test('H15-10 initial original side remains distinct from a later M07 secret color',()=>{
  const state=initializeFeatureGameState(gameState([{id:'original-red',faceDown:true,x:0,y:6},{id:'original-black',faceDown:true,x:2,y:6}]),{red:'sky_admiral'},'chaos');
  const secret=secretState({'original-red':{color:'red',type:'cannon'},'original-black':{color:'black',type:'cannon'}});
  initializeFeatureSecret(state,secret);beginFormalTurn(state,secret,()=>1); // both current secret colors become black.
  const r=applyHeroAbility(state,secret,{kind:'hero_ability',ability:'training',trainingType:'cannon',actionId:'origin',expectedRevision:0},0,()=>0);
  assert.equal(r.secret.training!.red!.pieceId,'original-red');
});
test('H15-11 local and room hero-control renderer never prints trainee/progress/failure',()=>{
  const source=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function renderTransferredHeroControls'),source.indexOf('function openTransferredHeroAbility'));
  function render(room:ReturnType<typeof atA>){const texts:string[]=[],elements:any[]=[];
    const element=(tag='')=>({tag,hidden:false,style:{},append:(...xs:any[])=>{elements.push(...xs);},replaceChildren:()=>{},setAttribute:()=>{},add:()=>{},set textContent(v:string){texts.push(v);}});
    const panel=element();runInNewContext(stripTypeScriptTypes(fn)+'\nrenderTransferredHeroControls();',{
      document:{getElementById:()=>panel,createElement:element},gameState:room.game!.state,gameSecret:room.game!.secret,
      bluetooth:undefined,localPreparationActive:false,trapSetupSide:undefined,localPrivateViewerSide:'red',openingActive:false,
      getController:(p:any)=>p.color,Option:function(){},nextActionId:()=>'',runTransferredHeroCommand:()=>{},gameView:element(),
    });return texts;}
  const nextRed=(recruit:number)=>{const r=atA(recruit);return submitRemoteHeroAbility(r,'B',{kind:'hero_ability',ability:'shuffle',skip:true,actionId:'render-skip',expectedRevision:r.game!.state.revision},11000).room;};
  const dead=render(nextRed(0)),live=render(nextRed(1));assert.deepEqual(dead,live);
  assert(!dead.join('|').match(/covered-25|covered-00|私有受训|进度|失败/));
});

function timeRoom(openingStart=false) {
  let r=createRemoteRoom('H06-H15-source','A','invite',1000,{baseMode:'jieqi',heroesEnabled:true,mutationsEnabled:false});
  r=joinRemoteRoom(r,'B','invite',1001).room;r=submitRemoteHeroSelection(r,'A','nozdormu',undefined,1002);
  r=submitRemoteHeroSelection(r,'B','sky_admiral',undefined,1003);const rng=seededRandomInt(19);
  r=submitRemoteRps(r,'A','rock',1,rng,1004);r=submitRemoteRps(r,'B','scissors',1,rng,1005);
  r=completeRemoteHeroIntro(r,'A',1006);r=completeRemoteHeroIntro(r,'B',1007);
  if(openingStart)r=submitRemoteHeroPreparationChoice(r,'B',{trainingType:'cannon'},1008,seededRandomInt(1));
  r=completeRemoteHeroPreparation(r,'B',1009);return advanceRemoteRoomTime(r,undefined,1010);
}
const normal=(r:ReturnType<typeof timeRoom>,actor:string,from:number[],to:number[],id:string,at:number)=>
  submitRemoteMove(r,actor,move({x:from[0],y:from[1]},{x:to[0],y:to[1]},id,r.game!.state.revision),at).room;
const trainBlack=(r:ReturnType<typeof timeRoom>,id:string,at:number,seed=1)=>submitRemoteHeroAbility(r,'B',{
  kind:'hero_ability',ability:'training',trainingType:'cannon',actionId:id,expectedRevision:r.game!.state.revision},at,seededRandomInt(seed)).room;
const rewind=(r:ReturnType<typeof timeRoom>,at:number)=>submitRemoteHeroAbility(r,'A',{
  kind:'hero_ability',ability:'rewind',actionId:'source-rewind',expectedRevision:r.game!.state.revision},at,()=>{throw Error('No training reroll');}).room;
test('H15-12 actual H06 pre-start snapshot restores unused and later start may recruit another valid body',()=>{
  let r=timeRoom();r=normal(r,'A',[0,6],[0,5],'R1',10000);r=trainBlack(r,'start-one',11000);
  assert.equal(r.game!.secret.training!.black!.pieceId,'covered-15');
  r=normal(r,'B',[0,3],[0,4],'B1',15000);r=rewind(r,16000);
  assert.equal(r.game!.secret.training?.black,undefined);assert.equal(r.game!.state.heroRuntime!.black!.used,false);
  assert(r.messages!.some(m=>m.id==='system:training:start-one')); // Shared history survives board rewind.
  r=normal(r,'A',[0,6],[0,5],'R1-replay',17000);r=trainBlack(r,'start-after-rewind',18000,0);
  assert.equal(r.game!.secret.training!.black!.pieceId,'covered-17');assert.equal(r.game!.secret.training!.black!.progress,0);
});
test('H15-13 actual H06 continuous live snapshot restores original body and earlier progress without reroll',()=>{
  let r=timeRoom(true);r=normal(r,'A',[0,6],[0,5],'R1',10000);r=normal(r,'B',[0,3],[0,4],'B1',15000);
  r=normal(r,'A',[4,9],[4,8],'R2',20000);r=normal(r,'B',[0,4],[0,5],'B2',25000);
  assert.equal(r.game!.secret.training!.black!.progress,2);r=rewind(r,26000);
  assert.equal(r.game!.secret.training!.black!.pieceId,'covered-15');assert.equal(r.game!.secret.training!.black!.progress,1);
  assert.equal(r.game!.state.heroRuntime!.black!.used,true);
});
test('H15-14 actual trainee capture then H06 restores board while failure and used opportunity persist',()=>{
  let r=timeRoom();const actions=[
    ['A',[0,6],[0,5]],['B',[0,3],[0,4]],['A',[4,9],[4,8]],['B',[0,4],[0,5]],
    ['A',[4,8],[4,9]],['B',[0,5],[0,6]],['A',[4,9],[4,8]],['B',[0,6],[0,7]],
    ['A',[4,8],[4,9]],['B',[0,7],[0,8]],['A',[4,9],[4,8]],['B',[0,8],[0,9]],
  ] as const;
  for(let i=0;i<actions.length;i++){
    if(i===9)r=trainBlack(r,'black5-start',10000+i*5000-1000);
    const [actor,from,to]=actions[i];r=normal(r,actor,[...from],[...to],`route-${i+1}`,10000+i*5000);
  }
  assert.equal(r.game!.secret.training!.black!.failed,true);assert(r.game!.state.captured.some(p=>p.id==='covered-15'));
  r=rewind(r,66000);assert(r.game!.state.pieces.some(p=>p.id==='covered-15'));
  assert.equal(r.game!.secret.training!.black!.failed,true);assert.equal(r.game!.state.heroRuntime!.black!.used,true);
  r=normal(r,'A',[4,9],[4,8],'R6-replay',67000);assert.equal(r.game!.secret.training!.black!.failed,true);
  assert.equal(r.game!.secret.training!.black!.progress,1);
});
for(const invalid of [-1,2,0.5,NaN,Infinity])test(`H15-15 invalid recruitment index ${invalid} rejects without committing original room`,()=>{
  const r=prepared(476),before=structuredClone(r);
  const c=captureMechanismEvents(()=>{
    assert.throws(()=>submitRemoteHeroAbility(r,'A',{kind:'hero_ability',ability:'training',trainingType:'cannon',actionId:'invalid-recruit',expectedRevision:r.game!.state.revision},2000,()=>invalid),RangeError);
  });assert.deepEqual(r,before);assert.deepEqual(c.events,[]);
});
