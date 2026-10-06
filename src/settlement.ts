import { RuleError } from "./errors.ts";
import { requireModeFeatureAdaptation } from "./modes.ts";
import { getController, isInPalace, isInsideBoard, otherSide } from "./slots.ts";
import { isCheckmate, isGeneralInCheck, isStalemate, pieceAt, samePosition } from "./rules.ts";
import { enterTurnPhase } from "./turns.ts";
import type { ActionClassification, CapturedPiece, GameState, Position, PublicPiece, RandomInt, SecretIdentity, SecretState, Side } from "./types.ts";

export const copy = <T>(value: T): T => structuredClone(value);
export const isGround = (piece: PublicPiece): boolean => piece.layer !== "air";
export const formalTurn = (state: GameState, side: Side): number => state.formalTurns?.[side] ?? 0;
/**
 * 权威端真实身份读取，仅供明确要求真实身份或执行死亡揭示的来源。
 * 普通当前兵种判定应调用 slots.ts 的 getCurrentPieceType，不能使用此函数。
 */
export function effectiveIdentity(piece: PublicPiece, secret: SecretState): SecretIdentity {
  const identity = piece.faceDown ? secret.identities[piece.id] : piece;
  if (!identity) throw new RuleError("MISSING_SECRET", "暗子真实身份缺失");
  return { color: identity.color, type: identity.type };
}

/** 初始化的秘密身份、锚点均只留在权威端；不得进入公共快照。 */
export function initializeFeatureSecret(state: GameState, secret: SecretState, randomInt: RandomInt = max => Math.floor(Math.random() * max)): void {
  requireModeFeatureAdaptation(state.gameMode, state.featureRules);
  secret.trueGenerals ??= {};
  for (const side of ["red", "black"] as const) {
    const general = state.pieces.find(p => !p.faceDown && p.type === "general" && p.color === side);
    if (general) secret.trueGenerals[side] ??= general.id;
    if (state.featureRules?.heroes?.[side] === "wind" && general) {
      secret.wind ??= {};
      secret.wind[side] ??= { uses: 0, readyOnTurn: 0, decoyId: general.id };
    }
  }
  if (state.featureRules?.mutation === "end_time" && !secret.destinyIdentities) {
    secret.destinyIdentities = {};
    state.hourglasses = 5;
    state.warps = [];
    for (const p of state.pieces) {
      const identity = effectiveIdentity(p, secret);
      if (identity.type !== "pawn") continue;
      const hero = state.featureRules.heroes?.[identity.color];
      if (hero !== "nozdormu" && hero !== "murozond") continue;
      secret.destinyIdentities[p.id] = {
        side: identity.color, kind: hero === "nozdormu" ? "time_warrior" : "infinite_dragon",
        anchor: { x: p.x, y: p.y }, shown: !p.faceDown, identity,
      };
    }
  }
}

export function markRevealed(state: GameState, secret: SecretState, id: string): void {
  const p = state.pieces.find(p => p.id === id);
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
        ...(d.kind === "infinite_dragon" ? { ammunition: 1 as const } : {}) };
    }
  }
}

/** 所有实际消灭统一记录；不会先清状态来绕过目标资格。 */
export function destroyPiece(state: GameState, secret: SecretState, id: string, by: Side, cause: string): CapturedPiece | undefined {
  const victim = state.pieces.find(p => p.id === id);
  if (!victim) return;
  if (cause === "crush" && (!isGround(victim) || state.effectsByPieceId?.[id]?.immuneCrush)) return;
  const controller = getController(victim);
  const identity = effectiveIdentity(victim, secret);
  const withheld = victim.faceDown && state.featureRules?.mutation === "chaos";
  const record: CapturedPiece = {
    id, ...identity, ...(withheld ? { color: controller, secretColorWithheld: true as const } : {}),
    capturedBy: by, moveNumber: state.revision + 1, cause, position: { x: victim.x, y: victim.y },
  };
  state.captured.push(record);
  state.pieces = state.pieces.filter(p => p.id !== id);
  if (victim.faceDown) delete secret.identities[id];
  if (state.effectsByPieceId) delete state.effectsByPieceId[id];
  for (const side of ["red", "black"] as const) {
    if (state.assassination?.[side]?.activePieceId === id) delete state.assassination[side].activePieceId;
  }
  if (secret.destinyIdentities?.[id]) secret.destinyIdentities[id].shown = true;
  state.automaticEvents ??= [];
  state.automaticEvents.push({ kind: `destroy:${cause}`, pieceId: id, side: controller, position: record.position });
  return record;
}

export function queueLanding(state: GameState, piece: PublicPiece, beforeController: Side, source: string): void {
  state.landingEvents ??= [];
  state.landingEvents.push({ pieceId: piece.id, beforeController, position: { x: piece.x, y: piece.y }, source });
}

export function placementAllowed(state: GameState, piece: PublicPiece, to: Position, options: { warriorReturn?: boolean; flow?: boolean } = {}): boolean {
  if (!isInsideBoard(to)) return false;
  const occupied = state.pieces.some(p => p.id !== piece.id && p.layer === piece.layer && samePosition(p, to));
  if (occupied) return false;
  if (state.featureRules?.mutation === "iron_wall" && !options.flow && !options.warriorReturn &&
    !isInPalace(piece, otherSide(getController(piece))) && isInPalace(to, otherSide(getController(piece)))) return false;
  return true;
}

export function relocatePiece(state: GameState, secret: SecretState, id: string, to: Position, source: string, options: { warriorReturn?: boolean; flow?: boolean } = {}): boolean {
  const p = state.pieces.find(p => p.id === id);
  if (!p || !placementAllowed(state, p, to, options)) return false;
  const controller = getController(p);
  p.x = to.x; p.y = to.y;
  queueLanding(state, p, controller, source);
  settleLandings(state, secret);
  return true;
}

/** 当前原子链内的所有落位先完成，再做终局。额外应将不结算正式回合计数。 */
export function settleLandings(state: GameState, secret: SecretState): void {
  const events = state.landingEvents ?? [];
  state.landingEvents = [];
  for (const event of events) {
    const p = state.pieces.find(p => p.id === event.pieceId);
    if (!p || !isGround(p)) continue;
    const afterController = getController(p);
    const traps = secret.traps ?? [];
    const index = traps.findIndex(t => t.owner !== event.beforeController && t.owner !== afterController && samePosition(t.position, p));
    if (index >= 0) {
      const [trap] = traps.splice(index, 1);
      state.automaticEvents ??= [];
      state.automaticEvents.push({ kind: "trap_trigger", pieceId: p.id, side: trap.owner, position: { x: p.x, y: p.y } });
      if (trap.opponentTurnsRemaining >= 4) {
        destroyPiece(state, secret, p.id, trap.owner, "trap_ambush");
        continue;
      }
      state.effectsByPieceId ??= {};
      state.effectsByPieceId[p.id] = { ...state.effectsByPieceId[p.id], controlTrap: { controller: afterController, blockedFormalTurn: formalTurn(state, afterController) + (state.turn === afterController ? 2 : 1) } };
    }
    const e = state.effectsByPieceId?.[p.id];
    const ghosts = state.ghosts?.filter(g => g.owner !== afterController && samePosition(g.position, p)) ?? [];
    if (e?.infection && !ghosts.some(g => g.owner === e.infection!.owner)) delete e.infection;
    const warped = state.warps?.some(w => samePosition(w, p));
    if (e?.timeCollapse && !warped) delete e.timeCollapse;
    if (warped && state.featureRules?.heroes?.[afterController] === "nozdormu") {
      state.effectsByPieceId ??= {};
      state.effectsByPieceId[p.id] = { ...state.effectsByPieceId[p.id], timeCollapse: e?.timeCollapse ?? { expiresAtOwnerTurnEnd: formalTurn(state, afterController) + (state.turn === afterController ? 2 : 1) } };
    }
  }
}

export function closeDirectDeaths(state: GameState, secret: SecretState, actingSide: Side): boolean {
  const alive = (side: Side) => {
    const wind = secret.wind?.[side];
    const id = wind?.hostId ?? secret.trueGenerals?.[side];
    return id ? state.pieces.some(p => p.id === id) : state.pieces.some(p => !p.faceDown && p.color === side && p.type === "general");
  };
  const red = alive("red"), black = alive("black");
  for (const side of ["red", "black"] as const) {
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
export function resolveWindReturn(state: GameState, secret: SecretState, executor?: { pieceId: string; from: Position }): boolean {
  let returned = false;
  for (const side of ["red", "black"] as const) {
    const w = secret.wind?.[side];
    if (!w?.hostId || state.pieces.some(p => p.id === w.decoyId)) continue;
    const host = state.pieces.find(p => p.id === w.hostId);
    const death = state.captured.find(p => p.id === w.decoyId);
    if (!host || !death?.position) continue;
    if (executor) {
      const attacker = state.pieces.find(p => p.id === executor.pieceId);
      if (attacker) { attacker.x = executor.from.x; attacker.y = executor.from.y; queueLanding(state, attacker, getController(attacker), "execution_return"); }
    }
    const occupant = pieceAt(state, death.position);
    const returnedGeneral: PublicPiece = { id: host.id, ...death.position, faceDown: false, color: side, type: "general" };
    state.pieces = state.pieces.map(p => p.id === host.id ? returnedGeneral : p);
    delete secret.identities[host.id];
    if (state.effectsByPieceId) delete state.effectsByPieceId[host.id];
    secret.trueGenerals![side] = host.id;
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
    if (executor) state.flowDance = { side, pieceId: host.id, steps: 0, resumeTurn: side };
  }
  if (returned) settleLandings(state, secret);
  return returned;
}

/** 只在未正式终局时生成亡魂；死亡控制方由公开自动事件保存。 */
export function generateGhosts(state: GameState, firstEvent = 0): void {
  if (state.status === "finished") return;
  for (const event of (state.automaticEvents ?? []).slice(firstEvent)) {
    if (!event.kind.startsWith("destroy:") || !event.position || !event.side) continue;
    if (state.featureRules?.heroes?.[event.side] !== "death_knight") continue;
    const dead = state.captured.find(p => p.id === event.pieceId);
    if (!dead || dead.type === "general") continue;
    state.ghosts ??= [];
    const existing = state.ghosts.find(g => g.owner === event.side && samePosition(g.position, event.position!));
    if (existing) existing.remaining = 3;
    else state.ghosts.push({ owner: event.side, position: { ...event.position }, remaining: 3 });
  }
}

/** 开始效果只在真正的新正式回合运行一次，额外/连带/强迫行动不进入此入口。 */
export function beginFormalTurn(state: GameState, secret?: SecretState, randomInt: RandomInt = max => Math.floor(Math.random() * max)): void {
  if (state.status !== "playing" || state.forcedDefense || state.flowDance) return;
  const side = state.turn, number = formalTurn(state, side) + 1;
  if (state.turnLifecycle?.side !== side || state.turnLifecycle.number !== number) {
    state.turnLifecycle = { side, number, phase: "turn_start", phases: ["turn_start"] };
    const hero = state.featureRules?.heroes?.[side];
    if (hero === "qin_long" && Math.min(formalTurn(state, "red"), formalTurn(state, "black")) >= 15) {
      state.heroRuntime ??= {};
      (state.heroRuntime[side] ??= {}).rainActive = randomInt(100) < 15;
    }
    if (hero === "prince") {
      state.heroRuntime ??= {};
      (state.heroRuntime[side] ??= {}).carefreeSuspended = false;
    }
    enterTurnPhase(state, "before_main");
  }
  if (secret && (secret.formalStart?.side !== side || secret.formalStart.number !== number)) {
    if (state.featureRules?.mutation === "chaos") {
      for (const p of state.pieces) if (p.faceDown) secret.identities[p.id].color = randomInt(2) === 0 ? "red" : "black";
      secret.chaosInitialized = true;
    }
    secret.formalStart = { side, number };
  }
}

/** 先以公开开始效果试算合法性；确认非终局后才实际开始下一回合、抽随机或刷新秘密。 */
export function advanceToFormalTurn(state: GameState, secret: SecretState, side: Side, randomInt: RandomInt = max => Math.floor(Math.random() * max)): void {
  if (state.status !== "playing" || state.forcedDefense || state.flowDance) return;
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

export function finishFormalTurn(state: GameState, secret: SecretState, actingSide: Side, randomInt: RandomInt = max => Math.floor(Math.random() * max)): void {
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
    if (!p) continue;
    if (e.barrier && e.barrier.owner !== actingSide && --e.barrier.enemyTurnsRemaining <= 0) delete e.barrier;
    if (e.controlTrap && e.controlTrap.controller === actingSide && e.controlTrap.blockedFormalTurn <= formalTurn(state, actingSide)) delete e.controlTrap;
    if (!isGround(p)) { delete e.infection; delete e.timeCollapse; }
    if (e.flight && getController(p) === actingSide && --e.flight.remainingOwnerTurns <= 0) landFlyingPiece(state, secret, id);
    if (e.timeCollapse && getController(p) === actingSide && e.timeCollapse.expiresAtOwnerTurnEnd <= formalTurn(state, actingSide)) destroyPiece(state, secret, id, otherSide(actingSide), "time_collapse");
  }
  resolveWindReturn(state, secret);
  if (closeDirectDeaths(state, secret, actingSide)) return;
  generateGhosts(state, newEventStart);
  newEventStart = state.automaticEvents?.length ?? 0;
  for (const g of state.ghosts ?? []) {
    if (g.owner !== actingSide) continue;
    const p = pieceAt(state, g.position);
    if (p && isGround(p) && getController(p) !== g.owner) {
      state.effectsByPieceId ??= {};
      const e = state.effectsByPieceId[p.id] ??= {};
      e.infection = { owner: g.owner, stacks: e.infection?.owner === g.owner ? e.infection.stacks + 1 : 1 };
      if (e.infection.stacks >= 3) destroyPiece(state, secret, p.id, g.owner, "infection");
    }
    g.remaining -= 1;
  }
  state.ghosts = state.ghosts?.filter(g => g.remaining > 0);
  generateGhosts(state, newEventStart);
  for (const [id, e] of Object.entries(state.effectsByPieceId ?? {})) {
    const p = state.pieces.find(p => p.id === id);
    if (e.infection && (!p || !state.ghosts?.some(g => g.owner === e.infection!.owner && samePosition(g.position, p)))) delete e.infection;
  }
  resolveWindReturn(state, secret);
  if (closeDirectDeaths(state, secret, actingSide)) return;
  secret.traps = secret.traps?.filter(t => t.owner === actingSide || --t.opponentTurnsRemaining > 0);
  if (state.heroRuntime?.[actingSide]) state.heroRuntime[actingSide]!.rainActive = false;
}

export function landFlyingPiece(state: GameState, secret: SecretState, id: string): void {
  const p = state.pieces.find(p => p.id === id);
  if (!p || isGround(p)) return;
  const controller = getController(p);
  const under = state.pieces.find(q => isGround(q) && samePosition(q, p));
  if (under) destroyPiece(state, secret, under.id, controller, "crush");
  if (state.pieces.some(q => q.id !== id && isGround(q) && samePosition(q, p))) {
    destroyPiece(state, secret, id, otherSide(controller), "suffocation");
  } else {
    delete p.layer;
    if (state.effectsByPieceId?.[id]) { delete state.effectsByPieceId[id].flight; delete state.effectsByPieceId[id].intangible; }
    queueLanding(state, p, controller, "flight_landing");
    settleLandings(state, secret);
  }
  resolveWindReturn(state, secret);
  closeDirectDeaths(state, secret, controller);
}

/** 不递归保存历史；已处理ID与回溯使用元状态由回溯操作保留。 */
export function rememberAction(state: GameState, secret: SecretState, pieceId: string | undefined, tier: number, from?: Position, now = Date.now(), classification?: ActionClassification): void {
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
