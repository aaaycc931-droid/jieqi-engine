/**
 * Shan v1.2 component model. Not registered as a hero or imported by product code.
 * Move legality, stable atomic closure and threat continuity keys must come from
 * a future trusted board adapter; these facts are NOT client command fields.
 * This module neither moves/removes board pieces nor verifies a chess position.
 */
export type ShanSide = 'red' | 'black';
export interface ShanPoint { x: number; y: number }
export interface ShanThreat {
  pieceId: string;
  /** Same rook on the same uninterrupted checking ray keeps the same key. */
  continuationKey: string;
}
export type ShanOutcome = 'won_by_checkmate' | 'won_by_checks' | 'lost_timeout' | 'lost_no_reply';
export interface ShanState {
  schema: 'shan-core/v1';
  owner: ShanSide;
  turn: ShanSide;
  generalPosition: ShanPoint;
  revision: number;
  lethalLevel: number;
  guardUsed: boolean;
  life: 'alive' | 'dead';
  deathActionId: string | null;
  remainingTurns: number | null;
  remainingEvasions: number | null;
  executionChecks: number;
  threatsOnOwner: ShanThreat[];
  threatsOnEnemy: ShanThreat[];
  outcome: ShanOutcome | null;
  processed: Array<{ actionId: string; fingerprint: string }>;
}
export interface ShanGuard {
  pieceId: string;
  type: 'advisor' | 'other';
  side: ShanSide;
  position: ShanPoint;
  provenance: 'ordinary_revealed_ground' | 'unsupported';
}
interface ActionBase {
  actionId: string;
  expectedRevision: number;
  actor: ShanSide;
  source: 'ordinary_ground';
}
interface MoveFacts extends ActionBase {
  /** Legality on the actual post-sacrifice candidate, excluding Shan's royal exception. */
  ordinaryMoveLegal: boolean;
  movesGeneral: boolean;
  threatsOnOwnerAfter: readonly ShanThreat[];
  threatsOnEnemyAfter: readonly ShanThreat[];
}
export interface ShanOwnMove extends MoveFacts {
  kind: 'own_move';
  choice: 'normal' | 'gamble' | 'guard';
  ordinaryCheckmate: boolean;
  guard?: ShanGuard;
}
export interface ShanEnemyMove extends MoveFacts { kind: 'enemy_move' }
export interface ShanNoReply extends ActionBase {
  kind: 'no_reply';
  /** Exhaustive trusted adapter findings, not a claim inferred from quota alone. */
  normalReplyExists: boolean;
  specialReplyExists: boolean;
}
export type ShanAction = ShanOwnMove | ShanEnemyMove | ShanNoReply;
export interface ShanPreview {
  duplicate: boolean;
  requiresRandom: boolean;
  deathPercent: number | null;
  sacrificePieceId: string | null;
}
export interface ShanResult {
  state: ShanState;
  duplicate: boolean;
  /** Board adapter must atomically apply this cost with the validated move. */
  sacrificePieceId: string | null;
}
export class ShanCoreError extends Error {
  code: string;
  constructor(code: string) { super(code); this.name = 'ShanCoreError'; this.code = code; }
}
const fail = (code: string): never => { throw new ShanCoreError(code); };
const other = (side: ShanSide): ShanSide => side === 'red' ? 'black' : 'red';
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const side = (value: unknown): value is ShanSide => value === 'red' || value === 'black';
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
function point(p: ShanPoint): boolean { return !!p && integer(p.x, 0, 8) && integer(p.y, 0, 9); }
function threats(value: readonly ShanThreat[]): ShanThreat[] {
  if (!Array.isArray(value)) fail('INVALID_THREATS');
  const ids = new Set<string>();
  const result = value.map(t => {
    if (!t || !text(t.pieceId) || !text(t.continuationKey) || ids.has(t.pieceId)) fail('INVALID_THREATS');
    ids.add(t.pieceId);
    return { pieceId: t.pieceId, continuationKey: t.continuationKey };
  });
  return result.sort((a, b) => a.pieceId < b.pieceId ? -1 : a.pieceId > b.pieceId ? 1 : 0);
}
function newCheck(before: readonly ShanThreat[], after: readonly ShanThreat[]): boolean {
  return after.some(t => !before.some(b => b.pieceId === t.pieceId && b.continuationKey === t.continuationKey));
}
function validateState(s: ShanState): void {
  if (!s || s.schema !== 'shan-core/v1' || !side(s.owner) || !side(s.turn) || !point(s.generalPosition) ||
      !integer(s.revision) || !integer(s.lethalLevel) || typeof s.guardUsed !== 'boolean' ||
      !integer(s.executionChecks, 0, 4) || !Array.isArray(s.processed)) fail('INVALID_STATE');
  threats(s.threatsOnOwner); threats(s.threatsOnEnemy);
  const outcomes: Array<ShanOutcome | null> = [null, 'won_by_checkmate', 'won_by_checks', 'lost_timeout', 'lost_no_reply'];
  if (!outcomes.includes(s.outcome)) fail('INVALID_STATE');
  if (s.life === 'alive') {
    if (s.deathActionId !== null || s.remainingTurns !== null || s.remainingEvasions !== null || s.executionChecks !== 0 ||
        s.outcome === 'won_by_checks' || s.outcome === 'lost_timeout') fail('INVALID_STATE');
  } else if (s.life === 'dead') {
    if (!text(s.deathActionId) || !integer(s.remainingTurns, 0, 6) || !integer(s.remainingEvasions, 0, 2) ||
        s.remainingTurns === 0 && s.outcome === null || s.executionChecks === 4 && s.outcome !== 'won_by_checks' && s.outcome !== 'won_by_checkmate') fail('INVALID_STATE');
  } else fail('INVALID_STATE');
  if (s.outcome === 'won_by_checks' && s.executionChecks !== 4 || s.outcome === 'lost_timeout' && s.remainingTurns !== 0) fail('INVALID_STATE');
  const ids = new Set<string>();
  for (const entry of s.processed) {
    if (!entry || !text(entry.actionId) || !text(entry.fingerprint) || ids.has(entry.actionId)) fail('INVALID_STATE');
    ids.add(entry.actionId);
  }
  if (s.processed.length !== s.revision) fail('INVALID_STATE');
}
export function createShanState(owner: ShanSide, firstActor: ShanSide = owner,
  generalPosition: ShanPoint = { x: 4, y: owner === 'red' ? 9 : 0 }): ShanState {
  const state: ShanState = {
    schema: 'shan-core/v1', owner, turn: firstActor, generalPosition: { ...generalPosition }, revision: 0,
    lethalLevel: 0, guardUsed: false, life: 'alive', deathActionId: null,
    remainingTurns: null, remainingEvasions: null, executionChecks: 0,
    threatsOnOwner: [], threatsOnEnemy: [], outcome: null, processed: [],
  };
  validateState(state); return state;
}
export function shanDeathPercent(level: number): number {
  if (!integer(level, 1)) fail('NO_LETHAL_LEVEL');
  return [10, 20, 35, 50, 65, 80][Math.min(level, 6) - 1];
}
function normalizedAction(input: ShanAction): ShanAction {
  if (!input || !text(input.actionId) || !integer(input.expectedRevision) || !side(input.actor)) fail('INVALID_ACTION');
  if (input.source !== 'ordinary_ground') fail('UNSUPPORTED_SOURCE');
  const base: ActionBase = { actionId: input.actionId, expectedRevision: input.expectedRevision, actor: input.actor, source: input.source };
  if (input.kind === 'no_reply') {
    if (typeof input.normalReplyExists !== 'boolean' || typeof input.specialReplyExists !== 'boolean') fail('INVALID_ACTION');
    return { ...base, kind: input.kind, normalReplyExists: input.normalReplyExists, specialReplyExists: input.specialReplyExists };
  }
  if (input.kind !== 'own_move' && input.kind !== 'enemy_move') fail('UNSUPPORTED_SOURCE');
  if (typeof input.ordinaryMoveLegal !== 'boolean' || typeof input.movesGeneral !== 'boolean') fail('INVALID_ACTION');
  const move = { ...base, ordinaryMoveLegal: input.ordinaryMoveLegal, movesGeneral: input.movesGeneral,
    threatsOnOwnerAfter: threats(input.threatsOnOwnerAfter), threatsOnEnemyAfter: threats(input.threatsOnEnemyAfter) };
  if (input.kind === 'enemy_move') return { ...move, kind: input.kind };
  if (!['normal', 'gamble', 'guard'].includes(input.choice) || typeof input.ordinaryCheckmate !== 'boolean') fail('INVALID_ACTION');
  let guard: ShanGuard | undefined;
  if (input.guard !== undefined) {
    const g = input.guard;
    if (!g || !text(g.pieceId) || !side(g.side) || !point(g.position) || !['advisor', 'other'].includes(g.type) ||
        !['ordinary_revealed_ground', 'unsupported'].includes(g.provenance)) fail('INVALID_GUARD');
    guard = { pieceId: g.pieceId, side: g.side, type: g.type, position: { ...g.position }, provenance: g.provenance };
  }
  return { ...move, kind: input.kind, choice: input.choice, ordinaryCheckmate: input.ordinaryCheckmate, ...(guard ? { guard } : {}) };
}
function prepare(state: ShanState, input: ShanAction) {
  validateState(state);
  const action = normalizedAction(input), fingerprint = JSON.stringify(action);
  const processed = state.processed.find(e => e.actionId === action.actionId);
  if (processed) {
    if (processed.fingerprint !== fingerprint) fail('ACTION_ID_REUSED');
    return { action, fingerprint, preview: { duplicate: true, requiresRandom: false, deathPercent: null, sacrificePieceId: null } as ShanPreview };
  }
  if (action.expectedRevision !== state.revision) fail('STALE_REVISION');
  if (state.outcome !== null) fail('FINISHED');
  if (action.actor !== state.turn) fail('WRONG_TURN');
  if (state.revision === Number.MAX_SAFE_INTEGER) fail('COUNTER_OVERFLOW');
  const preview: ShanPreview = { duplicate: false, requiresRandom: false, deathPercent: null, sacrificePieceId: null };
  if (action.kind === 'enemy_move') {
    if (action.actor === state.owner) fail('WRONG_ACTOR');
    if (!action.ordinaryMoveLegal || action.threatsOnEnemyAfter.length !== 0) fail('ILLEGAL_MOVE');
    if (newCheck(state.threatsOnOwner, action.threatsOnOwnerAfter) && state.lethalLevel === Number.MAX_SAFE_INTEGER) fail('COUNTER_OVERFLOW');
  } else {
    if (action.actor !== state.owner) fail('WRONG_ACTOR');
    if (action.kind === 'no_reply') {
      if (state.threatsOnOwner.length === 0 || action.normalReplyExists || action.specialReplyExists) fail('REPLY_STILL_AVAILABLE');
    } else {
      if (action.movesGeneral) fail('GENERAL_FIXED');
      if (!action.ordinaryMoveLegal) fail('ILLEGAL_MOVE');
      if (action.ordinaryCheckmate && action.threatsOnEnemyAfter.length === 0) fail('INVALID_CHECKMATE_FACT');
      if (action.choice === 'normal') {
        if (action.guard !== undefined) fail('UNEXPECTED_GUARD');
        if (action.threatsOnOwnerAfter.length !== 0) fail('SELF_CHECK');
      } else {
        if (state.threatsOnOwner.length === 0) fail('NOT_IN_CHECK');
        if (state.life === 'dead' && state.remainingEvasions === 0) fail('NO_SPECIAL_EVASION');
        if (action.choice === 'guard') {
          const g = action.guard;
          if (!g || state.guardUsed || g.side !== state.owner || g.type !== 'advisor' ||
              Math.max(Math.abs(g.position.x - state.generalPosition.x), Math.abs(g.position.y - state.generalPosition.y)) !== 1) fail('GUARD_UNAVAILABLE');
          if (g.provenance !== 'ordinary_revealed_ground') fail('UNSUPPORTED_GUARD');
          preview.sacrificePieceId = g.pieceId;
        } else {
          if (action.guard !== undefined) fail('UNEXPECTED_GUARD');
          if (state.life === 'alive') {
            preview.requiresRandom = true; preview.deathPercent = shanDeathPercent(state.lethalLevel);
          }
        }
      }
    }
  }
  return { action, fingerprint, preview };
}
/** No mutation and no RNG. Facts are revalidated on commit. */
export function previewShanAction(state: ShanState, action: ShanAction): ShanPreview {
  return { ...prepare(state, action).preview };
}
export function commitShanAction(state: ShanState, input: ShanAction, randomInt?: (maxExclusive: number) => number): ShanResult {
  const { action, fingerprint, preview } = prepare(state, input);
  const next = structuredClone(state);
  if (preview.duplicate) return { state: next, duplicate: true, sacrificePieceId: null };
  let died = false;
  if (preview.requiresRandom) {
    if (typeof randomInt !== 'function') fail('RNG_REQUIRED');
    const roll = randomInt(100);
    if (!integer(roll, 0, 99)) fail('INVALID_RANDOM_VALUE');
    died = roll < preview.deathPercent!;
  }
  if (action.kind === 'no_reply') next.outcome = 'lost_no_reply';
  else {
    if (action.kind === 'enemy_move') {
      if (action.threatsOnOwnerAfter.length === 0) next.lethalLevel = Math.max(0, next.lethalLevel - 1);
      else if (newCheck(state.threatsOnOwner, action.threatsOnOwnerAfter)) next.lethalLevel += 1;
    } else {
      if (preview.sacrificePieceId !== null) next.guardUsed = true;
      if (state.life === 'dead') {
        if (action.choice !== 'normal') next.remainingEvasions! -= 1;
        if (newCheck(state.threatsOnEnemy, action.threatsOnEnemyAfter)) next.executionChecks += 1;
        next.remainingTurns! -= 1;
      } else if (died) {
        next.life = 'dead'; next.deathActionId = action.actionId;
        next.remainingTurns = 6; next.remainingEvasions = 2; next.executionChecks = 0;
      }
      if (action.ordinaryCheckmate) next.outcome = 'won_by_checkmate';
      else if (next.executionChecks === 4) next.outcome = 'won_by_checks';
      else if (next.life === 'dead' && next.remainingTurns === 0) next.outcome = 'lost_timeout';
    }
    next.threatsOnOwner = threats(action.threatsOnOwnerAfter);
    next.threatsOnEnemy = threats(action.threatsOnEnemyAfter);
  }
  next.revision += 1; next.turn = other(action.actor);
  next.processed.push({ actionId: action.actionId, fingerprint });
  return { state: next, duplicate: false, sacrificePieceId: preview.sacrificePieceId };
}
/** Only an authenticated owner may receive this projection in a future adapter. */
export function ownerShanView(state: ShanState, viewer: ShanSide) {
  validateState(state);
  if (viewer !== state.owner) return undefined;
  return {
    lethalLevel: state.lethalLevel, life: state.life, guardAvailable: !state.guardUsed,
    gambleDeathPercent: state.life === 'alive' && state.threatsOnOwner.length > 0 ? shanDeathPercent(state.lethalLevel) : null,
    remainingTurns: state.remainingTurns, remainingEvasions: state.remainingEvasions,
    executionChecks: state.executionChecks, executionTarget: 4 as const,
  };
}
