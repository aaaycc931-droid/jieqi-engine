import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteRoom,joinRemoteRoom,submitRemoteHeroSelection,submitRemoteRps,completeRemoteHeroIntro,
  advanceRemoteRoomTime,submitRemoteMove,submitRemoteHeroAbility,disconnectRemotePlayer,reconnectRemotePlayer } from '../src/remote-room.ts';
import { captureMechanismEvents } from '../src/mechanism-observer.ts';
import { move,seededRandomInt } from './helpers.ts';
import type { HeroId } from '../src/types.ts';

// Actual existing jieqi room setup and two accepted ordinary moves; not H15 or HC acceptance.
function blackFirst(redHero:HeroId='qin_long') {
  let r=createRemoteRoom('H11-clock','A','invite',1000,{baseMode:'jieqi',heroesEnabled:true,mutationsEnabled:false});
  r=joinRemoteRoom(r,'B','invite',1001).room;
  r=submitRemoteHeroSelection(r,'A',redHero,undefined,1002);
  r=submitRemoteHeroSelection(r,'B','shuffler',undefined,1003);
  const rng=seededRandomInt(19);
  r=submitRemoteRps(r,'A','scissors',1,rng,1004);
  r=submitRemoteRps(r,'B','rock',1,rng,1005);
  r=completeRemoteHeroIntro(r,'A',1006);r=completeRemoteHeroIntro(r,'B',1007);
  r=advanceRemoteRoomTime(r,undefined,1008);
  assert.equal(r.phase,'playing');assert.deepEqual(r.game!.players,{red:'A',black:'B'});
  r=submitRemoteMove(r,'A',move({x:0,y:6},{x:0,y:5},'red-1'),10000).room;
  r=advanceRemoteRoomTime(r,undefined,10000);
  assert.equal(r.game!.state.turn,'black');assert.equal(r.game!.state.turnDeadlineAt,redHero==='murozond_minion'?55000:70000);
  return r;
}
function pending() {
  const r=blackFirst(),rev=r.game!.state.revision;
  const result=submitRemoteMove(r,'B',move({x:0,y:3},{x:0,y:4},'black-1',rev),30000).room;
  assert.equal(result.game!.state.pendingShuffle?.window,'A');
  return result;
}
const choice=(r:ReturnType<typeof pending>,id:string,skip=false)=>({kind:'hero_ability' as const,ability:'shuffle' as const,
  actionId:id,expectedRevision:r.game!.state.revision,skip});
test('H11A01 real black first move retains original 10000..70000 clock and does not restart',()=>{
  const r=pending();assert.equal(r.game!.state.turnStartedAt,10000);assert.equal(r.game!.state.turnDeadlineAt,70000);
  const before=structuredClone(r),t=advanceRemoteRoomTime(r,undefined,40000);
  assert.equal(t.game!.state.turnDeadlineAt,70000);assert.deepEqual(r,before);
  assert.equal(t.game!.state.formalTurns!.black,1);
});
test('H11A02 accepted choice at 69999 finishes reset and starts a fresh red turn immediately',()=>{
  const r=pending(),rng=seededRandomInt(12),cmd=choice(r,'wash');
  const c=captureMechanismEvents(()=>submitRemoteHeroAbility(r,'B',cmd,69999,rng));
  const s=c.result.room.game!.state;
  assert.equal(s.heroRuntime!.black!.used,true);assert.equal(s.turn,'red');assert.equal(s.pendingShuffle,undefined);
  assert.equal(s.turnStartedAt,69999);assert.equal(s.turnDeadlineAt,129999);
  assert.equal(s.formalTurns!.black,1);
  assert.equal(c.events.filter(e=>e.kind==='shuffle_reset').length,1);
});
for(const at of [70000,71000])test(`H11A03 late activation at ${at} auto-declines without losing completed main`,()=>{
  const r=pending(),before=structuredClone(r);let calls=0;
  const next=submitRemoteHeroAbility(r,'B',choice(r,'late'),at,()=>{calls++;throw Error('No late shuffle RNG');}).room;
  assert.equal(next.phase,'playing');assert.equal(next.game!.state.turn,'red');assert.equal(next.game!.state.pendingShuffle,undefined);
  assert.equal(next.game!.state.heroRuntime!.black!.used,false);
  assert.equal(next.game!.state.heroRuntime!.black!.shuffleWindow,'B');
  assert.equal(next.game!.state.formalTurns!.black,1);assert.equal(next.game!.state.reason,undefined);
  assert(next.game!.state.pieces.some(p=>p.id==='covered-10'&&p.x===0&&p.y===4));
  assert.equal(next.game!.secret.processedActions.late,undefined);assert.equal(calls,0);assert.deepEqual(r,before);
  assert.equal(next.game!.state.turnDeadlineAt,at+60000);
});
test('H11A04 time tick auto-declines and does not replay black begin/main/end',()=>{
  const r=pending();const c=captureMechanismEvents(()=>advanceRemoteRoomTime(r,undefined,70000));
  assert.equal(c.result.phase,'playing');assert.equal(c.result.game!.state.turn,'red');
  assert.equal(c.result.game!.state.heroRuntime!.black!.shuffleWindow,'B');
  assert(!c.events.some(e=>['formal_turn_begin','formal_main_action','formal_turn_end','formal_turn_settled'].includes(e.kind)&&e.details.side==='black'));
  assert.equal(c.events.filter(e=>e.kind==='formal_turn_begin'&&e.details.side==='red').length,1);
});
test('H11A05 manual decline hands off immediately and removes the old A clock',()=>{
  const r=pending(),next=submitRemoteHeroAbility(r,'B',choice(r,'decline',true),35000).room;
  assert.equal(next.game!.state.turn,'red');assert.equal(next.game!.state.turnDeadlineAt,95000);
  assert.equal(next.game!.state.heroRuntime!.black!.shuffleWindow,'B');
  assert.equal(next.game!.state.formalTurns!.black,1);
});
test('H11A06 main not completed at deadline keeps ordinary timeout rule',()=>{
  const r=blackFirst(),rev=r.game!.state.revision;
  const late=submitRemoteMove(r,'B',move({x:0,y:3},{x:0,y:4},'too-late-main',rev),70000).room;
  assert.equal(late.phase,'finished');assert.equal(late.game!.state.reason,'timeout');assert.equal(late.game!.state.winner,'red');
  assert.equal(late.game!.state.pendingShuffle,undefined);assert.equal(late.game!.secret.processedActions['too-late-main'],undefined);
});
test('H11A07 failed and duplicate requests do not refresh the A deadline',()=>{
  const r=pending(),before=structuredClone(r);
  assert.throws(()=>submitRemoteHeroAbility(r,'B',{...choice(r,'stale'),expectedRevision:r.game!.state.revision+1},40000), (e:any)=>e.code==='STALE_REVISION');
  assert.deepEqual(r,before);
  const duplicate=submitRemoteMove(r,'B',move({x:0,y:3},{x:0,y:4},'black-1',1),40000);
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.room.game!.state.turnDeadlineAt,70000);
});
test('H11A08 disconnect pause shifts inherited A deadline rather than giving a new decision clock',()=>{
  let r=pending();r=disconnectRemotePlayer(r,'A',40000);
  r=advanceRemoteRoomTime(r,undefined,80000);assert.equal(r.game!.state.pendingShuffle!.window,'A');
  r=reconnectRemotePlayer(r,'A',90000);
  assert.equal(r.game!.state.turnDeadlineAt,120000);
  assert.equal(advanceRemoteRoomTime(r,undefined,119999).game!.state.pendingShuffle?.window,'A');
  assert.equal(advanceRemoteRoomTime(r,undefined,120000).game!.state.turn,'red');
});
test('H11A09 inherited 45-second source duration is not normalized to 60 seconds',()=>{
  let r=blackFirst('murozond_minion');
  r=submitRemoteMove(r,'B',move({x:0,y:3},{x:0,y:4},'short-black',r.game!.state.revision),30000).room;
  assert.equal(r.game!.state.pendingShuffle?.window,'A');assert.equal(r.game!.state.turnDeadlineAt,55000);
  assert.equal(advanceRemoteRoomTime(r,undefined,54999).game!.state.pendingShuffle?.window,'A');
  const expired=advanceRemoteRoomTime(r,undefined,55000);
  assert.equal(expired.phase,'playing');assert.equal(expired.game!.state.turn,'red');
  assert.equal(expired.game!.state.turnDeadlineAt,130000); // red's own existing 75s source.
});
