// Adapted with attribution from main/reviews/hero-pilot/ROYAL_PROBE.ts at 04ae7489.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { initializeFeatureGameState, initializeFeatureSecret, applyHeroAbility, getRelayPairs, isGeneralInCheck, applyAutomaticExecution } from '../../src/index.ts';
import { gameState, revealed, secretState } from '../../tests/helpers.ts';

// Explicit synthetic source-bound probe, not a naturally reached game or balance sample.
const state = initializeFeatureGameState(gameState([
  revealed('a', 'red', 'pawn', 3, 8), revealed('b', 'red', 'horse', 4, 8),
  revealed('attacker', 'black', 'rook', 3, 0),
]), {red:'siheng'}, undefined, undefined, undefined, true);
const secret = secretState(); initializeFeatureSecret(state, secret);
const hazard = structuredClone(secret);
hazard.traps = [{id:'screen-hazard',owner:'black',position:{x:3,y:8},opponentTurnsRemaining:4}];
const before = structuredClone({state,secret,hazard});
const command = {kind:'hero_ability' as const,ability:'relay_swap' as const,pieceId:'a',partnerId:'b',actionId:'main-review:relay',expectedRevision:0};
assert.equal(isGeneralInCheck(state,'red'),false);
const pairs = getRelayPairs(state);
const safe = applyHeroAbility(state,secret,command,1000,()=>0);
const risk = applyHeroAbility(state,hazard,command,1000,()=>0);
assert.equal(safe.state.status,'playing');
assert.equal(risk.state.status,'execution'); assert.equal(risk.state.winner,'black');
assert.equal(risk.state.heroRuntime!.red!.relayUses,1);
assert.equal(risk.state.pieces.find(p=>p.id==='a')!.x,4);
assert(!risk.state.pieces.some(p=>p.id==='b'));
assert.equal(risk.state.captured.filter(p=>p.id==='b').length,1);
assert.equal(risk.secret.processedActions[command.actionId],risk.state.revision);
assert.deepEqual({state,secret,hazard},before);
const reversed = applyHeroAbility(state,hazard,{...command,pieceId:'b',partnerId:'a'},1000,()=>0);
const left=structuredClone(reversed), right=structuredClone(risk);
assert.equal(left.state.lastMove!.pieceId,'b'); assert.equal(right.state.lastMove!.pieceId,'a');
left.state.lastMove!.pieceId=right.state.lastMove!.pieceId;
assert.deepEqual(left,right);
const terminal = applyAutomaticExecution(risk.state,risk.secret,'main-review:execution');
assert.equal(terminal.state.status,'finished'); assert.equal(terminal.state.winner,'black');
const report = {sourceParent:'7a1dfbc92efa2a54bb85175cc251856bb2cdb4d3',execution:'visual repair working tree; bound by VISUAL_REPAIR.json source hashes',kind:'EXECUTOR_RERUN_MAINLINE_SYNTHETIC_ROYAL_PROBE_NOT_INDEPENDENT_QA',initialProbeCorrection:'Initial full-state equality assertion failed only on lastMove.pieceId following submitted first endpoint. Narrowed assertion to causal effects/secret and explicitly preserved that metadata difference; not a product fix.',checks:[
  'eligible public swap with a secret landing trap commits both placements, consumes one use and resolves opened own-general check through existing execution',
  'reversed endpoints have identical effects/secret after excluding request-order lastMove.pieceId; full states intentionally not claimed equal',
  'original state/secret remain unchanged; actual automatic execution finishes with opponent winner'
],passed:3,failed:0,candidates:pairs,publicSafetyBefore:false,safeStatus:safe.state.status,hazardStatus:risk.state.status,finalStatus:terminal.state.status};
writeFileSync(new URL('../../review/hero-pilot/VISUAL_REPAIR_ROYAL_PROBE.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
