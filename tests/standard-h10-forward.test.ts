import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareStandardH10Forward, replayStandardH10Forward, advanceStandardH10Forward, h10ForwardCommand, h10ForwardSources, H10_FORWARD_MAPPING, h10ForwardViews } from '../scripts/research/standard-h10-forward.ts';
import { issueOriginalStandardH10Forward, withExactStandardH10Forward, issueOriginalStandardH10Preparation, withExactStandardH10Preparation } from '../src/research-source-context.ts';
import { submitRemoteMove, submitRemoteAssassination, submitRemoteHeroAbility, advanceRemoteRoomTime, disconnectRemotePlayer } from '../src/remote-room.ts';
import { applyAuthoritativeAssassination, supportsClosedPublicPathQuery } from '../src/game.ts';
import { isGeneralInCheck } from '../src/rules.ts';
import { captureMechanismEvents } from '../src/mechanism-observer.ts';
import { GAME_MODES } from '../src/modes.ts';
const s = prepareStandardH10Forward();
const A = replayStandardH10Forward(s,'A'), B = replayStandardH10Forward(s,'B');
const coverage = (e: any) => e.name === 'WindPreparationCoverageError';
const code = (c: string) => (e: any) => e.code === c;
const at = (i: number, world: 'A'|'B' = 'A') => (world === 'A' ? A : B).steps[i].after;
// Trace copies are evidence, not registered authority; use actual API results.
const before = (i: number, world: 'A'|'B' = 'A') => {
  let room = s.worlds[world]; for (let j = 0; j < i; j++) room = advanceStandardH10Forward(s,room,j); return room;
};

test('H10F-01 original aliases bind real full32 bodies and natural offer, no state injection', () => {
  const state = s.prepared.game!.state;
  assert.equal(state.pieces.length,32); assert(state.pieces.every(p=>!p.faceDown));
  const positions: Record<string, number[]> = {red_pawn_0:[0,6],black_horse_1:[1,0],black_pawn_8:[8,3],black_pawn_6:[6,3],red_rook_0:[0,9],black_pawn_0:[0,3],black_pawn_2:[2,3],black_horse_7:[7,0]};
  for (const [alias,id] of Object.entries(H10_FORWARD_MAPPING)) { const p=state.pieces.find(p=>p.id===id)!; assert.deepEqual([p.x,p.y],positions[alias]); }
  assert(s.attempts.length <= 512); for (const a of s.attempts) { assert.deepEqual(a.draws.map(d=>d.bound),[15,14,13]); assert.equal(new Set(a.candidates).size,3); }
  assert(s.attempts.at(-1)!.candidates.includes('covered-10')); assert(s.attempts.at(-1)!.candidates.includes('covered-11'));
  for (const w of ['A','B'] as const) { assert.equal(s.worlds[w].game!.secret.wind!.black!.hostId,w==='A'?'covered-10':'covered-11'); assert.deepEqual(s.worlds[w].game!.state,state); }
});
test('H10F-02 both worlds execute original eight requests with same public projections and safe public royals', () => {
  assert.deepEqual(h10ForwardViews(s.worlds.A),h10ForwardViews(s.worlds.B));
  for(let i=0;i<8;i++) {
    assert.deepEqual(A.steps[i].views,B.steps[i].views);
    for(const w of [A,B]) { assert.deepEqual(w.steps[i].publicCheck,{red:false,black:false}); assert.equal(w.steps[i].after.game.state.revision,i+1); assert.equal(w.steps[i].after.game.state.status,'playing'); }
  }
});
test('H10F-03 R4 activation and R5 subsequent opportunity keep original source and no AS refund', () => {
  for(const w of [A,B]) {
    const st=w.steps[6].after.game.state;
    assert.equal(st.assassination.red.heroChargeAvailable,false); assert.equal(st.assassination.red.activePieceId,'covered-15');
    assert.equal(st.effectsByPieceId['covered-15'].stealth.activatedOnFormalTurn,4);
    assert.equal(st.effectsByPieceId['covered-15'].stealth.remainingOwnerTurns,2);
    assert.equal(w.final.game!.state.assassination!.red.heroChargeAvailable,false);
  }
});
test('H10F-04 O1/O2/O4 actual R5 path and endpoint commit once, with landing and closed batch', () => {
  for(const w of [A,B]) {
    const st=w.final.game!.state, k=w.final.game!.secret;
    assert.equal(st.revision,9); assert.equal(k.processedActions['h10-forward-8'],9);
    assert.deepEqual(st.lastMove!.pathCrushed!.map(p=>[p.id,p.cause]),[['covered-10','crush']]);
    assert.equal(st.lastMove!.captured!.id,'covered-01'); assert.equal(st.lastMove!.captured!.cause,'assassination');
    const rook=st.pieces.find(p=>p.id==='covered-15')!; assert.deepEqual([rook.x,rook.y],[0,2]);
    assert.equal(st.lastMove!.landed,true); assert.equal(st.pieces.length,30);
    assert.equal(st.captured.length,2); assert(!st.pieces.some(p=>['covered-10','covered-01'].includes(p.id)));
    assert.deepEqual(st.landingEvents,[]); assert.deepEqual(st.destructionBatches,[]);
  }
});
test('H10F-05 O3/O6 host death decides A; decoy survives; B host and game survive', () => {
  assert.equal(A.final.phase,'finished'); assert.equal(A.final.game!.state.winner,'red'); assert.equal(A.final.game!.state.reason,'crush_them');
  assert.equal(B.final.phase,'playing'); assert.equal(B.final.game!.state.winner,undefined);
  for(const w of [A,B]) { const g=w.final.game!; assert(g.state.pieces.some(p=>p.id===g.secret.wind!.black!.decoyId)); assert.equal(isGeneralInCheck(g.state,'red'),false); }
  assert(B.final.game!.state.pieces.some(p=>p.id==='covered-11'));
  assert.deepEqual(A.final.game!.state.formalTurns,{red:4,black:4}); assert.deepEqual(B.final.game!.state.formalTurns,{red:5,black:4});
  assert.deepEqual(A.steps[8].events.map((e:any)=>e.kind),['formal_main_action','main_action_atom_closed']);
  assert(B.steps[8].events.some((e:any)=>e.kind==='formal_turn_settled'));
});
test('H10F-06 O5 reproduced terminal residue is cleared in return AND immutable atom checkpoint', () => {
  for(const w of [A,B]) {
    for(const state of [w.final.game!.state,...w.steps[8].events.filter((e:any)=>e.kind==='main_action_atom_closed').map((e:any)=>e.state)]) {
      assert.equal(state.assassination.red.activePieceId,undefined); assert.equal(state.effectsByPieceId['covered-15']?.stealth,undefined);
      assert.equal(state.assassination.red.heroChargeAvailable,false);
    }
  }
});
test('H10F-07 O7 same body/cause/position, different terminal representation is not a second death', () => {
  const st=A.final.game!.state, death=st.automaticEvents!.find(e=>e.kind==='destroy:crush')!;
  assert.equal(st.captured[0].type,'general'); assert.equal(death.deathRecord!.type,'pawn');
  assert.equal(death.pieceId,st.captured[0].id); assert.equal(death.deathRecord!.cause,st.captured[0].cause); assert.deepEqual(death.position,st.captured[0].position);
  assert.equal(st.automaticEvents!.filter(e=>e.pieceId==='covered-10'&&e.kind.startsWith('destroy:')).length,1);
});
test('H10F-08 O8 observation off and failed projector preserve both actual authorities', () => {
  for(const world of ['A','B'] as const) {
    const expected=world==='A'?A:B, off=replayStandardH10Forward(s,world,false), failed=replayStandardH10Forward(s,world,true,true);
    assert.deepEqual(expected.final,off.final); assert.deepEqual(expected.final,failed.final);
    assert(failed.steps.every(x=>x.evidenceValid===false&&x.events.length===0));
  }
});
test('H10F-09 O9 exact B replay has no double death; A finished request rejected without mutation', () => {
  const cmd=h10ForwardCommand(8), originalA=structuredClone(A.final),originalB=structuredClone(B.final);
  const result=withExactStandardH10Forward(s.cap,()=>submitRemoteAssassination(B.final,s.players.red,cmd as any,11000));
  assert.equal(result.duplicate,true); assert.strictEqual(result.room,B.final); assert.deepEqual(B.final,originalB);
  assert.throws(()=>withExactStandardH10Forward(s.cap,()=>submitRemoteAssassination(A.final,s.players.red,cmd as any,11000)),code('INVALID_PHASE'));
  assert.deepEqual(A.final,originalA);
});
test('H10F-10 original T0 capability and cross-capability room remain rejected', () => {
  const [p,c,a]=h10ForwardSources();
  const ctx={roomId:s.prepared.roomId,players:s.players,tupleId:'STD-H10-PREPARATION' as const};
  const cap=issueOriginalStandardH10Preparation(ctx,p,c);
  assert.throws(()=>withExactStandardH10Preparation(cap,()=>submitRemoteMove(s.worlds.A,s.players.red,h10ForwardCommand(0))),code('RESEARCH_SCOPE_INVALID'));
  const other=issueOriginalStandardH10Forward({...ctx,tupleId:'STD-H10-FORWARD-PREFIX'},p,c,a);
  assert.throws(()=>withExactStandardH10Forward(other,()=>submitRemoteMove(s.worlds.A,s.players.red,h10ForwardCommand(0))),code('RESEARCH_SCOPE_INVALID'));
  assert.throws(()=>withExactStandardH10Forward({...s.cap},()=>0),code('RESEARCH_SCOPE_INVALID'));
});
test('H10F-11 all three original source bodies are mandatory', () => {
  const [p,c,a]=h10ForwardSources(),ctx={roomId:s.prepared.roomId,players:s.players,tupleId:'STD-H10-FORWARD-PREFIX' as const};
  for(const args of [[p+' ',c,a],[p,c+' ',a],[p,c,a+' ']]) assert.throws(()=>issueOriginalStandardH10Forward(ctx,...args as [string,string,string]),code('RESEARCH_SCOPE_INVALID'));
});
test('H10F-12 unknown or copied authority, wrong actor/action/source/clock cannot spend the prefix', () => {
  const room=s.worlds.A,cmd=h10ForwardCommand(0),snap=structuredClone(room);
  assert.throws(()=>submitRemoteMove(room,s.players.red,cmd),code('MODE_ADAPTATION_PENDING'));
  assert.throws(()=>withExactStandardH10Forward(s.cap,()=>submitRemoteMove(structuredClone(room),s.players.red,cmd)),code('RESEARCH_SCOPE_INVALID'));
  for(const altered of [{...cmd,pieceId:'red_pawn_0'},{...cmd,to:{x:2,y:5}},{...cmd,actionId:'other'}, {...cmd,expectedRevision:1}])
    assert.throws(()=>withExactStandardH10Forward(s.cap,()=>submitRemoteMove(room,s.players.red,altered,2000)),coverage);
  assert.throws(()=>withExactStandardH10Forward(s.cap,()=>submitRemoteMove(room,s.players.black,cmd,2000)),coverage);
  const timed=before(1); assert.throws(()=>withExactStandardH10Forward(s.cap,()=>submitRemoteMove(timed,s.players.black,h10ForwardCommand(1),timed.game!.state.turnDeadlineAt!)),coverage);
  for(const now of [NaN,Infinity,-Infinity,1700]) assert.throws(()=>withExactStandardH10Forward(s.cap,()=>submitRemoteMove(room,s.players.red,cmd,now)),coverage);
  assert.deepEqual(room,snap);
});
test('H10F-13 no generic abilities/time/lifecycle or extra tenth action admitted', () => {
  const room=s.worlds.A;
  for(const f of [()=>submitRemoteHeroAbility(room,s.players.black,{ability:'shadow',actionId:'x',expectedRevision:0} as any,2000),()=>advanceRemoteRoomTime(room,undefined,2000),()=>disconnectRemotePlayer(room,s.players.red,2000)])
    assert.throws(()=>withExactStandardH10Forward(s.cap,f),coverage);
  assert.throws(()=>withExactStandardH10Forward(s.cap,()=>submitRemoteMove(B.final,s.players.black,{...h10ForwardCommand(7),expectedRevision:9},11000)),coverage);
});
test('H10F-14 H10 authority is never projected with a fabricated public secret; product flags stay closed', () => {
  assert.equal(withExactStandardH10Forward(s.cap,()=>supportsClosedPublicPathQuery(at(7).game.state,'covered-15')),false);
  assert.equal(GAME_MODES.xiangqi.featuresReady,false); assert.equal(GAME_MODES.half_chaos.featuresReady,false);
});
test('H10F-15 explicit synthetic royal-safety control rejects even terminal host death and rolls back', () => {
  // Fault control from an actual pre-R5 state, not claimed as a natural prefix.
  const natural=before(8),state=structuredClone(natural.game!.state),secret=structuredClone(natural.game!.secret);
  const cannon=state.pieces.find(p=>!p.faceDown&&p.color==='black'&&p.type==='cannon')!; cannon.x=4;cannon.y=5;
  assert.equal(isGeneralInCheck(state,'red'),true);
  const saved=structuredClone({state,secret});
  const captured=captureMechanismEvents(()=> {
    assert.throws(()=>withExactStandardH10Forward(s.cap,()=>applyAuthoritativeAssassination(state,secret,h10ForwardCommand(8) as any,10000)),code('SELF_CHECK'));
  });
  assert.deepEqual({state,secret},saved); assert.equal(captured.events.length,0);
});
