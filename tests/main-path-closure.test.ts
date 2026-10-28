import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAuthoritativeMove, initializeFeatureGameState, applyHeroAbility } from '../src/index.ts';
import { isGeneralInCheck, validatePublicMove } from '../src/rules.ts';
import { captureMechanismEvents } from '../src/mechanism-observer.ts';
import { openDestructionBatches } from '../src/settlement-context.ts';
import { submitRemoteMove } from '../src/remote-room.ts';
import { gameState, move, revealed, secretState } from './helpers.ts';
import type { GameState, MutationId } from '../src/types.ts';

// Public synthetic components, not any original natural replay or mode admission.
const pair = (extras: GameState['pieces'], mutation: MutationId = 'war_chariot', redGeneral = {x:4,y:9}) => ({
  state: initializeFeatureGameState(gameState(extras, {redGeneral}), {red:'qin_long',black:'warrior'}, mutation),
  secret: secretState(),
});
function exposing() {
  return pair([revealed('actor','red','rook',0,7), revealed('screen','red','rook',4,7), revealed('second-screen','red','pawn',4,8),
    revealed('enemy-ray','black','rook',4,2), revealed('target','black','pawn',6,7)]);
}
const command = () => ({...move({x:0,y:7},{x:6,y:7},'path'),pieceId:'actor'});

test('PATH01 real iron-steed leg death and public query agree on safe check evasion', () => {
  const a=pair([revealed('actor','red','horse',3,7),revealed('checker','black','rook',4,7)],'iron_steed');
  const cmd={...move({x:3,y:7},{x:5,y:8},'leg'),pieceId:'actor'};
  assert.equal(isGeneralInCheck(a.state,'red'),true);
  assert.equal(validatePublicMove(a.state,cmd).ok,true);
  const before=structuredClone(a), r=applyAuthoritativeMove(a.state,a.secret,cmd);
  assert.equal(isGeneralInCheck(r.state,'red'),false);
  assert.equal(r.state.captured.filter(p=>p.id==='checker').length,1);
  assert.equal(r.state.formalTurns!.red,1);assert.equal(r.state.revision,1);
  assert.deepEqual(a,before);
});
test('PATH02 path death exposes own king: reject whole authority candidate and all evidence', () => {
  const a=exposing(),before=structuredClone(a);
  assert.equal(validatePublicMove(a.state,command()).code,'SELF_CHECK');
  const c=captureMechanismEvents(()=>{
    assert.throws(()=>applyAuthoritativeMove(a.state,a.secret,command()),(e:any)=>e.code==='SELF_CHECK');
    return 'rejected';
  });
  assert.deepEqual(c.events,[]);assert.deepEqual(a,before);
});
for(const protection of ['barrier','dragonScale'] as const) test(`PATH03 ${protection} return keeps path death, and refuses unsafe final board`,()=>{
  const a=exposing();a.state.effectsByPieceId!.target=protection==='barrier'?{barrier:{owner:'black',enemyTurnsRemaining:3}}:{dragonScale:1};
  const before=structuredClone(a);
  assert.throws(()=>applyAuthoritativeMove(a.state,a.secret,command()),(e:any)=>e.code==='SELF_CHECK');
  assert.deepEqual(a,before);
});
test('PATH04 path scale survival leaves king screen and does not manufacture its death',()=>{
  const a=exposing();a.state.effectsByPieceId!.screen={dragonScale:1};
  const r=applyAuthoritativeMove(a.state,a.secret,command());
  assert(r.state.pieces.some(p=>p.id==='screen'));
  assert(!r.state.captured.some(p=>p.id==='screen'));
  assert.equal(r.state.effectsByPieceId!.screen?.dragonScale,undefined);
  assert.equal(isGeneralInCheck(r.state,'red'),false);
  assert.equal(r.state.captured.filter(p=>p.id==='target').length,1);
});
test('PATH05 committed return landing death is included before royal safety',()=>{
  const a=pair([revealed('actor','red','rook',4,7),revealed('second-screen','red','pawn',4,8),revealed('enemy-ray','black','rook',4,2),revealed('target','black','pawn',6,7)]);
  // Synthetic restored trap/scale component; not a source-legal H04/H03 opening.
  a.state.effectsByPieceId!.target={dragonScale:1};
  a.secret.traps=[{owner:'black',position:{x:4,y:7},opponentTurnsRemaining:2}];
  const cmd={...move({x:4,y:7},{x:6,y:7},'landing'),pieceId:'actor'},before=structuredClone(a);
  assert.equal(validatePublicMove(a.state,cmd).ok,true);
  assert.throws(()=>applyAuthoritativeMove(a.state,a.secret,cmd),(e:any)=>e.code==='SELF_CHECK');
  assert.deepEqual(a,before);
});
test('PATH06 a safe return commits path death once and no extra formal action',()=>{
  const a=pair([revealed('actor','red','rook',0,7),revealed('path','black','pawn',3,7),revealed('target','black','pawn',6,7)]);
  a.state.effectsByPieceId!.target={barrier:{owner:'black',enemyTurnsRemaining:3}};
  const r=applyAuthoritativeMove(a.state,a.secret,command());
  assert.equal(r.state.pieces.find(p=>p.id==='actor')!.x,0);
  assert.equal(r.state.lastMove!.landed,false);assert.equal(r.state.lastMove!.classification!.opportunity,'main');
  assert.equal(r.state.captured.filter(p=>p.id==='path').length,1);
  assert.equal(r.state.automaticEvents!.filter(e=>e.kind==='destroy:crush').length,1);
  assert.equal(r.state.formalTurns!.red,1);assert.equal(r.state.revision,1);
  assert.equal(r.secret.processedActions.path,1);
  const duplicate=applyAuthoritativeMove(r.state,r.secret,command());
  assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.state,r.state);assert.deepEqual(duplicate.secret,r.secret);
});
test('PATH07 open original authority batch refuses before clone and preserves source',()=>{
  const a=exposing(),before=structuredClone(a);
  openDestructionBatches.set(a.state,{batchId:'open',targets:[]});
  try {assert.throws(()=>applyAuthoritativeMove(a.state,a.secret,command()),(e:any)=>e.code==='DESTRUCTION_BATCH_OPEN');}
  finally {openDestructionBatches.delete(a.state);}
  assert.deepEqual(a,before);
});
test('PATH08 explicit own-royal path death preserves its source terminal',()=>{
  const a=pair([revealed('actor','red','rook',0,8),revealed('target','black','pawn',6,8)],'war_chariot',{x:4,y:8});
  const c=captureMechanismEvents(()=>applyAuthoritativeMove(a.state,a.secret,{...move({x:0,y:8},{x:6,y:8},'royal'),pieceId:'actor'}));
  assert.equal(c.result.state.status,'finished');assert.equal(c.result.state.winner,'black');
  const event=c.events.find(e=>e.kind==='main_action_atom_closed');
  assert(event);assert.equal(event.details.sourceTerminal,true);
  assert(!c.events.some(e=>e.kind==='formal_turn_settled'));
});
test('OBS01 main closure sees path outcome before counter/end, settled sees expired barrier before next begin',()=>{
  const a=pair([revealed('actor','red','rook',0,7),revealed('guard','black','pawn',7,4)]);
  a.state.effectsByPieceId!.guard={barrier:{owner:'black',enemyTurnsRemaining:1}};
  const c=captureMechanismEvents(()=>applyAuthoritativeMove(a.state,a.secret,move({x:0,y:7},{x:0,y:6},'observed')));
  const atom=c.events.find(e=>e.kind==='main_action_atom_closed')!;
  const settled=c.events.find(e=>e.kind==='formal_turn_settled')!;
  assert(atom&&settled);assert.equal(atom.state.turnLifecycle!.phase,'atom_closure');
  assert.equal(atom.state.formalTurns!.red,0);assert.equal(atom.state.effectsByPieceId!.guard.barrier!.enemyTurnsRemaining,1);
  assert.equal(settled.state.formalTurns!.red,1);assert.equal(settled.state.effectsByPieceId!.guard.barrier,undefined);
  const idx=(k:string)=>c.events.findIndex(e=>e.kind===k);
  assert(idx('main_action_atom_closed')<idx('formal_turn_end'));
  assert(idx('formal_turn_end')<idx('formal_turn_settled'));
  assert(idx('formal_turn_settled')<c.events.findIndex(e=>e.kind==='formal_turn_begin'&&e.details.side==='black'));
  assert(Object.isFrozen(settled.state));assert(!JSON.stringify(c.result.state).includes('formal_turn_settled'));
});
test('OBS02 failure in a new checkpoint invalidates evidence without changing committed authority',()=>{
  const make=()=>pair([revealed('actor','red','rook',0,7)]);
  const a=make(),before=structuredClone(a),expected=applyAuthoritativeMove(a.state,a.secret,move({x:0,y:7},{x:0,y:6},'passive'));
  const clone=globalThis.structuredClone;let injected=false;
  globalThis.structuredClone=((v:any,options?:any)=>{
    if(v?.kind==='main_action_atom_closed'&&v.state){injected=true;throw Error('checkpoint clone');}
    return clone(v,options);
  }) as typeof structuredClone;
  try {
    const c=captureMechanismEvents(()=>applyAuthoritativeMove(before.state,before.secret,move({x:0,y:7},{x:0,y:6},'passive')));
    assert(injected);assert.equal(c.evidenceValid,false);assert.deepEqual(c.events,[]);assert.deepEqual(c.result,expected);
  } finally {globalThis.structuredClone=clone;}
});
test('OBS03 stale requests and unsupported query scope do not gain a safety bypass',()=>{
  const a=exposing(),before=structuredClone(a);
  assert.throws(()=>applyAuthoritativeMove(a.state,a.secret,{...command(),expectedRevision:1}),(e:any)=>e.code==='STALE_REVISION');
  assert.deepEqual(a,before);
  const ordinary=initializeFeatureGameState(gameState([revealed('actor','red','horse',3,7),revealed('checker','black','rook',4,7)],{redGeneral:{x:4,y:9}}),{red:'hunter',black:'warrior'},'iron_steed');
  assert.throws(()=>applyAuthoritativeMove(ordinary,secretState(),move({x:3,y:7},{x:5,y:8},'not-mapped')),(e:any)=>e.code==='SELF_CHECK');
});
test('OBS04 fixed PR13 invoke is already a counted main action, and new seams preserve that fact',()=>{
  const state=initializeFeatureGameState(gameState([revealed('reply','black','rook',7,2)]),{red:'devout_zealot',black:'hunter'});
  const c=captureMechanismEvents(()=>applyHeroAbility(state,secretState(),{kind:'hero_ability',ability:'invoke',actionId:'invoke',expectedRevision:0},100,()=>0));
  assert.equal(c.result.state.formalTurns!.red,1);assert.equal(c.result.state.lastMove!.countsAsFormalTurn,true);
  assert.equal(c.result.state.lastMove!.classification!.opportunity,'main');
  assert(c.events.some(e=>e.kind==='main_action_atom_closed'));assert(c.events.some(e=>e.kind==='formal_turn_settled'));
});
test('PATH09 remote authority checks the original batch before private-trap copying',()=>{
  const a=exposing(),room:any={roomId:'path-original',phase:'playing',updatedAt:100,
    seats:{host:{playerId:'A'},guest:{playerId:'B'}},mode:{heroesEnabled:true,mutationsEnabled:true},
    game:{players:{red:'A',black:'B'},...a},featureSecret:{traps:[]}};
  const before=structuredClone(room),clone=globalThis.structuredClone;let copies=0;
  openDestructionBatches.set(a.state,{batchId:'original',targets:[]});
  globalThis.structuredClone=((..._:any[])=>{copies++;throw Error('copied too early');}) as typeof structuredClone;
  try {assert.throws(()=>submitRemoteMove(room,'A',command(),200),(e:any)=>e.code==='DESTRUCTION_BATCH_OPEN');}
  finally {globalThis.structuredClone=clone;openDestructionBatches.delete(a.state);}
  assert.equal(copies,0);assert.deepEqual(room,before);
});
test('PATH10 unsafe early source candidate does not sample the production RNG',()=>{
  const a=exposing();a.state.formalTurns={red:14,black:14};let calls=0;
  const random=Math.random;
  Math.random=()=>{calls++;throw Error('unexpected RNG');};
  try {assert.throws(()=>applyAuthoritativeMove(a.state,a.secret,command()),(e:any)=>e.code==='SELF_CHECK');}
  finally {Math.random=random;}
  assert.equal(calls,0);
});
test('OBS05 post-end checkpoint failure invalidates evidence and preserves authority output',()=>{
  const make=()=>pair([revealed('actor','red','rook',0,7)]);
  const a=make(),b=make(),cmd=move({x:0,y:7},{x:0,y:6},'end-passive');
  const expected=applyAuthoritativeMove(a.state,a.secret,cmd),clone=globalThis.structuredClone;let injected=false;
  globalThis.structuredClone=((v:any,options?:any)=>{
    if(v?.kind==='formal_turn_settled'&&v.state){injected=true;throw Error('end checkpoint clone');}
    return clone(v,options);
  }) as typeof structuredClone;
  try {const c=captureMechanismEvents(()=>applyAuthoritativeMove(b.state,b.secret,cmd));
    assert(injected);assert.equal(c.evidenceValid,false);assert.deepEqual(c.events,[]);assert.deepEqual(c.result,expected);
  } finally {globalThis.structuredClone=clone;}
});
