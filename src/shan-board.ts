/** Shan 2A: internal ordinary-board queries, never a room/client authority API.
 * Context provenance/closure must be supplied by the future trusted authority.
 * Returned candidates are isolated simulations, NOT committed game transactions.
 */
import { canRevealedPieceAttack, isCheckmate, pieceAt, samePosition, validatePublicMove } from './rules.ts';
import { isInPalace, isInsideBoard, otherSide } from './slots.ts';
import { requireClosedDestructionBatch } from './settlement-context.ts';
import { ownerShanView, previewShanAction } from './shan-core.ts';
import type { ShanAction, ShanGuard, ShanPreview, ShanState, ShanThreat } from './shan-core.ts';
import type { GameState, Position, RevealedPiece, Side } from './types.ts';

export interface ShanBoardContext {
  /** Internal attestations, never fields copied from public GameState or JSON. */
  closure: 'stable';
  generalIds: Readonly<Record<Side, string>>;
  ordinaryOriginalPieceIds: readonly string[];
}
export type ShanBoardQuery<T> = { status: 'known'; value: T } | { status: 'unknown'; reasons: string[] };
export interface ShanBoardFacts {
  generals: Record<Side, RevealedPiece>;
  threatsOnOwner: ShanThreat[];
  threatsOnEnemy: ShanThreat[];
}
export interface ShanBoardChoice {
  actionId: string;
  expectedRevision: number;
  pieceId: string;
  from: Position;
  to: Position;
  choice: 'normal' | 'gamble' | 'guard';
  guardPieceId?: string;
}
export type ShanBoardValidation = ShanBoardQuery<
  { legal: false; code: string } |
  { legal: true; candidate: GameState; action: ShanAction; preview: ShanPreview }
>;
const known = <T>(value: T): ShanBoardQuery<T> => ({ status: 'known', value });
const unknown = (reason: string): { status: 'unknown'; reasons: string[] } => ({ status: 'unknown', reasons: [reason] });
const reject = (code: string): ShanBoardValidation => known({ legal: false, code });
const occupied = (value: object | undefined): boolean => !!value && Object.keys(value).length > 0;
const threatList = (ts: readonly ShanThreat[]) => JSON.stringify([...ts].sort((a, b) => a.pieceId.localeCompare(b.pieceId)));

function scope(state: GameState, shan: ShanState, context: ShanBoardContext): string | undefined {
  // Check the ORIGINAL object before any clone: the existing barrier is a WeakMap.
  try { requireClosedDestructionBatch(state); } catch { return 'OPEN_DESTRUCTION_BATCH'; }
  if (context?.closure !== 'stable') return 'UNATTESTED_ATOMIC_CLOSURE';
  try { ownerShanView(shan, shan.owner); } catch { return 'INVALID_SHAN_STATE'; }
  if (state.gameMode !== 'xiangqi') return 'UNSUPPORTED_BOARD_MODE';
  if (state.status !== 'playing') return 'NOT_PLAYING';
  if (state.turn !== 'red' && state.turn !== 'black' || !Number.isSafeInteger(state.revision) || state.revision < 0) return 'INVALID_BOARD_STATE';
  if (state.featureRules?.mutation || occupied(state.featureRules?.heroes) || occupied(state.featureRules?.heroSelections) ||
      occupied(state.heroFormLock) || occupied(state.heroRuntime) || occupied(state.effectsByPieceId) ||
      occupied(state.assassination) || occupied(state.warrior) || state.forcedDefense || state.flowDance ||
      state.pendingShuffle || state.pendingHeroChild || state.pendingDescent || state.ghosts?.length || state.warps?.length ||
      state.hourglasses !== undefined || state.landingEvents?.length || state.turnLifecycle?.phase === 'atom_closure') return 'UNSUPPORTED_EFFECT_OR_WINDOW';
  const ids = new Set<string>(), squares = new Set<string>();
  if (!Array.isArray(context.ordinaryOriginalPieceIds) || !context.generalIds ||
      !['red', 'black'].includes(shan.owner)) return 'INVALID_AUTHORITY_CONTEXT';
  for (const p of state.pieces) {
    if (p.faceDown || p.layer !== undefined || p.river !== undefined) return 'UNSUPPORTED_PIECE_SPACE_OR_IDENTITY';
    if (!p.id || ids.has(p.id) || !isInsideBoard(p) || squares.has(`${p.x},${p.y}`)) return 'INVALID_BOARD_PIECE';
    if (!['red', 'black'].includes(p.color) || !['general', 'advisor', 'elephant', 'horse', 'rook', 'cannon', 'pawn'].includes(p.type)) return 'UNSUPPORTED_PIECE_TYPE';
    // A live ID in the death ledger is not assumed to be the original incarnation.
    if (!context.ordinaryOriginalPieceIds.includes(p.id) || state.captured.some(c => c.id === p.id) ||
        state.automaticEvents?.some(e => e.pieceId === p.id && /destroy:|reviv|control/i.test(e.kind))) return 'UNSUPPORTED_PIECE_PROVENANCE';
    ids.add(p.id); squares.add(`${p.x},${p.y}`);
  }
  for (const side of ['red', 'black'] as const) {
    const gs = state.pieces.filter((p): p is RevealedPiece => !p.faceDown && p.color === side && p.type === 'general');
    if (gs.length !== 1 || gs[0].id !== context.generalIds[side] || !isInPalace(gs[0], side)) return 'GENERAL_BINDING_OR_PALACE';
    if (side === shan.owner && !samePosition(gs[0], shan.generalPosition)) return 'FIXED_GENERAL_POSITION_MISMATCH';
  }
}

function collectUnchecked(state: GameState, shan: ShanState, context: ShanBoardContext): ShanBoardFacts {
  const pieces = state.pieces as RevealedPiece[];
  const generals = Object.fromEntries((['red', 'black'] as const).map(side =>
    [side, { ...pieces.find(p => p.id === context.generalIds[side])! }])) as Record<Side, RevealedPiece>;
  const threats = (target: Side): ShanThreat[] => {
    const g = generals[target];
    return pieces.filter(p => p.color !== target && canRevealedPieceAttack(state, p, g)).map(p => {
      let path: unknown;
      if (p.type === 'rook') path = p.x === g.x ? ['file', g.x] : ['rank', g.y];
      else if (p.type === 'cannon') path = ['cannon', p.x, p.y, ...pieces.filter(q => q.id !== p.id && q.id !== g.id &&
        (p.x === g.x ? q.x === p.x && q.y > Math.min(p.y, g.y) && q.y < Math.max(p.y, g.y) :
          q.y === p.y && q.x > Math.min(p.x, g.x) && q.x < Math.max(p.x, g.x))).map(q => [q.id, q.x, q.y])];
      else path = [p.type, p.x, p.y];
      return { pieceId: p.id, continuationKey: JSON.stringify([g.id, g.x, g.y, path]) };
    }).sort((a, b) => a.pieceId.localeCompare(b.pieceId));
  };
  return { generals, threatsOnOwner: threats(shan.owner), threatsOnEnemy: threats(otherSide(shan.owner)) };
}

/** Snapshot only. Continuous-check use also requires the transition query below. */
export function collectShanBoardFacts(state: GameState, shan: ShanState, context: ShanBoardContext): ShanBoardQuery<ShanBoardFacts> {
  const reason = scope(state, shan, context);
  return reason ? unknown(reason) : known(collectUnchecked(state, shan, context));
}

function cannonSignature(state: GameState): string {
  const pieces = state.pieces as RevealedPiece[];
  // Conservatively defer any changed cannon ray occupancy, including a removed cannon.
  return JSON.stringify(pieces.filter(p => p.type === 'cannon').sort((a, b) => a.id.localeCompare(b.id)).map(p =>
    [p.id, p.x, p.y, pieces.filter(q => q.x === p.x || q.y === p.y).map(q => [q.id, q.x, q.y]).sort()]));
}

/** Samples must include BOTH sides' stable actions, including an intervening evasion. */
export function collectShanBoardTransition(before: GameState, after: GameState, shan: ShanState,
  context: ShanBoardContext): ShanBoardQuery<ShanBoardFacts> {
  const a = collectShanBoardFacts(before, shan, context);
  if (a.status === 'unknown') return a;
  const b = collectShanBoardFacts(after, shan, context);
  if (b.status === 'unknown') return b;
  for (const p of before.pieces as RevealedPiece[]) {
    const q = after.pieces.find(q => q.id === p.id) as RevealedPiece | undefined;
    if (q && (q.color !== p.color || q.type !== p.type)) return unknown('UNRESOLVED_IDENTITY_OR_CONTROL_CHANGE');
  }
  if (cannonSignature(before) !== cannonSignature(after)) return unknown('UNRESOLVED_CANNON_CONTINUITY');
  return b;
}

export function validateShanBoardChoice(state: GameState, shan: ShanState, context: ShanBoardContext,
  choice: ShanBoardChoice): ShanBoardValidation {
  const before = collectShanBoardFacts(state, shan, context);
  if (before.status === 'unknown') return before;
  if (state.turn !== shan.turn || threatList(before.value.threatsOnOwner) !== threatList(shan.threatsOnOwner) ||
      threatList(before.value.threatsOnEnemy) !== threatList(shan.threatsOnEnemy)) return unknown('STALE_SHAN_BOARD_SNAPSHOT');
  if (choice.expectedRevision !== state.revision) return reject('STALE_BOARD_REVISION');
  if (!['normal', 'gamble', 'guard'].includes(choice.choice)) return reject('INVALID_CHOICE');
  const own = state.turn === shan.owner;
  if (!own && choice.choice !== 'normal') return reject('WRONG_ACTOR');
  if (choice.choice !== 'guard' && choice.guardPieceId !== undefined) return reject('UNEXPECTED_GUARD');
  const source = state.pieces.find(p => p.id === choice.pieceId) as RevealedPiece | undefined;
  if (own && source?.id === context.generalIds[shan.owner]) return reject('GENERAL_FIXED');
  if (choice.choice !== 'normal' && before.value.threatsOnOwner.length === 0) return reject('NOT_IN_CHECK');
  const candidate = structuredClone(state);
  let guard: ShanGuard | undefined;
  if (choice.choice === 'guard') {
    const g = state.pieces.find(p => p.id === choice.guardPieceId) as RevealedPiece | undefined;
    if (!g || g.type !== 'advisor' || g.color !== shan.owner ||
        Math.max(Math.abs(g.x - shan.generalPosition.x), Math.abs(g.y - shan.generalPosition.y)) !== 1) return reject('GUARD_UNAVAILABLE');
    guard = { pieceId: g.id, side: g.color, type: 'advisor', position: { x: g.x, y: g.y }, provenance: 'ordinary_revealed_ground' };
    candidate.pieces = candidate.pieces.filter(p => p.id !== g.id);
  }
  // The exception is local to this isolated special candidate; product rules stay unchanged.
  const move = validatePublicMove(candidate, { pieceId: choice.pieceId, from: choice.from, to: choice.to }, state.turn,
    { allowIntermediateCheck: own && choice.choice !== 'normal' });
  if (!move.ok) return reject(move.code ?? 'ILLEGAL_MOVE');
  const target = pieceAt(candidate, choice.to);
  candidate.pieces = candidate.pieces.filter(p => p.id !== source!.id && p.id !== target?.id);
  candidate.pieces.push({ ...source!, x: choice.to.x, y: choice.to.y });
  // This simulates occupancy only. Real captured/events/resources are a 2B transaction.
  const after = collectShanBoardTransition(state, candidate, shan, context);
  if (after.status === 'unknown') return after;
  const base = { actionId: choice.actionId, expectedRevision: shan.revision, actor: state.turn,
    source: 'ordinary_ground' as const, ordinaryMoveLegal: true, movesGeneral: source!.type === 'general',
    threatsOnOwnerAfter: after.value.threatsOnOwner, threatsOnEnemyAfter: after.value.threatsOnEnemy };
  const action: ShanAction = own ? { ...base, kind: 'own_move', choice: choice.choice,
    ordinaryCheckmate: isCheckmate(candidate, otherSide(shan.owner)), ...(guard ? { guard } : {}) } :
    { ...base, kind: 'enemy_move' };
  try { return known({ legal: true, candidate, action, preview: previewShanAction(shan, action) }); }
  catch (error) {
    if (error instanceof Error && error.name === 'ShanCoreError') return reject(error.message);
    throw error;
  }
}

export interface ShanReplies {
  normal: ShanBoardChoice[];
  special: ShanBoardChoice[];
  /** Present only after a fully covered in-check empty enumeration. */
  noReply?: Extract<ShanAction, { kind: 'no_reply' }>;
}
export type ShanReplyQuery = ShanBoardQuery<ShanReplies>;

export function enumerateShanReplies(state: GameState, shan: ShanState, context: ShanBoardContext): ShanReplyQuery {
  const facts = collectShanBoardFacts(state, shan, context);
  if (facts.status === 'unknown') return facts;
  if (state.turn !== shan.owner || state.turn !== shan.turn ||
      threatList(facts.value.threatsOnOwner) !== threatList(shan.threatsOnOwner) ||
      threatList(facts.value.threatsOnEnemy) !== threatList(shan.threatsOnEnemy)) return unknown('STALE_SHAN_BOARD_SNAPSHOT');
  // Validate core state/outcome even when the board has no non-general sources.
  if (shan.outcome !== null) return unknown('SHAN_ALREADY_FINISHED');
  const replies: ShanReplies = { normal: [], special: [] }, reasons = new Set<string>();
  const guards = (state.pieces as RevealedPiece[]).filter(p => p.color === shan.owner && p.type === 'advisor' &&
    Math.max(Math.abs(p.x - shan.generalPosition.x), Math.abs(p.y - shan.generalPosition.y)) === 1);
  const specialAvailable = facts.value.threatsOnOwner.length > 0 && (shan.life === 'alive' || (shan.remainingEvasions ?? 0) > 0);
  for (const p of state.pieces as RevealedPiece[]) {
    if (p.color !== shan.owner || p.type === 'general') continue;
    const options: Array<{ choice: ShanBoardChoice['choice']; guardPieceId?: string }> = [{ choice: 'normal' }];
    if (specialAvailable) {
      options.push({ choice: 'gamble' });
      if (!shan.guardUsed) options.push(...guards.map(g => ({ choice: 'guard' as const, guardPieceId: g.id })));
    }
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) for (const option of options) {
      const choice: ShanBoardChoice = { actionId: `shan-query:${shan.revision}:${p.id}:${x},${y}:${option.choice}:${option.guardPieceId ?? ''}`,
        expectedRevision: state.revision, pieceId: p.id, from: { x: p.x, y: p.y }, to: { x, y }, ...option };
      const result = validateShanBoardChoice(state, shan, context, choice);
      if (result.status === 'unknown') result.reasons.forEach(r => reasons.add(r));
      else if (result.value.legal) (option.choice === 'normal' ? replies.normal : replies.special).push(choice);
    }
  }
  if (reasons.size) return { status: 'unknown', reasons: [...reasons].sort() };
  if (facts.value.threatsOnOwner.length > 0 && replies.normal.length === 0 && replies.special.length === 0) {
    const noReply: Extract<ShanAction, { kind: 'no_reply' }> = { kind: 'no_reply', actionId: `shan-no-reply:${shan.revision}`,
      expectedRevision: shan.revision, actor: shan.owner, source: 'ordinary_ground', normalReplyExists: false, specialReplyExists: false };
    try { previewShanAction(shan, noReply); }
    catch { return unknown('INVALID_SHAN_NO_REPLY_STATE'); }
    replies.noReply = noReply;
  }
  return known(replies);
}
