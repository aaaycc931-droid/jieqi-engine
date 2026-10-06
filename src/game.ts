import { copy, initializeFeatureSecret, destroyPiece, markRevealed, queueLanding, settleLandings, closeDirectDeaths, generateGhosts, finishFormalTurn, rememberAction, resolveWindReturn } from "./settlement.ts";
import { RuleError } from "./errors.ts";
import { requireModeFeatureAdaptation } from "./modes.ts";
import {
  canRevealedPieceAttack,
  findGeneral,
  isCheckmate,
  isGeneralInCheck,
  isStalemate,
  pieceAt,
  pieceById,
  validatePublicMove,
} from "./rules.ts";
import { getController, getCurrentPieceType, isInPalace, otherSide } from "./slots.ts";
import type {
  CapturedPiece,
  AutomaticExecutionPlan,
  AssassinationCommand,
  AssassinationStates,
  GameState,
  HeroId,
  MutationId,
  MoveCommand,
  MoveResult,
  PublicPiece,
  RevealedPiece,
  SecretIdentity,
  SecretState,
  Side,
  SkillSource,
  WarriorStates,
} from "./types.ts";

function cloneState(state: GameState): GameState { return copy(state); }

function emptyAssassinationStates(): AssassinationStates {
  return {
    red: { heroChargeAvailable: false, mutationChargeAvailable: false },
    black: { heroChargeAvailable: false, mutationChargeAvailable: false },
  };
}

/** Adds public hero/mutation runtime state to a freshly dealt game. */
export function initializeFeatureGameState(
  state: GameState,
  heroes?: Partial<Record<Side, HeroId>>,
  mutation?: MutationId,
): GameState {
  requireModeFeatureAdaptation(state.gameMode, { heroes, mutation });
  const nextState = cloneState(state);
  const assassination = emptyAssassinationStates();
  for (const side of ["red", "black"] as const) {
    assassination[side] = {
      heroChargeAvailable: heroes?.[side] === "rogue",
      mutationChargeAvailable: mutation === "shadow_dance",
    };
  }
  nextState.effectsByPieceId = {};
  nextState.assassination = assassination;
  nextState.featureRules = { ...(heroes ? { heroes: { ...heroes } } : {}), ...(mutation ? { mutation } : {}) };
  const warrior: WarriorStates = { red: { barrierPieceIds: [], ironArmorAvailable: heroes?.red === "warrior" }, black: { barrierPieceIds: [], ironArmorAvailable: heroes?.black === "warrior" } };
  nextState.warrior = heroes?.red === "warrior" || heroes?.black === "warrior" ? warrior : undefined;
  nextState.formalTurns = { red: 0, black: 0 };
  nextState.heroRuntime = {};
  for (const side of ["red", "black"] as const) nextState.heroRuntime[side] = { used: false, invokeCount: 0 };
  return nextState;
}

function removePieceEffects(state: GameState, pieceId: string): void {
  if (!state.effectsByPieceId) return;
  delete state.effectsByPieceId[pieceId];
}

/** Remove just one effect and preserve any other effects attached to the piece. */
function removeBarrierEffect(state: GameState, pieceId: string): void {
  const effects = state.effectsByPieceId?.[pieceId];
  if (!effects?.barrier) return;
  delete effects.barrier;
  if (Object.keys(effects).length === 0) delete state.effectsByPieceId?.[pieceId];
}

function removeStealthEffect(state: GameState, pieceId: string): void {
  const effects = state.effectsByPieceId?.[pieceId];
  if (!effects?.stealth) return;
  delete effects.stealth;
  if (Object.keys(effects).length === 0) delete state.effectsByPieceId?.[pieceId];
}

function captureByCrush(
  state: GameState,
  secret: SecretState,
  pieceId: string,
  actingSide: Side,
): CapturedPiece | undefined {
  return destroyPiece(state, secret, pieceId, actingSide, "crush");
}

/**
 * 战车的合法性只计数非隐身路径棋，但路径上的隐身棋同样要被碾碎；
 * 因此这里按行进顺序返回全部路径受害者。
 */
function pathPiecesForSpecialMove(state: GameState, source: PublicPiece, to: { x: number; y: number }): PublicPiece[] {
  const type = getCurrentPieceType(source);
  if (state.featureRules?.mutation === "iron_steed" && type === "horse") {
    const dx = to.x - source.x;
    const dy = to.y - source.y;
    if ((Math.abs(dx) === 2 && Math.abs(dy) === 1) || (Math.abs(dx) === 1 && Math.abs(dy) === 2)) {
      const leg = Math.abs(dx) === 2 ? { x: source.x + Math.sign(dx), y: source.y } : { x: source.x, y: source.y + Math.sign(dy) };
      const victim = pieceAt(state, leg);
      return victim ? [victim] : [];
    }
  }
  if (state.featureRules?.mutation === "war_chariot" && type === "rook") {
    // This helper also runs before public validation during rewind. A malformed
    // diagonal or fractional destination must not create a nonterminating walk.
    if (![source.x, source.y, to.x, to.y].every(Number.isInteger) || to.x < 0 || to.x > 8 || to.y < 0 || to.y > 9 || source.x !== to.x && source.y !== to.y) return [];
    const dx = Math.sign(to.x - source.x);
    const dy = Math.sign(to.y - source.y);
    let x = source.x + dx;
    let y = source.y + dy;
    const victims: PublicPiece[] = [];
    while (x !== to.x || y !== to.y) {
      const candidate = pieceAt(state, { x, y });
      if (candidate) victims.push(candidate);
      x += dx;
      y += dy;
    }
    return victims;
  }
  return [];
}

function finishDirectDeaths(state: GameState, actingSide: Side, secret: SecretState): boolean {
  settleLandings(state, secret);
  resolveWindReturn(state, secret);
  return closeDirectDeaths(state, secret, actingSide);
}

function clearAssassinationForPiece(state: GameState, pieceId: string): void {
  for (const side of ["red", "black"] as const) {
    if (state.assassination?.[side].activePieceId === pieceId) {
      delete state.assassination[side].activePieceId;
    }
  }
}

function endStealth(state: GameState, pieceId: string): void {
  removeStealthEffect(state, pieceId);
  clearAssassinationForPiece(state, pieceId);
}


function awardWarriorBarrier(
  state: GameState,
  actingSide: Side,
  sourceId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  movedPiece: RevealedPiece | PublicPiece,
): void {
  if (movedPiece.faceDown || movedPiece.type === "general" || state.featureRules?.heroes?.[actingSide] !== "warrior" || !state.warrior?.[actingSide]) return;
  if (getController(movedPiece) !== actingSide || !isInPalace(from, actingSide) || isInPalace(to, actingSide)) return;
  const warrior = state.warrior[actingSide];
  if (warrior.barrierPieceIds.length >= 3 || warrior.barrierPieceIds.includes(sourceId)) return;
  warrior.barrierPieceIds.push(sourceId);
  state.effectsByPieceId ??= {};
  state.effectsByPieceId[sourceId] = {
    ...state.effectsByPieceId[sourceId],
    barrier: { owner: actingSide, enemyTurnsRemaining: 3 },
  };
}

/** End the active side's pending stealth after its next formal action. */
function advanceStealthTurn(
  state: GameState,
  actingSide: Side,
  movedPieceId: string,
  enteredStealth: boolean,
): void {
  if (enteredStealth) return;
  const activePieceId = state.assassination?.[actingSide].activePieceId;
  if (!activePieceId || activePieceId === movedPieceId) return;
  const stealth = state.effectsByPieceId?.[activePieceId]?.stealth;
  if (!stealth) {
    clearAssassinationForPiece(state, activePieceId);
    return;
  }
  endStealth(state, activePieceId);
}

function finishAfterPlayerAction(
  nextState: GameState,
  nextSecret: SecretState,
  command: MoveCommand,
  actingSide: Side,
  sourceWasCovered: boolean,
  movedPiece: RevealedPiece | PublicPiece,
  enteredStealth: boolean,
): void {
  if (nextState.forcedDefense?.responder === actingSide) {
    const resumeTurn = nextState.forcedDefense.resumeTurn;
    delete nextState.forcedDefense;
    if (nextState.lastMove) nextState.lastMove.countsAsFormalTurn = false;
    nextState.turn = resumeTurn;
    nextSecret.processedActions[command.actionId] = nextState.revision;
    return;
  }
  const nextSide = otherSide(actingSide);
  const movedRevealed = movedPiece as RevealedPiece;
  const isInfiniteSting =
    sourceWasCovered && nextState.pieces.some(p => p.id === movedPiece.id) &&
    movedRevealed.color === nextSide &&
    canRevealedPieceAttack(
      nextState,
      movedRevealed,
      findGeneral(nextState, actingSide),
    );

  const hadCheck = isGeneralInCheck(nextState, nextSide);
  if (nextState.featureRules?.heroes?.[actingSide] === "prince" && (nextState.lastMove?.captured || hadCheck)) {
    nextState.heroRuntime ??= {};
    (nextState.heroRuntime[actingSide] ??= {}).carefreeSuspended = true;
  }
  const rainWin = nextState.heroRuntime?.[actingSide]?.rainActive && hadCheck;
  if (rainWin) {
    nextState.status = "finished"; nextState.winner = actingSide; nextState.reason = "rain_night";
    nextSecret.processedActions[command.actionId] = nextState.revision; return;
  }
  generateGhosts(nextState);
  // Backstab armor on the warrior's own formal turn creates an extra response.
  if (!isInfiniteSting) finishFormalTurn(nextState, nextSecret, actingSide);
  if (nextState.status === "finished") { nextSecret.processedActions[command.actionId] = nextState.revision; return; }
  advanceStealthTurn(nextState, actingSide, movedPiece.id, enteredStealth);
  const ironArmor = isInfiniteSting && nextState.warrior?.[actingSide].ironArmorAvailable;
  if (ironArmor) {
    nextState.warrior![actingSide].ironArmorAvailable = false;
    nextState.turn = actingSide;
    nextState.forcedDefense = {
      responder: actingSide,
      resumeTurn: nextSide,
      cause: "iron_armor_blocked_backstab",
    };
    // 铁甲只挡掉“背刺”这个立即失败，不保证一定存在解将。
    // 没有任何合法应将时，直接转为对方的裁决终局。
    if (isCheckmate(nextState, actingSide)) {
      delete nextState.forcedDefense;
      nextState.status = "execution";
      nextState.turn = nextSide;
      nextState.winner = nextSide;
      nextState.reason = "checkmate";
    }
  } else if (isInfiniteSting) {
    nextState.status = "execution";
    nextState.turn = nextSide;
    nextState.winner = nextSide;
    nextState.reason = "ambush";
  } else {
    nextState.turn = nextSide;
    if (isCheckmate(nextState, nextSide)) {
      nextState.status = "execution";
      nextState.turn = actingSide;
      nextState.winner = actingSide;
      nextState.reason = "checkmate";
    } else if (isStalemate(nextState, nextSide)) {
      nextState.status = "finished";
      nextState.winner = actingSide;
      nextState.reason = "stalemate";
    }
  }
  nextSecret.processedActions[command.actionId] = nextState.revision;
}

/**
 * A hunter trap is resolved by the room layer because its coordinates are
 * private.  The normal move has already performed its post-move check before
 * that private effect is known, so remove a now-invalid execution result and
 * evaluate the final public board again.  Backstab cannot survive here: the
 * trap has killed the moving piece that could have revealed it.
 */
export function reassessAfterTrapResolution(state: GameState): void {
  // A move may have been provisionally judged as stalemate before the private
  // trap killed its landing piece.  Other finished states are direct-death
  // outcomes and must remain authoritative.
  if (state.status === "finished" && state.reason !== "stalemate") return;
  if (state.status === "finished") {
    state.status = "playing";
    delete state.winner;
    delete state.reason;
  }
  if (state.status === "execution") {
    const actor = state.lastMove?.actingSide;
    if (actor) state.turn = otherSide(actor);
    state.status = "playing";
    delete state.winner;
    delete state.reason;
  }
  const defendingSide = state.turn;
  if (isCheckmate(state, defendingSide)) {
    state.status = "execution";
    state.turn = otherSide(defendingSide);
    state.winner = otherSide(defendingSide);
    state.reason = "checkmate";
    return;
  }
  if (isStalemate(state, defendingSide)) {
    state.status = "finished";
    state.winner = otherSide(defendingSide);
    state.reason = "stalemate";
  }
}

function cloneSecret(secret: SecretState): SecretState { return copy(secret); }

function requireIdentity(
  secret: SecretState,
  pieceId: string,
): SecretIdentity {
  const identity = secret.identities[pieceId];
  if (!identity) {
    throw new RuleError("MISSING_SECRET", `暗子 ${pieceId} 缺少真实身份`);
  }
  return { ...identity };
}

function validationError(code = "INVALID_MOVE", message = "落子不合法"): never {
  throw new RuleError(code, message);
}

/** A deliberate 铁马/战车路径碾碎 of the mover's own general is a valid
 * terminal action.  The ordinary self-check simulator cannot see that the
 * general will be removed later in the same atomic action, so only this
 * narrow case may bypass SELF_CHECK. */
function permitsSelfCrushingGeneral(
  state: GameState,
  command: MoveCommand,
  actingSide: Side,
): boolean {
  const source = command.pieceId ? pieceById(state, command.pieceId) : pieceAt(state, command.from);
  if (!source) return false;
  return pathPiecesForSpecialMove(state, source, command.to).some(
    (piece) => !piece.faceDown && piece.color === actingSide && piece.type === "general",
  );
}

export function getExecutionCapturers(state: GameState): RevealedPiece[] {
  if (state.status !== "execution" || !state.winner) return [];
  const target = findGeneral(state, otherSide(state.winner));
  return state.pieces.filter(
    (piece): piece is RevealedPiece =>
      !piece.faceDown &&
      piece.color === state.winner &&
      canRevealedPieceAttack(state, piece, target),
  );
}

/**
 * Returns the forced final capture for a decided game.  No player choice is
 * involved: 背刺 always uses the newly revealed piece, while 裁决 prefers the
 * piece that made the last move and otherwise uses a stable board-order tie
 * break for rare double-check positions.
 */
export function getAutomaticExecutionPlan(
  state: GameState,
): AutomaticExecutionPlan | undefined {
  if (state.status !== "execution" || !state.winner || !state.reason) return undefined;
  const target = findGeneral(state, otherSide(state.winner));
  const capturers = getExecutionCapturers(state);
  if (capturers.length === 0) return undefined;

  const lastMover = state.lastMove
    ? capturers.find((piece) => piece.id === state.lastMove?.pieceId)
    : undefined;
  const source = state.reason === "ambush"
    ? lastMover
    : lastMover ?? [...capturers].sort(
      (first, second) => first.y - second.y || first.x - second.x || first.id.localeCompare(second.id),
    )[0];
  if (!source) return undefined;
  return {
    pieceId: source.id,
    from: { x: source.x, y: source.y },
    to: { x: target.x, y: target.y },
  };
}

function validateRewindReplay(state: GameState, secret: SecretState, command: MoveCommand): void {
  if (secret.replay && (pieceAt(state, command.from)?.id !== secret.replay.pieceId || pieceAt(state, command.to) || pathPiecesForSpecialMove(state, pieceAt(state, command.from)!, command.to).length)) {
    throw new RuleError("REWIND_REPLAY", "回溯重走必须同棋且不能进攻");
  }
}

export function applyAuthoritativeMove(
  state: GameState,
  secret: SecretState,
  command: MoveCommand,
  deferTurnEnd = false,
  now = Date.now(),
): MoveResult {
  if (state.flowDance && !deferTurnEnd) return applyFlowDance(state, secret, command);
  if (secret.processedActions[command.actionId] !== undefined) {
    return {
      state: cloneState(state),
      secret: cloneSecret(secret),
      duplicate: true,
    };
  }
  if (command.expectedRevision !== state.revision) {
    throw new RuleError("STALE_REVISION", "客户端棋局版本已经过期");
  }

  validateRewindReplay(state, secret, command);
  const validation = validatePublicMove(state, command, state.turn, { allowLinkedControl: deferTurnEnd });
  if (!validation.ok && !(validation.code === "SELF_CHECK" && permitsSelfCrushingGeneral(state, command, state.turn))) {
    validationError(validation.code, validation.message);
  }

  const nextState = cloneState(state);
  const nextSecret = cloneSecret(secret);
  initializeFeatureSecret(nextState, nextSecret);
  nextState.automaticEvents = [];
  nextState.landingEvents = [];
  if (!deferTurnEnd) rememberAction(state, nextSecret, (command.pieceId ? pieceById(state, command.pieceId) : pieceAt(state, command.from))?.id, pathPiecesForSpecialMove(state, (command.pieceId ? pieceById(state, command.pieceId) : pieceAt(state, command.from))!, command.to).length ? 2 : 1, command.from, now);
  const actingSide = state.turn;
  const source = command.pieceId ? pieceById(nextState, command.pieceId) : pieceAt(nextState, command.from);
  if (!source) validationError("NO_PIECE", "起点没有棋子");
  const target = source.layer === "air" ? undefined : pieceAt(nextState, command.to);
  const sourceWasCovered = source.faceDown;

  const pathVictims = pathPiecesForSpecialMove(nextState, source, command.to);
  if (source.layer === "air" && pathVictims.length) throw new RuleError("FLIGHT_NO_ATTACK", "飞行棋不能主动路径碾碎");
  const pathCrushed = pathVictims.flatMap((pathVictim) => {
    const captured = captureByCrush(nextState, nextSecret, pathVictim.id, actingSide);
    return captured ? [captured] : [];
  });

  // 普通攻击撞到壁垒：目标留在原处，防御消耗，攻击者弹回起点。
  if (target && nextState.effectsByPieceId?.[target.id]?.barrier) {
    removeBarrierEffect(nextState, target.id);
    nextState.revision = state.revision + 1;
    nextState.lastMove = {
      actionId: command.actionId,
      pieceId: source.id,
      actingSide,
      from: { ...command.from },
      to: { ...command.to },
      pathCrushed,
      bouncedAgainstPieceId: target.id,
      landed: false,
    };
    queueLanding(nextState, source, actingSide, "warrior_return");
    if (finishDirectDeaths(nextState, actingSide, nextSecret)) {
      nextSecret.processedActions[command.actionId] = nextState.revision;
      return { state: nextState, secret: nextSecret, duplicate: false };
    }
    finishAfterPlayerAction(nextState, nextSecret, command, actingSide, false, source, false);
    return { state: nextState, secret: nextSecret, duplicate: false };
  }

  const captured = target ? destroyPiece(nextState, nextSecret, target.id, actingSide, "attack") : undefined;

  let revealed: SecretIdentity | undefined;
  let movedPiece: RevealedPiece | PublicPiece;
  if (source.faceDown) {
    revealed = requireIdentity(nextSecret, source.id);
    delete nextSecret.identities[source.id];
    movedPiece = {
      id: source.id,
      x: command.to.x,
      y: command.to.y,
      faceDown: false,
      color: revealed.color,
      type: revealed.type,
    };
  } else {
    movedPiece = { ...source, x: command.to.x, y: command.to.y };
  }

  nextState.pieces = [
    ...nextState.pieces.filter(
      (piece) => piece.id !== source.id && piece.id !== target?.id,
    ),
    movedPiece,
  ];
  markRevealed(nextState, nextSecret, source.id);
  queueLanding(nextState, movedPiece, actingSide, "action");
  if (nextSecret.replay && isGeneralInCheck(nextState, otherSide(actingSide))) throw new RuleError("REWIND_REPLAY_CHECK", "回溯重走不能形成将军");
  delete nextSecret.replay;
  awardWarriorBarrier(nextState, actingSide, source.id, command.from, command.to, movedPiece);
  nextState.revision = state.revision + 1;
  nextState.lastMove = {
    actionId: command.actionId,
    pieceId: source.id,
    actingSide,
    from: { ...command.from },
    to: { ...command.to },
    captured,
    pathCrushed,
    revealed,
    landed: true,
    tier: pathVictims.length > 0 ? 2 : 1,
    keywords: [target || pathVictims.length > 0 ? "进攻" : "移动"],
  };


  if (finishDirectDeaths(nextState, actingSide, nextSecret)) {
    nextSecret.processedActions[command.actionId] = nextState.revision;
    return { state: nextState, secret: nextSecret, duplicate: false };
  }

  if (deferTurnEnd) {
    nextSecret.processedActions[command.actionId] = nextState.revision;
    return { state: nextState, secret: nextSecret, duplicate: false };
  }
  finishAfterPlayerAction(
    nextState,
    nextSecret,
    command,
    actingSide,
    sourceWasCovered,
    movedPiece,
    false,
  );
  return { state: nextState, secret: nextSecret, duplicate: false };
}

function consumeAssassinationCharge(
  state: GameState,
  side: Side,
  source: SkillSource,
): void {
  const skills = state.assassination?.[side];
  if (!skills) throw new RuleError("NO_ASSASSINATION", "该方没有可用的刺杀技能");
  const property = source === "hero" ? "heroChargeAvailable" : "mutationChargeAvailable";
  if (!skills[property]) {
    throw new RuleError("ASSASSINATION_UNAVAILABLE", "该来源的刺杀次数已经用完");
  }
  skills[property] = false;
}

/**
 * Resolves either the initial Rogue/Shadow Dance assassination action or the
 * early move of its already-stealthed piece. A new charge may either move to
 * an empty square and retain its strike, or spend that strike immediately on
 * a legal target. Both initial choices enter one owner-turn of stealth.
 */
export function applyAuthoritativeAssassination(
  state: GameState,
  secret: SecretState,
  command: AssassinationCommand,
  now = Date.now(),
): MoveResult {
  if (secret.processedActions[command.actionId] !== undefined) {
    return { state: cloneState(state), secret: cloneSecret(secret), duplicate: true };
  }
  if (command.expectedRevision !== state.revision) {
    throw new RuleError("STALE_REVISION", "客户端棋局版本已经过期");
  }
  if (state.flowDance) throw new RuleError("FLOW_ACTION_REQUIRED", "须先完成流·舞归位结算");
  validateRewindReplay(state, secret, command);

  const actingSide = state.turn;
  const sourcePiece = pieceAt(state, command.from);
  if (!sourcePiece) validationError("NO_PIECE", "起点没有棋子");
  const activePieceId = state.assassination?.[actingSide].activePieceId;
  const continuing = activePieceId === sourcePiece.id;
  if (activePieceId && !continuing) {
    throw new RuleError("ASSASSINATION_ACTIVE", "必须先结束当前刺杀隐身状态");
  }
  if (continuing) {
    if (command.source) {
      throw new RuleError("INVALID_ASSASSINATION_SOURCE", "隐身后的行动不应重复指定刺杀来源");
    }
    if (!state.effectsByPieceId?.[sourcePiece.id]?.stealth) {
      throw new RuleError("MISSING_STEALTH", "刺杀隐身状态已经失效");
    }
    if (command.useStrongStrike && !state.effectsByPieceId[sourcePiece.id].stealth?.strongStrikeAvailable) {
      throw new RuleError("STRONG_STRIKE_UNAVAILABLE", "该隐身棋已经没有可用强击");
    }
  } else {
    if (command.source !== "hero" && command.source !== "mutation") {
      throw new RuleError("MISSING_ASSASSINATION_SOURCE", "发动刺杀必须选择技能来源");
    }
    if (!command.source) {
      throw new RuleError("MISSING_ASSASSINATION_SOURCE", "发动刺杀必须选择技能来源");
    }
    if (sourcePiece.faceDown || sourcePiece.type === "general") {
      throw new RuleError("INVALID_ASSASSINATION_PIECE", "刺杀只能选择己方非将帅明棋");
    }
    if (command.useStrongStrike) throw new RuleError("ASSASSINATION_DELAYED", "发动回合不能使用强击");
    if (pieceAt(state, command.to)) {
      throw new RuleError("ASSASSINATION_FIRST_MOVE_MUST_BE_EMPTY", "刺杀首次行动只能移动到空位，不能吃子");
    }
  }

  const validation = validatePublicMove(state, command, actingSide, {
    allowStealthSource: continuing,
    allowGeneralTarget: command.useStrongStrike,
    requireCapture: command.useStrongStrike,
  });
  if (!validation.ok && !(validation.code === "SELF_CHECK" && permitsSelfCrushingGeneral(state, command, actingSide))) {
    validationError(validation.code, validation.message);
  }

  const nextState = cloneState(state);
  const nextSecret = cloneSecret(secret);
  initializeFeatureSecret(nextState, nextSecret);
  nextState.automaticEvents = [];
  nextState.landingEvents = [];
  rememberAction(state, nextSecret, sourcePiece.id, 2, command.from, now);
  const source = command.pieceId ? pieceById(nextState, command.pieceId) : pieceAt(nextState, command.from);
  if (!source) validationError("NO_PIECE", "起点没有棋子");
  const target = source.layer === "air" ? undefined : pieceAt(nextState, command.to);
  const sourceWasCovered = source.faceDown;
  if (command.useStrongStrike && target && !target.faceDown && target.type === "general" && nextState.warrior?.[target.color]?.ironArmorAvailable) {
    nextState.warrior[target.color].ironArmorAvailable = false;
    endStealth(nextState, source.id);
    nextState.revision += 1;
    nextState.lastMove = { actionId: command.actionId, pieceId: source.id, actingSide, from: { ...command.from }, to: { ...command.to }, landed: false, tier: 2, keywords: ["进攻", "强击"] };
    finishAfterPlayerAction(nextState, nextSecret, command, actingSide, false, source, false);
    return { state: nextState, secret: nextSecret, duplicate: false };
  }
  if (!continuing) consumeAssassinationCharge(nextState, actingSide, command.source as SkillSource);

  const pathVictims = pathPiecesForSpecialMove(nextState, source, command.to);
  if (source.layer === "air" && pathVictims.length) throw new RuleError("FLIGHT_NO_ATTACK", "飞行棋不能主动路径碾碎");
  const pathCrushed = pathVictims.flatMap((pathVictim) => {
    const captured = captureByCrush(nextState, nextSecret, pathVictim.id, actingSide);
    return captured ? [captured] : [];
  });

  // 隐身后的普通刺杀攻击被壁垒弹回，并在原位结束隐身。
  if (target && nextState.effectsByPieceId?.[target.id]?.barrier && !command.useStrongStrike) {
    removeBarrierEffect(nextState, target.id);
    nextState.revision = state.revision + 1;
    nextState.lastMove = {
      actionId: command.actionId,
      pieceId: source.id,
      actingSide,
      from: { ...command.from },
      to: { ...command.to },
      pathCrushed,
      bouncedAgainstPieceId: target.id,
      landed: false,
    };
    if (continuing) endStealth(nextState, source.id);
    queueLanding(nextState, source, actingSide, "warrior_return");
    if (finishDirectDeaths(nextState, actingSide, nextSecret)) {
      nextSecret.processedActions[command.actionId] = nextState.revision;
      return { state: nextState, secret: nextSecret, duplicate: false };
    }
    finishAfterPlayerAction(nextState, nextSecret, command, actingSide, false, source, false);
    return { state: nextState, secret: nextSecret, duplicate: false };
  }

  const captured = target ? destroyPiece(nextState, nextSecret, target.id, actingSide, command.useStrongStrike ? "strong_strike" : "attack") : undefined;

  const movedPiece: RevealedPiece | PublicPiece = source.faceDown
    ? (() => {
        const revealed = requireIdentity(nextSecret, source.id);
        delete nextSecret.identities[source.id];
        return { id: source.id, x: command.to.x, y: command.to.y, faceDown: false, ...revealed };
      })()
    : { ...source, x: command.to.x, y: command.to.y };
  nextState.pieces = [
    ...nextState.pieces.filter((piece) => piece.id !== source.id && piece.id !== target?.id),
    movedPiece,
  ];
  nextState.revision = state.revision + 1;
  nextState.lastMove = {
    actionId: command.actionId,
    pieceId: source.id,
    actingSide,
    from: { ...command.from },
    to: { ...command.to },
    captured,
    pathCrushed,
    landed: true,
    tier: 2,
    keywords: [target || pathVictims.length > 0 ? "进攻" : "移动", ...(command.useStrongStrike ? ["强击"] : ["耗费"])],
  };

  markRevealed(nextState, nextSecret, source.id);
  queueLanding(nextState, movedPiece, actingSide, "action");
  awardWarriorBarrier(nextState, actingSide, source.id, command.from, command.to, movedPiece);


  if (finishDirectDeaths(nextState, actingSide, nextSecret)) {
    nextSecret.processedActions[command.actionId] = nextState.revision;
    return { state: nextState, secret: nextSecret, duplicate: false };
  }

  const entersStealth = !continuing;
  if (continuing) endStealth(nextState, source.id);
  if (entersStealth) {
    const skillState = nextState.assassination?.[actingSide];
    if (!skillState) throw new RuleError("NO_ASSASSINATION", "该方没有可用的刺杀技能");
    nextState.effectsByPieceId ??= {};
    nextState.effectsByPieceId[source.id] = {
      ...nextState.effectsByPieceId[source.id],
      stealth: {
        owner: actingSide,
        remainingOwnerTurns: 1,
        strongStrikeAvailable: !command.useStrongStrike,
        source: command.source as SkillSource,
      },
    };
    skillState.activePieceId = source.id;
  }

  // A rewind may restore a pending stealth exit.  Its action still obeys
  // same-piece, no attack and no check, after the final stealth transition.
  if (nextSecret.replay && isGeneralInCheck(nextState, otherSide(actingSide))) throw new RuleError("REWIND_REPLAY_CHECK", "回溯重走不能形成将军");
  delete nextSecret.replay;

  finishAfterPlayerAction(
    nextState,
    nextSecret,
    command,
    actingSide,
    sourceWasCovered,
    movedPiece,
    entersStealth,
  );
  return { state: nextState, secret: nextSecret, duplicate: false };
}

export function applyAutomaticExecution(
  state: GameState,
  secret: SecretState,
  actionId: string,
): MoveResult {
  if (secret.processedActions[actionId] !== undefined) {
    return { state: cloneState(state), secret: cloneSecret(secret), duplicate: true };
  }
  if (state.status !== "execution" || !state.winner) {
    throw new RuleError("NOT_EXECUTION", "当前不是自动终结阶段");
  }

  const plan = getAutomaticExecutionPlan(state);
  if (!plan) throw new RuleError("MISSING_EXECUTION", "找不到可执行终结的棋子");
  const source = pieceAt(state, plan.from);
  const target = pieceAt(state, plan.to);
  if (!source || source.faceDown || !target || target.faceDown || target.type !== "general") {
    throw new RuleError("INVALID_EXECUTION", "自动终结棋局状态无效");
  }

  const nextState = cloneState(state);
  const nextSecret = cloneSecret(secret);
  initializeFeatureSecret(nextState, nextSecret);
  nextState.automaticEvents = [];
  const pathCrushed = pathPiecesForSpecialMove(nextState, source, plan.to).flatMap(p => {
    const record = destroyPiece(nextState, nextSecret, p.id, state.winner!, "crush");
    return record ? [record] : [];
  });
  const captured = destroyPiece(nextState, nextSecret, target.id, state.winner, state.reason === "checkmate" ? "execution" : "ambush")!;
  nextState.pieces = [
    ...nextState.pieces.filter((piece) => piece.id !== source.id && piece.id !== target.id),
    { ...source, x: plan.to.x, y: plan.to.y },
  ];
  removePieceEffects(nextState, target.id);
  clearAssassinationForPiece(nextState, target.id);
  nextState.revision += 1;
  nextState.lastMove = {
    actionId,
    pieceId: source.id,
    actingSide: state.winner,
    from: { ...plan.from },
    to: { ...plan.to },
    captured,
    pathCrushed,
  };
  nextState.status = "finished";
  if (pathCrushed.some(p => p.type === "general")) closeDirectDeaths(nextState, nextSecret, state.winner);
  if (state.reason === "checkmate" && resolveWindReturn(nextState, nextSecret, { pieceId: source.id, from: plan.from })) {
    if (!closeDirectDeaths(nextState, nextSecret, state.winner)) {
      nextState.status = "playing"; delete nextState.winner; delete nextState.reason;
      nextState.turn = nextState.flowDance!.side;
      if (!flowHasEscape(nextState)) {
        delete nextState.flowDance;
        nextState.status = "execution"; nextState.winner = state.winner; nextState.turn = state.winner; nextState.reason = "checkmate";
        return applyAutomaticExecution(nextState, nextSecret, `${actionId}:flow-failed`);
      }
    }
  }
  nextSecret.processedActions[actionId] = nextState.revision;
  return { state: nextState, secret: nextSecret, duplicate: false };
}

function flowTargets(state: GameState): Array<{ x: number; y: number }> {
  const flow = state.flowDance;
  if (!flow) return [];
  const p = state.pieces.find(p => p.id === flow.pieceId);
  if (!p) return [];
  return [{ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }].filter(to =>
    isInPalace(to, flow.side) && validatePublicMove(state, { from: p, to }, flow.side, { allowIntermediateCheck: true }).ok);
}
function simulateFlowStep(state: GameState, to: { x: number; y: number }): GameState {
  const next = cloneState(state), p = next.pieces.find(p => p.id === next.flowDance?.pieceId)!;
  const target = pieceAt(next, to);
  if (target && next.effectsByPieceId?.[target.id]?.barrier) {
    // 普通防御拦截后留在原格；不能把被弹回的进攻当成安全落点。
    removeBarrierEffect(next, target.id);
  } else {
    next.pieces = next.pieces.filter(q => q.id !== target?.id || q.id === p.id);
    if (target) removePieceEffects(next, target.id);
    p.x = to.x; p.y = to.y;
  }
  next.flowDance!.steps = 1;
  return next;
}
/** 第一步允许受将，第二步必须解将。 */
export function getFlowDanceMoves(state: GameState, pieceId: string): Array<{ x: number; y: number }> {
  if (state.flowDance?.pieceId !== pieceId) return [];
  return flowTargets(state).filter(to => state.flowDance!.steps === 0 || !isGeneralInCheck(simulateFlowStep(state, to), state.flowDance!.side));
}
function flowHasEscape(state: GameState): boolean {
  const side = state.flowDance!.side;
  return flowTargets(state).some(to => {
    const intermediate = simulateFlowStep(state, to);
    if (!isGeneralInCheck(intermediate, side)) return true;
    if (state.flowDance!.steps === 1) return false;
    return flowTargets(intermediate).some(second => !isGeneralInCheck(simulateFlowStep(intermediate, second), side));
  });
}
function applyFlowDance(state: GameState, secret: SecretState, command: MoveCommand): MoveResult {
  if (secret.processedActions[command.actionId] !== undefined) return { state: cloneState(state), secret: cloneSecret(secret), duplicate: true };
  if (command.expectedRevision !== state.revision) throw new RuleError("STALE_REVISION", "客户端棋局版本已经过期");
  const flow = state.flowDance!;
  const p = state.pieces.find(p => p.id === flow.pieceId)!;
  if (command.from.x !== p.x || command.from.y !== p.y || !flowTargets(state).some(to => to.x === command.to.x && to.y === command.to.y)) throw new RuleError("INVALID_FLOW_STEP", "流·舞只能将帅在九宫内连续一格正交行动");
  // 中间步的受将豁免只适用于本特殊结算。
  const validationState = cloneState(state);
  const saved = validationState.flowDance; delete validationState.flowDance;
  const originalGeneral = validationState.pieces.find(q => q.id === p.id)!;
  const validation = validatePublicMove(validationState, command, flow.side, { allowIntermediateCheck: true });
  if (!validation.ok) throw new RuleError(validation.code!, validation.message!);
  const newSecret = cloneSecret(secret);
  const target = pieceAt(validationState, command.to);
  validationState.automaticEvents = []; validationState.landingEvents = [];
  const bounced = Boolean(target && validationState.effectsByPieceId?.[target.id]?.barrier);
  let captured: CapturedPiece | undefined;
  if (bounced) {
    removeBarrierEffect(validationState, target!.id);
    queueLanding(validationState, originalGeneral, flow.side, "warrior_return");
  } else {
    if (target) captured = destroyPiece(validationState, newSecret, target.id, flow.side, "flow_attack");
    originalGeneral.x = command.to.x; originalGeneral.y = command.to.y;
    queueLanding(validationState, originalGeneral, flow.side, "flow_dance");
  }
  settleLandings(validationState, newSecret);
  validationState.revision += 1;
  validationState.lastMove = {
    actionId: command.actionId, pieceId: p.id, actingSide: flow.side,
    from: { ...command.from }, to: { ...command.to }, captured,
    ...(bounced ? { bouncedAgainstPieceId: target!.id } : {}),
    landed: !bounced, countsAsFormalTurn: false, tier: 3,
    keywords: [target ? "进攻" : "移动"],
  };
  if (!closeDirectDeaths(validationState, newSecret, flow.side)) {
    generateGhosts(validationState);
    if (!isGeneralInCheck(validationState, flow.side)) {
      validationState.turn = flow.resumeTurn;
    } else if (flow.steps === 0) {
      validationState.flowDance = { ...saved!, steps: 1 };
      if (!flowHasEscape(validationState)) {
        delete validationState.flowDance; validationState.status = "execution";
        validationState.winner = otherSide(flow.side); validationState.turn = otherSide(flow.side); validationState.reason = "checkmate";
      }
    } else {
      validationState.status = "execution"; validationState.winner = otherSide(flow.side); validationState.turn = otherSide(flow.side); validationState.reason = "checkmate";
    }
  }
  newSecret.processedActions[command.actionId] = validationState.revision;
  return { state: validationState, secret: newSecret, duplicate: false };
}

export function applyResignation(
  state: GameState,
  secret: SecretState,
  side: Side,
  expectedRevision: number,
  actionId: string,
): MoveResult {
  if (secret.processedActions[actionId] !== undefined) {
    return {
      state: cloneState(state),
      secret: cloneSecret(secret),
      duplicate: true,
    };
  }
  if (expectedRevision !== state.revision) {
    throw new RuleError("STALE_REVISION", "客户端棋局版本已经过期");
  }
  if (state.status !== "playing") {
    throw new RuleError("GAME_FINISHED", "对局已经结束");
  }

  const nextState = cloneState(state);
  const nextSecret = cloneSecret(secret);
  nextState.status = "finished";
  nextState.winner = otherSide(side);
  nextState.reason = "resign";
  nextState.revision += 1;
  nextSecret.processedActions[actionId] = nextState.revision;
  return { state: nextState, secret: nextSecret, duplicate: false };
}

export function publicStateSnapshot(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
