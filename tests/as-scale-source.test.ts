import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAuthoritativeAssassination,initializeFeatureGameState } from '../src/game.ts';
import { gameState,move,revealed,secretState } from './helpers.ts';
import type { AssassinationCommand } from '../src/types.ts';

// Guarded AS/AP/ES components; not the full ordinary NP32 natural prefix.
function pair(pathScale=false,targetScale=true,continuing=false){
  const state=initializeFeatureGameState(gameState([revealed('actor','red','rook',0,5),revealed('path','black','pawn',0,3),revealed('target','black','horse',0,2)]),
    {red:'rogue',black:'devout_zealot'},'war_chariot',undefined,{black:'invincible'});
  state.effectsByPieceId!.target={dragonClaw:true,...(targetScale?{dragonScale:1}: {})};
  if(pathScale)state.effectsByPieceId!.path={dragonScale:1};
  if(continuing){state.assassination!.red.heroChargeAvailable=false;state.assassination!.red.activePieceId='actor';
    state.effectsByPieceId!.actor={stealth:{owner:'red',remainingOwnerTurns:2,activatedOnFormalTurn:0,strongStrikeAvailable:true,source:'hero'}};}
  const command:AssassinationCommand={...move({x:0,y:5},{x:0,y:2},'scale-source'),kind:'assassination',useStrongStrike:continuing,...(!continuing?{source:'hero' as const}:{})};
  return{state,secret:secretState(),command};
}
test('AS01 confirmed first activation into endpoint scale retains unused hero source but consumes this main',()=>{
  const a=pair(),before=structuredClone(a),r=applyAuthoritativeAssassination(a.state,a.secret,a.command);
  assert.equal(r.state.assassination!.red.heroChargeAvailable,true);assert.equal(r.state.assassination!.red.activePieceId,undefined);
  assert.equal(r.state.effectsByPieceId!.actor?.stealth,undefined);assert.equal(r.state.effectsByPieceId!.target.dragonScale,undefined);
  assert.equal(r.state.pieces.find(p=>p.id==='actor')!.y,5);assert(r.state.pieces.some(p=>p.id==='target'));
  assert.equal(r.state.captured.filter(p=>p.id==='path').length,1);assert.equal(r.state.lastMove!.landed,false);
  assert.equal(r.state.formalTurns!.red,1);assert.equal(r.state.turn,'black');assert.deepEqual(a,before);
  assert.equal(applyAuthoritativeAssassination(r.state,r.secret,a.command).duplicate,true);
});
test('AP01 already-held opportunity with path scale does not receive an AS refund',()=>{
  const a=pair(true,false,true),r=applyAuthoritativeAssassination(a.state,a.secret,a.command);
  assert.equal(r.state.assassination!.red.heroChargeAvailable,false);assert.equal(r.state.assassination!.red.activePieceId,undefined);
  assert(r.state.pieces.some(p=>p.id==='path'));assert(!r.state.captured.some(p=>p.id==='path'));
  assert(r.state.captured.some(p=>p.id==='target'));assert.equal(r.state.pieces.find(p=>p.id==='actor')!.y,2);
});
test('ES01 already-held opportunity into endpoint scale remains spent after return',()=>{
  const a=pair(false,true,true),r=applyAuthoritativeAssassination(a.state,a.secret,a.command);
  assert.equal(r.state.assassination!.red.heroChargeAvailable,false);assert.equal(r.state.assassination!.red.activePieceId,undefined);
  assert.equal(r.state.effectsByPieceId!.actor?.stealth,undefined);assert.equal(r.state.pieces.find(p=>p.id==='actor')!.y,5);
  assert.equal(r.state.captured.filter(p=>p.id==='path').length,1);
});
test('AS02 a surviving protected path is outside the confirmed AS retention guard',()=>{
  const a=pair(true,true,false),r=applyAuthoritativeAssassination(a.state,a.secret,a.command);
  assert.equal(r.state.assassination!.red.heroChargeAvailable,false); // Legacy branch, not new AS policy.
  assert(r.state.pieces.some(p=>p.id==='path'));
});
