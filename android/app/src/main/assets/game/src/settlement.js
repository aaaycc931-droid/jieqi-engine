import { saveShuffleOpening, openShuffleB } from "./hero-shuffle.js";
import { advanceTraining, settleTrainingDeaths, settleHeroDeathResources, TRAINING_COST } from "./hero-progress.js";
import { ascendGalakrond } from "./hero-descent.js";
import { initializeHeroForms, selectedHeroId, selectedHeroSelection, validateHeroForms } from "./hero-forms.js";
import { openDestructionBatches, requireClosedDestructionBatch } from "./settlement-context.js";
import { getGhostObjects, putGhostObject, reconcileGhostInfections, tickGhostObjects } from "./ghosts.js";
import { boardPieces, isBoardPiece, isFlying, isGround, isRiver, mayReadRiver } from "./spaces.js";
export { isGround } from "./spaces.js";
import { RuleError } from "./errors.js";
import { requireModeFeatureAdaptation } from "./modes.js";
import { getController, getCurrentPieceType, isInPalace, isInsideBoard, otherSide } from "./slots.js";
import { isCheckmate, isGeneralInCheck, isStalemate, pieceAt, samePosition } from "./rules.js";
import { enterTurnPhase } from "./turns.js";


/** 冻结承诺、预检死亡身份，整批完成后才开放后续触发。不会重新扫描棋盘。 */
export function destroyPieceBatch(state           , secret             , batchId        , source        , targets                              , permission                      )                         {
  requireClosedDestructionBatch(state);
  const prior = state.destructionBatches?.find(b => b.batchId === batchId);
  const locked = copy([...targets]);
  if (new Set(locked.map(t => t.pieceId)).size !== locked.length) throw new RuleError("DUPLICATE_BATCH_TARGET", "同一消灭批次不能重复承诺同一棋子");
  if (prior) {
    if (prior.source !== source || JSON.stringify(prior.targets) !== JSON.stringify(locked)) throw new RuleError("BATCH_ID_CONFLICT", "消灭批次ID与原承诺不一致");
    return copy(prior);
  }
  // 缺失真实身份不能留下半批死亡；仅预检仍存活且能被本来源消灭的对象。
  for (const t of locked) {
    const p = state.pieces.find(p => p.id === t.pieceId);
    if (p && (isBoardPiece(p) || mayReadRiver(permission)) && !(t.cause === "crush" && (!isGround(p) || state.effectsByPieceId?.[p.id]?.immuneCrush))) effectiveIdentity(p, secret, "death:reveal");
  }
  const batch                         = { batchId, source, targets: locked, targetIds: locked.map(t => t.pieceId), destroyedIds: [], phase: "closed" };
  openDestructionBatches.set(state, { batchId, targets: locked });
  try {
    for (const t of locked) if (destroyPiece(state, secret, t.pieceId, t.by, t.cause, permission)) batch.destroyedIds.push(t.pieceId);
    (state.destructionBatches ??= []).push(batch);
  } finally {
    openDestructionBatches.delete(state);
  }
  return copy(batch);
}

export const copy =    (value   )    => structuredClone(value);
export const formalTurn = (state           , side      )         => state.formalTurns?.[side] ?? 0;
/**
 * 权威端真实身份读取，仅供明确要求真实身份或执行死亡揭示的来源。
 * 普通当前兵种判定应调用 slots.ts 的 getCurrentPieceType，不能使用此函数。
 */
export function effectiveIdentity(piece             , secret             , source                        )                 {
  if (!["death:reveal", "mutation:end_time:initialization", "hero:wind:covered_carrier", "hero:night:insight", "hero:sky_admiral:training"].includes(source)) throw new RuleError("TRUE_IDENTITY_PERMISSION", "真实身份读取须由明确获准的权威来源提供");
  const identity = piece.faceDown ? secret.identities[piece.id] : piece;
  if (!identity) throw new RuleError("MISSING_SECRET", "暗子真实身份缺失");
  return { color: identity.color, type: identity.type };
}

/** 初始化的秘密身份、锚点均只留在权威端；不得进入公共快照。 */
export function initializeFeatureSecret(state           , secret             , randomInt            = max => Math.floor(Math.random() * max))       {
  validateHeroForms(state, secret);
  requireModeFeatureAdaptation(state.gameMode, state.featureRules);
  initializeHeroForms(state, secret);
  saveShuffleOpening(state, secret);
  secret.trueGenerals ??= {};
  for (const side of ["red", "black"]         ) {
    const general = state.pieces.find(p => isBoardPiece(p) && !p.faceDown && p.type === "general" && p.color === side);
    if (general) secret.trueGenerals[side] ??= general.id;
    if (selectedHeroId(state, side) === "wind" && general) {
      secret.wind ??= {};
      secret.wind[side] ??= { uses: 0, readyOnTurn: 0, decoyId: general.id };
    }
  }
  if (state.featureRules?.mutation === "end_time" && !secret.destinyIdentities) {
    secret.destinyIdentities = {};
    state.hourglasses = 5;
    state.warps = [];
    for (const p of boardPieces(state)) {
      const identity = effectiveIdentity(p, secret, "mutation:end_time:initialization");
      if (identity.type !== "pawn") continue;
      const hero = selectedHeroId(state, identity.color);
      if (hero !== "nozdormu" && hero !== "murozond") continue;
      secret.destinyIdentities[p.id] = {
        side: identity.color, kind: hero === "nozdormu" ? "time_warrior" : "infinite_dragon",
        anchor: { x: p.x, y: p.y }, shown: !p.faceDown, identity,
      };
    }
  }
}

export function markRevealed(state           , secret             , id        )       {
  const p = state.pieces.find(p => p.id === id);
  if (p && !isBoardPiece(p)) return;
  if (p && !p.faceDown && p.type === "horse" && state.featureRules?.mutation === "cavalry") {
    state.effectsByPieceId ??= {};
    state.effectsByPieceId[id] = { ...state.effectsByPieceId[id], cavalry: true };
  }
  const d = secret.destinyIdentities?.[id];
  if (d) {
    d.shown = true;
    if (p) {
      state.effectsByPieceId ??= {};
      state.effectsByPieceId[id] = { ...state.effectsByPieceId[id], destiny: d.kind,
        ...(d.kind === "infinite_dragon" ? { ammunition: 1          } : {}) };
    }
  }
}

/** 所有实际消灭统一记录；不会先清状态来绕过目标资格。 */
export function destroyPiece(state           , secret             , id        , by      , cause        , permission                      )                            {
  const batch = openDestructionBatches.get(state);
  if (batch && !batch.targets.some(t => t.pieceId === id && t.by === by && t.cause === cause)) throw new RuleError("UNCOMMITTED_BATCH_TARGET", "不能向开放消灭批次追加对象");
  const victim = state.pieces.find(p => p.id === id);
  if (!victim || !isBoardPiece(victim) && !mayReadRiver(permission)) return;
  if (cause === "crush" && (!isGround(victim) || state.effectsByPieceId?.[id]?.immuneCrush)) return;
  if (state.effectsByPieceId?.[id]?.dragonScale && ["attack", "assassination", "crush"].includes(cause)) throw new RuleError("DESIGN_REQUIRED_DRAGON_SCALE_PLACEMENT", "龙鳞拦截后的进攻者与目标落位尚未冻结，本操作不能提交");
  const controller = getController(victim);
  const identity = effectiveIdentity(victim, secret, "death:reveal");
  const withheld = victim.faceDown && state.featureRules?.mutation === "chaos";
  const record                = {
    id, ...identity, ...(withheld ? { color: controller, secretColorWithheld: true          } : {}),
    capturedBy: by, moveNumber: state.revision + 1, cause, ...(isRiver(victim) ? { river: copy(victim.river) } : { position: { x: victim.x, y: victim.y } }),
  };
  state.captured.push(record);
  state.pieces = state.pieces.filter(p => p.id !== id);
  if (victim.faceDown) delete secret.identities[id];
  if (state.effectsByPieceId) delete state.effectsByPieceId[id];
  for (const side of ["red", "black"]         ) {
    if (state.assassination?.[side]?.activePieceId === id) delete state.assassination[side].activePieceId;
  }
  if (secret.destinyIdentities?.[id]) secret.destinyIdentities[id].shown = true;
  state.automaticEvents ??= [];
  state.automaticEvents.push({ kind: `destroy:${cause}`, pieceId: id, side: controller, position: record.position, deathRecord: copy(record), wasCovered: victim.faceDown, ...(batch ? { batchId: batch.batchId } : {}) });
  return record;
}

export function queueLanding(state           , piece             , beforeController      , source        , from           )       {
  state.landingEvents ??= [];
  state.landingEvents.push({ pieceId: piece.id, beforeController, position: { x: piece.x, y: piece.y }, source, beforeGhostOwners: from ? getGhostObjects(state, { kind: "ghost", position: from }).filter(g => g.owner !== beforeController).map(g => g.owner) : state.effectsByPieceId?.[piece.id]?.infection ? [state.effectsByPieceId[piece.id].infection .owner] : [] });
}

export function placementAllowed(state           , piece             , to          , options                                                                = {})          {
  if (!isBoardPiece(piece) || !isInsideBoard(to)) return false;
  const occupied = state.pieces.some(p => p.id !== piece.id && isBoardPiece(p) && p.layer === piece.layer && samePosition(p, to));
  if (occupied) return false;
  const controller = options.fromRiver ?? getController(piece);
  if (state.featureRules?.mutation === "iron_wall" && !options.flow && !options.warriorReturn &&
    (options.fromRiver !== undefined || !isInPalace(piece, otherSide(controller))) && isInPalace(to, otherSide(controller))) return false;
  return true;
}

export function relocatePiece(state           , secret             , id        , to          , source        , options                                              = {})          {
  requireClosedDestructionBatch(state);
  const p = state.pieces.find(p => p.id === id);
  if (!p || !isBoardPiece(p) || !placementAllowed(state, p, to, options)) return false;
  const controller = getController(p);
  const from = { x: p.x, y: p.y };
  p.x = to.x; p.y = to.y;
  queueLanding(state, p, controller, source, from);
  settleLandings(state, secret);
  return true;
}

/** 当前原子链内的所有落位先完成，再做终局。额外应将不结算正式回合计数。 */
export function settleLandings(state           , secret             )       {
  validateHeroForms(state, secret);
  requireClosedDestructionBatch(state);
  const events = state.landingEvents ?? [];
  state.landingEvents = [];
  for (const event of events) {
    const p = state.pieces.find(p => p.id === event.pieceId);
    if (!p || !isGround(p)) continue;
    const afterController = getController(p);
    const traps = secret.traps ?? [];
    const index = traps.findIndex(t => t.opponentTurnsRemaining > 0 && t.owner !== event.beforeController && t.owner !== afterController && samePosition(t.position, p));
    if (index >= 0) {
      const [trap] = traps.splice(index, 1);
      state.automaticEvents ??= [];
      state.automaticEvents.push({ kind: "trap_trigger", pieceId: p.id, side: trap.owner, position: { x: p.x, y: p.y } });
      destroyPiece(state, secret, p.id, trap.owner, "trap_ambush");
      continue;
    }
    const e = state.effectsByPieceId?.[p.id];
    const ghosts = getGhostObjects(state, { kind: "ghost", position: p }).filter(g => g.owner !== afterController);
    if (e?.infection && !ghosts.some(g => g.owner === e.infection .owner)) delete e.infection;
    for (const g of ghosts) {
      if (event.beforeGhostOwners?.includes(g.owner) || state.automaticEvents?.some(e => e.kind === "ghost_entry" && e.pieceId === p.id && e.side === g.owner)) continue;
      state.effectsByPieceId ??= {}; const effects = state.effectsByPieceId[p.id] ??= {};
      effects.infection = { owner: g.owner, stacks: effects.infection?.owner === g.owner ? effects.infection.stacks + 1 : 1 };
      (state.automaticEvents ??= []).push({ kind: "ghost_entry", pieceId: p.id, side: g.owner });
      if (effects.infection.stacks >= 3) { destroyPiece(state, secret, p.id, g.owner, "infection"); break; }
    }
    if (!state.pieces.some(q => q.id === p.id)) continue;
    const warped = state.warps?.some(w => samePosition(w, p));
    if (e?.timeCollapse && !warped) delete e.timeCollapse;
    if (warped && selectedHeroId(state, afterController) === "nozdormu") {
      state.effectsByPieceId ??= {};
      state.effectsByPieceId[p.id] = { ...state.effectsByPieceId[p.id], timeCollapse: e?.timeCollapse ?? { expiresAtOwnerTurnEnd: formalTurn(state, afterController) + (state.turn === afterController ? 2 : 1) } };
    }
  }
}

export function closeDirectDeaths(state           , secret             , actingSide      )          {
  requireClosedDestructionBatch(state);
  // 每种调用来源都先闭合死亡派生，再判断解将/终局；不能依赖某个走子入口。
  resolveWindReturn(state, secret);
  settleHeroDeathResources(state);
  settleTrainingDeaths(state, secret, max => Math.floor(Math.random() * max));
  const alive = (side      ) => {
    const wind = secret.wind?.[side];
    const id = wind?.hostId ?? secret.trueGenerals?.[side];
    return id ? state.pieces.some(p => p.id === id) : state.pieces.some(p => !p.faceDown && p.color === side && p.type === "general");
  };
  const red = alive("red"), black = alive("black");
  for (const side of ["red", "black"]         ) {
    const w = secret.wind?.[side];
    if (!w?.hostId || alive(side)) continue;
    const record = state.captured.find(p => p.id === w.hostId);
    if (record) { record.type = "general"; record.color = side; }
  }
  if (red && black) return false;
  state.status = "finished";
  delete state.forcedDefense;
  if (!red && !black) {
    state.drawReason = "mutual_destruction";
    delete state.winner; delete state.reason;
  } else {
    state.winner = red ? "red" : "black";
    const deadId = secret.wind?.[otherSide(state.winner)]?.hostId ?? secret.trueGenerals?.[otherSide(state.winner)];
    const record = [...state.captured].reverse().find(p => p.id === deadId || p.type === "general" && p.color !== state.winner);
    const cause = record?.cause;
    state.reason = cause === "crush" ? (state.winner === actingSide ? "crush_them" : "rampage") :
      cause === "trap_ambush" ? "trap_ambush" : cause === "infection" ? "infection" : cause === "suffocation" ? "suffocation" : cause === "time_collapse" ? "time_collapse" : cause === "strong_strike" ? "ambush" : "general_destroyed";
  }
  return true;
}

/** 候选终局前确认两者都死亡的优先级。普通回归不授予裁决舞步。 */
export function resolveWindReturn(state           , secret             , executor                                      )          {
  requireClosedDestructionBatch(state);
  let returned = false;
  for (const side of ["red", "black"]         ) {
    const w = secret.wind?.[side];
    if (!w?.hostId || state.pieces.some(p => p.id === w.decoyId)) continue;
    const host = state.pieces.find(p => p.id === w.hostId);
    const death = state.captured.find(p => p.id === w.decoyId);
    if (!host || !isBoardPiece(host) || !death?.position) continue;
    if (executor) {
      const attacker = state.pieces.find(p => p.id === executor.pieceId);
      if (attacker && isBoardPiece(attacker)) { attacker.x = executor.from.x; attacker.y = executor.from.y; queueLanding(state, attacker, getController(attacker), "execution_return"); }
    }
    const occupant = pieceAt(state, death.position);
    const returnedGeneral              = { id: host.id, ...death.position, faceDown: false, color: side, type: "general" };
    state.pieces = state.pieces.map(p => p.id === host.id ? returnedGeneral : p);
    delete secret.identities[host.id];
    if (state.effectsByPieceId) delete state.effectsByPieceId[host.id];
    secret.trueGenerals [side] = host.id;
    w.decoyId = host.id; delete w.hostId;
    returned = true;
    if (occupant && occupant.id !== host.id) {
      // 2026-10-04 用户确认：归位格有另一枚地面棋，真主帅直接窒息。
      // 占位棋不被消灭或弹回；失败归位没有落位触发，也不授予舞步。
      destroyPiece(state, secret, host.id, otherSide(side), "suffocation");
      continue;
    }
    queueLanding(state, returnedGeneral, side, "flow");
    state.automaticEvents ??= [];
    state.automaticEvents.push({ kind: "wind_flow", pieceId: host.id, side, position: death.position });
    if (executor && w.uses === 1) state.flowDance = { side, pieceId: host.id, steps: 0, resumeTurn: side };
  }
  if (returned) settleLandings(state, secret);
  return returned;
}

/** 只在未正式终局时生成亡魂；死亡控制方由公开自动事件保存。 */
export function generateGhosts(state           , firstEvent = 0)       {
  validateHeroForms(state);
  requireClosedDestructionBatch(state);
  for (const event of (state.automaticEvents ?? []).slice(firstEvent)) {
    if (!event.kind.startsWith("destroy:") || !event.position || !event.side) continue;
    if (event.ghostTriggerHandled) continue;
    event.ghostTriggerHandled = true;
    if (state.status === "finished") continue;
    const selection = selectedHeroSelection(state, event.side);
    if (selection?.heroId !== "death_knight") continue;
    const dead = event.deathRecord ?? [...state.captured].reverse().find(p => p.id === event.pieceId);
    if (!dead || dead.type === "general") continue;
    if (selection.form === "inner") putGhostObject(state, { kind: "inner_ghost", source: "death_knight:inner_death", owner: event.side, position: { ...event.position }, remaining: 0, persistent: true, layers: 1 }, "add_layers");
    else putGhostObject(state, { kind: "ghost", source: "death_knight:death", owner: event.side, position: { ...event.position }, remaining: 3 }, "replace");
  }
}

/** 开始效果只在真正的新正式回合运行一次，额外/连带/强迫行动不进入此入口。 */
export function beginFormalTurn(state           , secret              , randomInt            = max => Math.floor(Math.random() * max))       {
  validateHeroForms(state, secret);
  requireClosedDestructionBatch(state);
  if (state.status !== "playing" || state.forcedDefense || state.flowDance) return;
  initializeHeroForms(state, secret);
  const side = state.turn, number = formalTurn(state, side) + 1;
  if (secret && (secret.formalStart?.side !== side || secret.formalStart.number !== number)) {
    if (state.featureRules?.mutation === "chaos") {
      for (const p of boardPieces(state)) if (p.faceDown) secret.identities[p.id].color = randomInt(2) === 0 ? "red" : "black";
      secret.chaosInitialized = true;
    }
    secret.formalStart = { side, number };
  }
  if (state.turnLifecycle?.side !== side || state.turnLifecycle.number !== number) {
    state.turnLifecycle = { side, number, phase: "turn_start", phases: ["turn_start"] };
    const hero = selectedHeroId(state, side);
    if (hero === "qin_long" && Math.min(formalTurn(state, "red"), formalTurn(state, "black")) >= 15) {
      state.heroRuntime ??= {};
      (state.heroRuntime[side] ??= {}).rainActive = randomInt(100) < 15;
    }
    if (hero === "night") {
      state.heroRuntime ??= {}; const runtime = state.heroRuntime[side] ??= {};
      runtime.pupil ??= 0; runtime.insightCount ??= 0;
      if (number % 2 === 0) runtime.pupil += 6;
    }
    if (hero === "prince") {
      state.heroRuntime ??= {};
      (state.heroRuntime[side] ??= {}).carefreeSuspended = false;
    }
    if (secret) advanceTraining(state, secret, side, randomInt);
    if (secret) ascendGalakrond(state, secret, side, randomInt);
    if (state.status !== "playing" || state.pendingDescent) return;
    enterTurnPhase(state, "before_main");
  }

}

/** 先以公开开始效果试算合法性；确认非终局后才实际开始下一回合、抽随机或刷新秘密。 */
export function advanceToFormalTurn(state           , secret             , side      , randomInt            = max => Math.floor(Math.random() * max))       {
  validateHeroForms(state, secret);
  requireClosedDestructionBatch(state);
  if (state.status !== "playing" || state.forcedDefense || state.flowDance) return;
  if (openShuffleB(state, side)) return;
  const training = secret.training?.[side];
  if (state.heroRuntime?.[side]?.omen || training && !training.failed && !training.graduated && training.progress + 1 >= TRAINING_COST[training.type] ) {
    state.turn = side; beginFormalTurn(state, secret, randomInt);
    if (state.status !== "playing" || state.pendingDescent) return;
  }
  const probe = copy(state);
  probe.turn = side;
  // 秦龙抽签只影响落子后专属胜负，不改变合法走法；试算不能消耗真实随机数。
  beginFormalTurn(probe, undefined, () => 99);
  if (isCheckmate(probe, side)) {
    state.status = "execution"; state.winner = otherSide(side); state.turn = otherSide(side); state.reason = "checkmate";
  } else if (isStalemate(probe, side)) {
    state.status = "finished"; state.winner = otherSide(side); state.reason = "stalemate";
  } else {
    state.turn = side;
    beginFormalTurn(state, secret, randomInt);
  }
}

export function finishFormalTurn(state           , secret             , actingSide      , randomInt            = max => Math.floor(Math.random() * max))       {
  validateHeroForms(state, secret);
  requireClosedDestructionBatch(state);
  if (state.status === "finished" || state.forcedDefense || state.lastMove?.countsAsFormalTurn === false) return;
  if (state.turnLifecycle) {
    if (state.turnLifecycle.side !== actingSide || state.turnLifecycle.phase === "turn_end") return;
    enterTurnPhase(state, "turn_end");
    state.lastCompletedFormalTurn = copy(state.turnLifecycle);
  }
  state.formalTurns ??= { red: 0, black: 0 };
  state.formalTurns[actingSide] += 1;
  let newEventStart = state.automaticEvents?.length ?? 0;
  for (const [id, e] of Object.entries(state.effectsByPieceId ?? {})) {
    const p = state.pieces.find(p => p.id === id);
    if (p && isRiver(p) && e.riverTurns !== undefined && getController(p) === actingSide && --e.riverTurns <= 0) destroyPiece(state, secret, p.id, otherSide(actingSide), "river_expiry", { source: "jiang_he:river_expiry", readRiver: true });
    if (!p || !isBoardPiece(p)) continue;
    if (e.stealth && e.stealth.owner === actingSide && e.stealth.activatedOnFormalTurn !== formalTurn(state, actingSide)) {
      e.stealth.remainingOwnerTurns -= 1;
      if (e.stealth.remainingOwnerTurns <= 0) {
        delete e.stealth;
        if (state.assassination?.[actingSide]?.activePieceId === id) delete state.assassination[actingSide].activePieceId;
      }
    }
    if (e.barrier && e.barrier.owner !== actingSide && --e.barrier.enemyTurnsRemaining <= 0) delete e.barrier;
    if (e.controlTrap && e.controlTrap.controller === actingSide && e.controlTrap.blockedFormalTurn <= formalTurn(state, actingSide)) delete e.controlTrap;
    if (!isGround(p)) { delete e.infection; delete e.timeCollapse; }
    if (e.flight && getController(p) === actingSide) {
      e.flight.remainingOwnerTurns = Math.max(0, e.flight.remainingOwnerTurns - 1);
      if (e.flight.remainingOwnerTurns === 0) {
        if (e.flight.source === "sky_admiral") e.flight.forcedLanding = true;
        else landFlyingPiece(state, secret, id);
      }
    }
    if (e.timeCollapse && getController(p) === actingSide && e.timeCollapse.expiresAtOwnerTurnEnd <= formalTurn(state, actingSide)) destroyPiece(state, secret, id, otherSide(actingSide), "time_collapse");
  }
  resolveWindReturn(state, secret);
  if (closeDirectDeaths(state, secret, actingSide)) return;
  generateGhosts(state, newEventStart);
  newEventStart = state.automaticEvents?.length ?? 0;
  for (const g of getGhostObjects(state, { kind: "ghost", owner: actingSide })) {
    if (g.owner !== actingSide) continue;
    const p = pieceAt(state, g.position);
    if (p && isGround(p) && getController(p) !== g.owner) {
      state.effectsByPieceId ??= {};
      const e = state.effectsByPieceId[p.id] ??= {};
      e.infection = { owner: g.owner, stacks: e.infection?.owner === g.owner ? e.infection.stacks + 1 : 1 };
      if (e.infection.stacks >= 3) destroyPiece(state, secret, p.id, g.owner, "infection");
    }
  }
  tickGhostObjects(state, { kind: "ghost", owner: actingSide });
  generateGhosts(state, newEventStart);
  reconcileGhostInfections(state);
  resolveWindReturn(state, secret);
  if (closeDirectDeaths(state, secret, actingSide)) return;
  secret.traps = secret.traps?.filter(t => t.owner === actingSide || --t.opponentTurnsRemaining > 0);
  if (state.heroRuntime?.[actingSide]) state.heroRuntime[actingSide] .rainActive = false;
}

export function landFlyingPiece(state           , secret             , id        )       {
  validateHeroForms(state, secret);
  requireClosedDestructionBatch(state);
  const p = state.pieces.find(p => p.id === id);
  if (!p || !isFlying(p)) return;
  const controller = getController(p);
  const under = state.pieces.find(q => isGround(q) && samePosition(q, p));
  if (under) destroyPiece(state, secret, under.id, controller, "crush");
  if (state.pieces.some(q => q.id !== id && isGround(q) && samePosition(q, p))) {
    destroyPiece(state, secret, id, otherSide(controller), "suffocation");
  } else {
    delete p.layer;
    if (state.effectsByPieceId?.[id]) { delete state.effectsByPieceId[id].flight; delete state.effectsByPieceId[id].intangible; delete state.effectsByPieceId[id].immuneCrush; }
    queueLanding(state, p, controller, "flight_landing");
    settleLandings(state, secret);
  }
  resolveWindReturn(state, secret);
  closeDirectDeaths(state, secret, controller);
}

/** 不递归保存历史；已处理ID与回溯使用元状态由回溯操作保留。 */
export function rememberAction(state           , secret             , pieceId                    , tier        , from           , now = Date.now(), classification                       )       {
  initializeHeroForms(state, secret);
  if (state.forcedDefense || state.flowDance || classification && (classification.opportunity !== "main" || !classification.countsAsFormalTurn)) return;
  const privateSnapshot = copy(secret);
  delete privateSnapshot.history;
  delete privateSnapshot.processedActions;
  secret.history ??= [];
  // 使用权威接收时刻保存落子前真实剩余，不能从历史回合起点重建总时长。
  const clock = state.turnDeadlineAt;
  const remainingMs = clock === undefined ? undefined : Math.max(0, clock - now);
  secret.history.push({ actingSide: state.turn, pieceId, tier, ...(classification ? { classification: copy(classification), formalTurnNumber: formalTurn(state, state.turn) + 1 } : {}), ...(from ? { from: { ...from } } : {}), ...(remainingMs === undefined ? {} : { remainingMs }), state: copy(state), secret: privateSnapshot });
  // 至少保留双方上一正式行动。较长历史用于核验，快照不会指数膨胀。
  if (secret.history.length > 8) secret.history.shift();
}

/** 已确认来源调用此公共转换；进出资格、河格占用与连通由来源自己验证。 */
export function enterRiverSpace(state           , secret             , id        , location               )          {
  requireClosedDestructionBatch(state);
  const p = state.pieces.find(p => p.id === id);
  if (!p) return false;
  if (isRiver(p)) throw new RuleError("RIVER_SOURCE_TRANSITION", "河道内移置须由来源定义，不能当作再次入河");
  if (isFlying(p) || state.effectsByPieceId?.[id]?.flight) throw new RuleError("RIVER_FLIGHT_EXCLUSIVE", "河道与飞行互斥");
  if (![location.source, location.spaceId, location.cellId].every(v => typeof v === "string" && v.trim())) throw new RuleError("INVALID_RIVER_LOCATION", "河道位置须具有来源、空间和格标识");
  const candidate              = { ...p, layer: "river", river: copy(location) };
  if (candidate.faceDown) { getController(candidate); /* 不得以旧棋盘位置或秘密身份兜底。 */ }
  if (candidate.faceDown && !location.coveredIdentity?.type) throw new RuleError("UNDEFINED_DARK_IDENTITY", "来源须定义河道暗置身份");
  Object.assign(p, candidate);
  // 两者既有有效性均依赖地面。其余状态不额外驱散，也不自设河道持续。
  const e = state.effectsByPieceId?.[id];
  if (e) { delete e.infection; delete e.timeCollapse; }
  return true;
}

/** 来源已确认出河后恢复地面，再按既有正常落位结算；非法棋位不自作窒息。 */
export function leaveRiverSpace(state           , secret             , id        , to          , source        )          {
  requireClosedDestructionBatch(state);
  const p = state.pieces.find(p => p.id === id);
  if (!p || !isRiver(p) || !source.trim()) return false;
  const beforeController = getController(p);
  const candidate              = { ...p, ...to };
  delete candidate.layer; delete candidate.river;
  if (!placementAllowed(state, candidate, to, { fromRiver: beforeController })) return false;
  // 暗子回到普通棋位后使用新的基础棋位，不继承河道身份；未定义棋位拒绝。
  if (candidate.faceDown && !isInsideBoard(candidate)) return false;
  if (candidate.faceDown) {
    // 无来源自定义棋盘暗身份机制时，基础层必须拒绝非基础暗子位置。
    getCurrentPieceType(candidate);
  }
  delete p.layer; delete p.river;
  p.x = to.x; p.y = to.y;
  queueLanding(state, p, beforeController, source);
  settleLandings(state, secret);
  return true;
}
