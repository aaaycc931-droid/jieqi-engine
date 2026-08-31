import { RuleError } from "./errors.js";
import {
  canRevealedPieceAttack,
  findGeneral,
  isCheckmate,
  isStalemate,
  pieceAt,
  validatePublicMove,
} from "./rules.js";
import { getController, getMovementIdentity, isInPalace, otherSide } from "./slots.js";
             
                
                         
                       
                      
            
         
             
              
             
              
                
                 
              
       
              
                
                    

function cloneState(state           )            {
  return {
    ...state,
    pieces: state.pieces.map((piece) => ({ ...piece })),
    captured: state.captured.map((piece) => ({ ...piece })),
    effectsByPieceId: Object.fromEntries(
      Object.entries(state.effectsByPieceId ?? {}).map(([id, effects]) => [
        id,
        {
          ...effects,
          ...(effects.stealth ? { stealth: { ...effects.stealth } } : {}),
          ...(effects.barrier ? { barrier: { ...effects.barrier } } : {}),
        },
      ]),
    ),
    assassination: state.assassination
      ? {
          red: { ...state.assassination.red },
          black: { ...state.assassination.black },
        }
      : undefined,
    warrior: state.warrior ? { red: { barrierPieceIds: [...state.warrior.red.barrierPieceIds], ironArmorAvailable: state.warrior.red.ironArmorAvailable }, black: { barrierPieceIds: [...state.warrior.black.barrierPieceIds], ironArmorAvailable: state.warrior.black.ironArmorAvailable } } : undefined,
    forcedDefense: state.forcedDefense ? { ...state.forcedDefense } : undefined,
    featureRules: state.featureRules ? { heroes: state.featureRules.heroes ? { ...state.featureRules.heroes } : undefined, mutation: state.featureRules.mutation } : undefined,
    lastMove: state.lastMove
      ? {
          ...state.lastMove,
          from: { ...state.lastMove.from },
          to: { ...state.lastMove.to },
          captured: state.lastMove.captured
            ? { ...state.lastMove.captured }
            : undefined,
          pathCrushed: state.lastMove.pathCrushed?.map((captured) => ({ ...captured })),
          revealed: state.lastMove.revealed
            ? { ...state.lastMove.revealed }
            : undefined,
        }
      : undefined,
  };
}

function emptyAssassinationStates()                      {
  return {
    red: { heroChargeAvailable: false, mutationChargeAvailable: false },
    black: { heroChargeAvailable: false, mutationChargeAvailable: false },
  };
}

/** Adds public hero/mutation runtime state to a freshly dealt game. */
export function initializeFeatureGameState(
  state           ,
  heroes                                ,
  mutation             ,
)            {
  const nextState = cloneState(state);
  const assassination = emptyAssassinationStates();
  for (const side of ["red", "black"]         ) {
    assassination[side] = {
      heroChargeAvailable: heroes?.[side] === "rogue",
      mutationChargeAvailable: mutation === "shadow_dance",
    };
  }
  nextState.effectsByPieceId = {};
  nextState.assassination = assassination;
  nextState.featureRules = { ...(heroes ? { heroes: { ...heroes } } : {}), ...(mutation ? { mutation } : {}) };
  const warrior                = { red: { barrierPieceIds: [], ironArmorAvailable: heroes?.red === "warrior" }, black: { barrierPieceIds: [], ironArmorAvailable: heroes?.black === "warrior" } };
  nextState.warrior = heroes?.red === "warrior" || heroes?.black === "warrior" ? warrior : undefined;
  if (mutation === "cavalry") {
    for (const piece of nextState.pieces) {
      if (piece.faceDown && (piece.y === 3 || piece.y === 6) && (piece.x === 0 || piece.x === 4 || piece.x === 8)) {
        nextState.effectsByPieceId [piece.id] = { cavalry: true };
      }
    }
  }
  return nextState;
}

function removePieceEffects(state           , pieceId        )       {
  if (!state.effectsByPieceId) return;
  delete state.effectsByPieceId[pieceId];
}

/** Remove just one effect and preserve any other effects attached to the piece. */
function removeBarrierEffect(state           , pieceId        )       {
  const effects = state.effectsByPieceId?.[pieceId];
  if (!effects?.barrier) return;
  delete effects.barrier;
  if (Object.keys(effects).length === 0) delete state.effectsByPieceId?.[pieceId];
}

function removeStealthEffect(state           , pieceId        )       {
  const effects = state.effectsByPieceId?.[pieceId];
  if (!effects?.stealth) return;
  delete effects.stealth;
  if (Object.keys(effects).length === 0) delete state.effectsByPieceId?.[pieceId];
}

function captureByCrush(
  state           ,
  secret             ,
  pieceId        ,
  actingSide      ,
)                            {
  const victim = state.pieces.find((piece) => piece.id === pieceId);
  if (!victim) return undefined;
  const identity = victim.faceDown ? requireIdentity(secret, victim.id) : { color: victim.color, type: victim.type };
  if (victim.faceDown) delete secret.identities[victim.id];
  const captured = { id: victim.id, ...identity, capturedBy: actingSide, moveNumber: state.revision + 1 };
  state.captured.push(captured);
  state.pieces = state.pieces.filter((piece) => piece.id !== victim.id);
  removePieceEffects(state, victim.id);
  clearAssassinationForPiece(state, victim.id);
  return captured;
}

/**
 * 战车的合法性只计数非隐身路径棋，但路径上的隐身棋同样要被碾碎；
 * 因此这里按行进顺序返回全部路径受害者。
 */
function pathPiecesForSpecialMove(state           , source             , to                          )                {
  const movement = getMovementIdentity(source);
  if (state.featureRules?.mutation === "iron_steed" && movement.type === "horse") {
    const dx = to.x - source.x;
    const dy = to.y - source.y;
    if ((Math.abs(dx) === 2 && Math.abs(dy) === 1) || (Math.abs(dx) === 1 && Math.abs(dy) === 2)) {
      const leg = Math.abs(dx) === 2 ? { x: source.x + Math.sign(dx), y: source.y } : { x: source.x, y: source.y + Math.sign(dy) };
      const victim = pieceAt(state, leg);
      return victim ? [victim] : [];
    }
  }
  if (state.featureRules?.mutation === "war_chariot" && movement.type === "rook") {
    const dx = Math.sign(to.x - source.x);
    const dy = Math.sign(to.y - source.y);
    let x = source.x + dx;
    let y = source.y + dy;
    const victims                = [];
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

function finishDirectDeaths(state           , actingSide      )          {
  const redAlive = state.pieces.some((piece) => !piece.faceDown && piece.color === "red" && piece.type === "general");
  const blackAlive = state.pieces.some((piece) => !piece.faceDown && piece.color === "black" && piece.type === "general");
  if (redAlive && blackAlive) return false;
  state.status = "finished";
  if (!redAlive && !blackAlive) {
    state.drawReason = "mutual_destruction";
    return true;
  }
  state.winner = redAlive ? "red" : "black";
  state.reason = state.winner === actingSide ? "crush_them" : "rampage";
  return true;
}

function clearAssassinationForPiece(state           , pieceId        )       {
  for (const side of ["red", "black"]         ) {
    if (state.assassination?.[side].activePieceId === pieceId) {
      delete state.assassination[side].activePieceId;
    }
  }
}

function endStealth(state           , pieceId        )       {
  removeStealthEffect(state, pieceId);
  clearAssassinationForPiece(state, pieceId);
}

function advanceBarrierAfterMove(state           , pieceId        , y        )       {
  const barrier = state.effectsByPieceId?.[pieceId]?.barrier;
  if (!barrier) return;
  const inEnemyHalf = barrier.owner === "red" ? y <= 4 : y >= 5;
  if (!barrier.enemyHalfEntered && inEnemyHalf) { barrier.enemyHalfEntered = true; return; }
  if (barrier.enemyHalfEntered && barrier.movesAfterEnemyHalfEntry === 0) { barrier.movesAfterEnemyHalfEntry = 1; return; }
  if (barrier.enemyHalfEntered) removeBarrierEffect(state, pieceId);
}

function awardWarriorBarrier(
  state           ,
  actingSide      ,
  sourceId        ,
  from                          ,
  to                          ,
  movedPiece                             ,
)       {
  if (movedPiece.faceDown || movedPiece.type === "general" || !state.warrior?.[actingSide]) return;
  if (getController(movedPiece) !== actingSide || !isInPalace(from, actingSide) || isInPalace(to, actingSide)) return;
  const warrior = state.warrior[actingSide];
  if (warrior.barrierPieceIds.length >= 2 || warrior.barrierPieceIds.includes(sourceId)) return;
  warrior.barrierPieceIds.push(sourceId);
  state.effectsByPieceId ??= {};
  state.effectsByPieceId[sourceId] = {
    ...state.effectsByPieceId[sourceId],
    barrier: { owner: actingSide, enemyHalfEntered: false, movesAfterEnemyHalfEntry: 0 },
  };
}

/** Decrement only the active side's pending stealth after a formal action. */
function advanceStealthTurn(
  state           ,
  actingSide      ,
  movedPieceId        ,
  enteredStealth         ,
)       {
  if (enteredStealth) return;
  const activePieceId = state.assassination?.[actingSide].activePieceId;
  if (!activePieceId || activePieceId === movedPieceId) return;
  const stealth = state.effectsByPieceId?.[activePieceId]?.stealth;
  if (!stealth) {
    clearAssassinationForPiece(state, activePieceId);
    return;
  }
  if (stealth.remainingOwnerTurns === 1) {
    endStealth(state, activePieceId);
    return;
  }
  stealth.remainingOwnerTurns = 1;
}

function finishAfterPlayerAction(
  nextState           ,
  nextSecret             ,
  command             ,
  actingSide      ,
  sourceWasCovered         ,
  movedPiece                             ,
  enteredStealth         ,
)       {
  if (nextState.forcedDefense?.responder === actingSide) {
    const resumeTurn = nextState.forcedDefense.resumeTurn;
    delete nextState.forcedDefense;
    if (nextState.lastMove) nextState.lastMove.countsAsFormalTurn = false;
    nextState.turn = resumeTurn;
    nextSecret.processedActions[command.actionId] = nextState.revision;
    return;
  }
  const nextSide = otherSide(actingSide);
  const movedRevealed = movedPiece                 ;
  const isInfiniteSting =
    sourceWasCovered &&
    movedRevealed.color === nextSide &&
    canRevealedPieceAttack(
      nextState,
      movedRevealed,
      findGeneral(nextState, actingSide),
    );

  advanceStealthTurn(nextState, actingSide, movedPiece.id, enteredStealth);
  const ironArmor = isInfiniteSting && nextState.warrior?.[actingSide].ironArmorAvailable;
  if (ironArmor) {
    nextState.warrior [actingSide].ironArmorAvailable = false;
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
export function reassessAfterTrapResolution(state           )       {
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

function cloneSecret(secret             )              {
  return {
    identities: Object.fromEntries(
      Object.entries(secret.identities).map(([id, identity]) => [
        id,
        { ...identity },
      ]),
    ),
    processedActions: { ...secret.processedActions },
  };
}

function requireIdentity(
  secret             ,
  pieceId        ,
)                 {
  const identity = secret.identities[pieceId];
  if (!identity) {
    throw new RuleError("MISSING_SECRET", `暗子 ${pieceId} 缺少真实身份`);
  }
  return { ...identity };
}

function validationError(code = "INVALID_MOVE", message = "落子不合法")        {
  throw new RuleError(code, message);
}

/** A deliberate 铁马/战车路径碾碎 of the mover's own general is a valid
 * terminal action.  The ordinary self-check simulator cannot see that the
 * general will be removed later in the same atomic action, so only this
 * narrow case may bypass SELF_CHECK. */
function permitsSelfCrushingGeneral(
  state           ,
  command             ,
  actingSide      ,
)          {
  const source = pieceAt(state, command.from);
  if (!source) return false;
  return pathPiecesForSpecialMove(state, source, command.to).some(
    (piece) => !piece.faceDown && piece.color === actingSide && piece.type === "general",
  );
}

export function getExecutionCapturers(state           )                  {
  if (state.status !== "execution" || !state.winner) return [];
  const target = findGeneral(state, otherSide(state.winner));
  return state.pieces.filter(
    (piece)                         =>
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
  state           ,
)                                     {
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

export function applyAuthoritativeMove(
  state           ,
  secret             ,
  command             ,
)             {
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

  const validation = validatePublicMove(state, command, state.turn);
  if (!validation.ok && !(validation.code === "SELF_CHECK" && permitsSelfCrushingGeneral(state, command, state.turn))) {
    validationError(validation.code, validation.message);
  }

  const nextState = cloneState(state);
  const nextSecret = cloneSecret(secret);
  const actingSide = state.turn;
  const source = pieceAt(nextState, command.from);
  if (!source) validationError("NO_PIECE", "起点没有棋子");
  const target = pieceAt(nextState, command.to);
  const sourceWasCovered = source.faceDown;

  const pathVictims = pathPiecesForSpecialMove(nextState, source, command.to);
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
    if (finishDirectDeaths(nextState, actingSide)) {
      nextSecret.processedActions[command.actionId] = nextState.revision;
      return { state: nextState, secret: nextSecret, duplicate: false };
    }
    finishAfterPlayerAction(nextState, nextSecret, command, actingSide, false, source, false);
    return { state: nextState, secret: nextSecret, duplicate: false };
  }

  let captured                           ;
  if (target) {
    const identity                 = target.faceDown
      ? requireIdentity(nextSecret, target.id)
      : { color: target.color, type: target.type };
    captured = {
      id: target.id,
      ...identity,
      capturedBy: actingSide,
      moveNumber: state.revision + 1,
    };
    nextState.captured.push(captured);
    if (target.faceDown) delete nextSecret.identities[target.id];
    removePieceEffects(nextState, target.id);
    clearAssassinationForPiece(nextState, target.id);
  }

  let revealed                            ;
  let movedPiece                             ;
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
  };
  advanceBarrierAfterMove(nextState, source.id, movedPiece.y);

  if (finishDirectDeaths(nextState, actingSide)) {
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
  state           ,
  side      ,
  source             ,
)       {
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
 * early move of its already-stealthed piece.  Strong strike is intentionally
 * a separate authoritative command path: it may target a stealthed piece and
 * clears that piece's effects before removing it.
 */
export function applyAuthoritativeAssassination(
  state           ,
  secret             ,
  command                      ,
)             {
  if (secret.processedActions[command.actionId] !== undefined) {
    return { state: cloneState(state), secret: cloneSecret(secret), duplicate: true };
  }
  if (command.expectedRevision !== state.revision) {
    throw new RuleError("STALE_REVISION", "客户端棋局版本已经过期");
  }

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
  }

  const validation = validatePublicMove(state, command, actingSide, {
    allowStealthSource: continuing,
    allowStealthTarget: command.useStrongStrike,
    requireCapture: command.useStrongStrike,
  });
  if (!validation.ok && !(validation.code === "SELF_CHECK" && permitsSelfCrushingGeneral(state, command, actingSide))) {
    validationError(validation.code, validation.message);
  }
  const targetForStrike = pieceAt(state, command.to);
  if (command.useStrongStrike && (!targetForStrike || (!targetForStrike.faceDown && targetForStrike.type === "general"))) {
    throw new RuleError("INVALID_STRONG_STRIKE_TARGET", "强击不能以将帅为目标");
  }

  const nextState = cloneState(state);
  const nextSecret = cloneSecret(secret);
  const source = pieceAt(nextState, command.from);
  if (!source) validationError("NO_PIECE", "起点没有棋子");
  const target = pieceAt(nextState, command.to);
  const sourceWasCovered = source.faceDown;
  if (!continuing) consumeAssassinationCharge(nextState, actingSide, command.source               );

  const pathVictims = pathPiecesForSpecialMove(nextState, source, command.to);
  const pathCrushed = pathVictims.flatMap((pathVictim) => {
    const captured = captureByCrush(nextState, nextSecret, pathVictim.id, actingSide);
    return captured ? [captured] : [];
  });

  // 普通刺杀攻击被壁垒弹回：首击在原位进入隐身，后续隐身行动则直接现身。
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
    const entersStealthOnBounce = !continuing;
    if (continuing) endStealth(nextState, source.id);
    if (entersStealthOnBounce) {
      nextState.effectsByPieceId ??= {};
      nextState.effectsByPieceId[source.id] = { stealth: { owner: actingSide, remainingOwnerTurns: 2, strongStrikeAvailable: true, source: command.source                } };
      nextState.assassination?.[actingSide] && (nextState.assassination[actingSide].activePieceId = source.id);
    }
    if (finishDirectDeaths(nextState, actingSide)) {
      nextSecret.processedActions[command.actionId] = nextState.revision;
      return { state: nextState, secret: nextSecret, duplicate: false };
    }
    finishAfterPlayerAction(nextState, nextSecret, command, actingSide, false, source, entersStealthOnBounce);
    return { state: nextState, secret: nextSecret, duplicate: false };
  }

  let captured                           ;
  if (target) {
    const identity = target.faceDown
      ? requireIdentity(nextSecret, target.id)
      : { color: target.color, type: target.type };
    captured = { id: target.id, ...identity, capturedBy: actingSide, moveNumber: state.revision + 1 };
    nextState.captured.push(captured);
    if (target.faceDown) delete nextSecret.identities[target.id];
    removePieceEffects(nextState, target.id);
    clearAssassinationForPiece(nextState, target.id);
  }

  const movedPiece                              = source.faceDown
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
  };

  awardWarriorBarrier(nextState, actingSide, source.id, command.from, command.to, movedPiece);
  advanceBarrierAfterMove(nextState, source.id, movedPiece.y);

  if (finishDirectDeaths(nextState, actingSide)) {
    nextSecret.processedActions[command.actionId] = nextState.revision;
    return { state: nextState, secret: nextSecret, duplicate: false };
  }

  const entersStealth = !command.useStrongStrike && !continuing;
  if (continuing) endStealth(nextState, source.id);
  if (entersStealth) {
    const skillState = nextState.assassination?.[actingSide];
    if (!skillState) throw new RuleError("NO_ASSASSINATION", "该方没有可用的刺杀技能");
    nextState.effectsByPieceId ??= {};
    nextState.effectsByPieceId[source.id] = {
      stealth: {
        owner: actingSide,
        remainingOwnerTurns: 2,
        strongStrikeAvailable: true,
        source: command.source               ,
      },
    };
    skillState.activePieceId = source.id;
  }

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
  state           ,
  secret             ,
  actionId        ,
)             {
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
  const captured                = {
    id: target.id,
    color: target.color,
    type: "general",
    capturedBy: state.winner,
    moveNumber: state.revision + 1,
  };
  nextState.pieces = [
    ...nextState.pieces.filter((piece) => piece.id !== source.id && piece.id !== target.id),
    { ...source, x: plan.to.x, y: plan.to.y },
  ];
  removePieceEffects(nextState, target.id);
  clearAssassinationForPiece(nextState, target.id);
  nextState.captured.push(captured);
  nextState.revision += 1;
  nextState.lastMove = {
    actionId,
    pieceId: source.id,
    actingSide: state.winner,
    from: { ...plan.from },
    to: { ...plan.to },
    captured,
  };
  nextState.status = "finished";
  nextSecret.processedActions[actionId] = nextState.revision;
  return { state: nextState, secret: nextSecret, duplicate: false };
}

export function applyResignation(
  state           ,
  secret             ,
  side      ,
  expectedRevision        ,
  actionId        ,
)             {
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

export function publicStateSnapshot(state           )            {
  return JSON.parse(JSON.stringify(state))             ;
}
