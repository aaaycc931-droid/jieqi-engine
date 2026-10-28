import { readFileSync } from 'node:fs';
import { createStandardNp32Session } from '../scripts/research/standard-np32.ts';
import { issueOriginalStandardNpTuple, withExactStandardNpTuple } from '../src/research-source-context.ts';
import { applyAuthoritativeMove, applyAuthoritativeAssassination, initializeFeatureGameState } from '../src/game.ts';
import { gameState, revealed, secretState } from './helpers.ts';
import type { GameState, MutationId } from '../src/types.ts';
import type { PublicMoveOptions } from '../src/rules.ts';

const base = new URL('./fixtures/standard-np32/', import.meta.url);
export const [contract, rng, guards] = ['NP_CONTRACT.json', 'RNG_CONTRACT.json', 'OBSERVATION_GUARD_MATRIX.json'].map(x => readFileSync(new URL(x, base), 'utf8'));
export const witnesses = JSON.parse(readFileSync(new URL('M04_SYMBOLIC_WITNESSES.json', base), 'utf8')).witnesses;
export type ActionKind = 'move' | 'activation' | 'continuing';
export const kinds: ActionKind[] = ['move', 'activation', 'continuing'];
export const session = (branch: 'AS' | 'AP' | 'ES' = 'AS') => createStandardNp32Session(contract, rng, guards, branch);
export function inScope<T>(f: () => T): T {
  const capability = issueOriginalStandardNpTuple({ roomId: 'query-components', tupleId: 'STD-NP32-AS-AP-ES', branch: 'AS', players: { red: 'host', black: 'guest' } }, contract, rng);
  return withExactStandardNpTuple(capability, f);
}

/** Original separately sourced symbolic components; natural reachability unknown. */
export function symbolic(w: any, kind: ActionKind = 'move') {
  const { state, secret } = structuredClone(session().initial.game!);
  state.pieces = w.pieces.map(({ id, color, type, x, y }: any) => ({ id, color, type, x, y, faceDown: false }));
  state.effectsByPieceId = {}; state.captured = []; state.revision = 0; state.turn = 'red'; state.status = 'playing';
  delete state.turnLifecycle; delete secret.formalStart;
  state.formalTurns = { red: kind === 'continuing' ? 6 : 0, black: kind === 'continuing' ? 6 : 0 };
  for (const p of w.pieces) if (p.dragonScale) state.effectsByPieceId![p.id] = { dragonScale: 1, dragonClaw: true };
  if (kind === 'continuing') {
    state.assassination!.red.heroChargeAvailable = false; state.assassination!.red.activePieceId = w.input.attackerRookId;
    state.effectsByPieceId![w.input.attackerRookId] = { stealth: { owner: 'red', remainingOwnerTurns: 2, activatedOnFormalTurn: 6, strongStrikeAvailable: true, source: 'hero' } };
  }
  const move = { actionId: 'query:' + w.id + ':' + kind, expectedRevision: 0, pieceId: w.input.attackerRookId, from: { x: w.input.source[0], y: w.input.source[1] }, to: { x: w.input.destination[0], y: w.input.destination[1] } };
  const command = { ...move, kind: 'assassination' as const, useStrongStrike: kind === 'continuing', ...(kind === 'continuing' ? {} : { source: 'hero' as const }) };
  const options: PublicMoveOptions = kind === 'move' ? {} : {
    allowStealthSource: kind === 'continuing', requireCapture: kind === 'continuing', allowStealthTarget: kind === 'continuing',
    assassination: kind === 'continuing' ? { useStrongStrike: true } : { source: 'hero', useStrongStrike: false },
  };
  return { state, secret, move, command, options, execute: () => inScope(() => kind === 'move' ? applyAuthoritativeMove(state, secret, move, false, 12345) : applyAuthoritativeAssassination(state, secret, command, 12345)) };
}
export function checkingPath(shield = false) {
  return { id: 'checking-path-rook', input: { attackerRookId: 'actor', source: [0, 7], destination: [6, 7] }, pieces: [
    { id: 'red-general', color: 'red', type: 'general', x: 4, y: 9 }, { id: 'black-general', color: 'black', type: 'general', x: 4, y: 0 },
    { id: 'actor', color: 'red', type: 'rook', x: 0, y: 7 }, { id: 'checker', color: 'black', type: 'rook', x: 4, y: 7 },
    { id: 'screen', color: 'red', type: 'pawn', x: 4, y: 4 }, { id: 'target', color: 'black', type: 'horse', x: 6, y: 7, ...(shield ? { dragonScale: 1 } : {}) },
  ] };
}
export function earlyPair(extras: GameState['pieces'], mutation: MutationId = 'iron_steed', redGeneral = { x: 4, y: 9 }) {
  return { state: initializeFeatureGameState(gameState(extras, { redGeneral }), { red: 'qin_long', black: 'warrior' }, mutation), secret: secretState() };
}
export function onlyLegEvasion() {
  return earlyPair([revealed('actor', 'red', 'horse', 3, 7), revealed('checker', 'black', 'rook', 4, 7),
    revealed('guard-left', 'black', 'horse', 1, 8), revealed('guard-right', 'black', 'horse', 7, 8), revealed('guard-front', 'black', 'rook', 0, 8)]);
}
export function onlyUnsafeBounces() {
  const a = symbolic(witnesses[0]);
  a.state.pieces = [revealed('red-general', 'red', 'general', 5, 9), revealed('black-general', 'black', 'general', 3, 0),
    revealed('actor', 'red', 'rook', 5, 8), revealed('leg-screen', 'red', 'pawn', 4, 8), revealed('ray', 'black', 'rook', 5, 0),
    revealed('ray-screen', 'black', 'pawn', 5, 7), revealed('horse', 'black', 'horse', 3, 8), revealed('guard', 'black', 'rook', 4, 0)];
  a.state.effectsByPieceId = { ray: { dragonScale: 1 }, horse: { dragonScale: 1 } };
  a.state.formalTurns = { red: 6, black: 6 }; a.state.heroRuntime!.black!.invokeCount = 4; a.state.heroRuntime!.black!.descended = true;
  return a;
}
