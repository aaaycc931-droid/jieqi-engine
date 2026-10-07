import { RuleError } from "./errors.ts";
import { selectedHeroSelection } from "./hero-forms.ts";
import { getController, isInsideBoard, otherSide } from "./slots.ts";
import { isBoardPiece, isGround } from "./spaces.ts";
import { isGeneralInCheck, pieceAt } from "./rules.ts";
import { beginFormalTurn, closeDirectDeaths, copy, destroyPieceBatch, formalTurn, generateGhosts, markRevealed, queueLanding, settleLandings } from "./settlement.ts";
import { enterTurnPhase, recordAction } from "./turns.ts";
import { applyAuthoritativeMove } from "./game.ts";
import type { GameState, HeroAbilityCommand, MoveResult, Position, PublicPiece, RandomInt, SecretState, Side } from "./types.ts";
const requireRule = (ok: unknown, code: string, message: string) => { if (!ok) throw new RuleError(code, message); };
function choose<T>(items: T[], count: number, random: RandomInt): T[] {
  const pool = [...items], result: T[] = [];
  while (pool.length && result.length < count) result.push(...pool.splice(random(pool.length), 1));
  return result;
}
function reveal(state: GameState, secret: SecretState, id: string): void {
  const p = state.pieces.find(p => p.id === id)!;
  if (p.faceDown) { const identity = secret.identities[id]; requireRule(identity, "MISSING_SECRET", "揭示身份缺失"); state.pieces[state.pieces.indexOf(p)] = { ...p, faceDown: false, ...identity }; delete secret.identities[id]; markRevealed(state, secret, id); }
}
export function ascendGalakrond(state: GameState, secret: SecretState, side: Side, random: RandomInt): void {
  const runtime = state.heroRuntime?.[side], selection = selectedHeroSelection(state, side);
  if (selection?.heroId !== "devout_zealot" || !runtime?.omen || runtime.descended || state.status !== "playing") return;
  delete runtime.omen; runtime.descended = true;
  const variant = selection.variant ?? "unspeakable";
  const atom = `galakrond:${side}:${formalTurn(state, side) + 1}`;
  state.automaticEvents = []; state.destructionBatches = []; state.landingEvents = [];
  (state.automaticEvents ??= []).push({ kind: `galakrond:${variant}`, side });
  if (variant === "unspeakable") {
    const pool = state.pieces.filter(p => isBoardPiece(p) && !p.faceDown && getController(p) !== side && p.type !== "general");
    destroyPieceBatch(state, secret, atom, "galakrond:unspeakable", choose(pool, 4, random).map(p => ({ pieceId: p.id, by: side, cause: "unspeakable" })));
  } else if (variant === "invincible") {
    const pool = state.pieces.filter(p => isBoardPiece(p) && getController(p) === side && (p.faceDown || p.type !== "general"));
    for (const p of choose(pool, 4, random)) {
      reveal(state, secret, p.id); state.effectsByPieceId ??= {};
      Object.assign(state.effectsByPieceId[p.id] ??= {}, { dragonClaw: true, dragonScale: 1 });
    }
  } else {
    const groundSlots: Position[] = [];
    for (let y = side === "red" ? 5 : 0; y <= (side === "red" ? 9 : 4); y++) for (let x = 0; x < 9; x++) if (!pieceAt(state, { x, y })) groundSlots.push({ x, y });
    const pieces: PublicPiece[] = [];
    if (variant !== "nightmare") for (let i = 0; i < Math.min(variant === "fel" ? 4 : 2, groundSlots.length); i++) {
      const type = variant === "storm" ? "storm_elemental" : (["pawn", "advisor", "elephant", "horse"] as const)[random(4)];
      pieces.push({ id: `${atom}:${i}`, faceDown: false, color: side, type, x: -1, y: -1 });
    }
    state.pendingDescent = { side, variant, pieces, atom };
    return;
  }
  generateGhosts(state); closeDirectDeaths(state, secret, side);
}

/** 开始结算中的公开部署/衍生突袭，不能借此替代正式主行动。 */
export function applyDescentAction(state: GameState, secret: SecretState, command: HeroAbilityCommand, now: number): MoveResult {
  const s = copy(state), k = copy(secret), pending = s.pendingDescent;
  requireRule(pending && s.status === "playing" && s.turn === pending.side, "NO_DESCENT_WINDOW", "当前没有降临结算窗口");
  const side = pending!.side;
  requireRule(command.expectedRevision === s.revision, "STALE_REVISION", "客户端版本过期");
  if (command.ability === "ascension") {
    requireRule(!pending!.assaultIds, "DEPLOYMENT_COMPLETE", "部署已完成");
    const placements = command.placements ?? [];
    requireRule(new Set(placements.map(p => p.pieceId)).size === placements.length, "DUPLICATE_PLACEMENT", "同棋只能部署一次");
    if (pending!.variant === "nightmare") {
      requireRule(placements.length <= 4, "TOO_MANY_TARGETS", "梦魇最多四枚");
      for (const placement of placements) {
        const p = s.pieces.find(p => p.id === placement.pieceId);
        requireRule(p && isBoardPiece(p) && getController(p) === side && (p.faceDown || p.type !== "general"), "INVALID_DESCENT_TARGET", "只能部署当前己方非将帅棋");
        requireRule(p!.x !== placement.to.x || p!.y !== placement.to.y, "SAME_SQUARE", "梦魇落点必须离开原格");
      }
    } else requireRule(placements.length === pending!.pieces.length && pending!.pieces.every(p => placements.some(q => q.pieceId === p.id)), "INCOMPLETE_DEPLOYMENT", "必须部署本次可容纳的全部新棋");
    requireRule(new Set(placements.map(p => `${p.to.x},${p.to.y}`)).size === placements.length, "OCCUPIED", "地面落点不得重复");
    for (const placement of placements) {
      requireRule(isInsideBoard(placement.to) && !pieceAt(s, placement.to), "OCCUPIED", "必须选择空地面格");
      if (pending!.variant === "nightmare" && s.pieces.find(p => p.id === placement.pieceId)?.layer === "air") requireRule(!s.pieces.some(p => p.layer === "air" && p.x === placement.to.x && p.y === placement.to.y), "AIR_OCCUPIED", "空中落点已被占用");
      if (pending!.variant !== "nightmare") requireRule(side === "red" ? placement.to.y >= 5 : placement.to.y <= 4, "OUTSIDE_HOME", "新棋只放己方半场");
    }
    for (const placement of placements) {
      if (pending!.variant === "nightmare") {
        reveal(s, k, placement.pieceId); const p = s.pieces.find(p => p.id === placement.pieceId)!;
        const from = { x: p.x, y: p.y }; p.x = placement.to.x; p.y = placement.to.y;
        queueLanding(s, p, side, "galakrond:nightmare", from);
      } else {
        const p = { ...pending!.pieces.find(p => p.id === placement.pieceId)!, ...placement.to };
        s.pieces.push(p); queueLanding(s, p, side, `galakrond:${pending!.variant}`);
      }
    }
    if (pending!.variant === "nightmare") requireRule(!isGeneralInCheck(s, otherSide(side)), "DESCENT_CHECK", "梦魇最终部署不能形成将军");
    settleLandings(s, k);
    if (pending!.variant === "nightmare") requireRule(!isGeneralInCheck(s, otherSide(side)), "DESCENT_CHECK", "梦魇完整部署结算不能形成将军");
    generateGhosts(s); closeDirectDeaths(s, k, side);
    if (pending!.variant === "storm" && s.status === "playing") pending!.assaultIds = pending!.pieces.filter(p => s.pieces.some(q => q.id === p.id)).map(p => p.id);
    else delete s.pendingDescent;
    recordAction(s, { tier: 3, keywords: ["移置"], source: "skill_derived", opportunity: "child", countsAsFormalTurn: false, actionId: command.actionId, actingSide: side });
    s.revision++;
  } else {
    requireRule(command.ability === "storm_assault" && pending!.assaultIds?.length, "NO_ASSAULT", "当前没有待结算突袭");
    const pieceId = pending!.assaultIds![0], p = s.pieces.find(p => p.id === pieceId);
    if (!command.skip) {
      requireRule(p && command.to && pieceAt(s, command.to), "INVALID_ASSAULT_TARGET", "突袭必须指定进攻目标");
      const result = applyAuthoritativeMove(s, k, { actionId: command.actionId, expectedRevision: s.revision, pieceId, from: { x: p!.x, y: p!.y }, to: command.to! }, true, now, { parentActionId: pending!.atom, stormAssault: true });
      requireRule(!isGeneralInCheck(result.state, otherSide(side)), "ASSAULT_CHECK", "突袭不能形成将军");
      Object.assign(s, result.state); Object.assign(k, result.secret);
    } else s.revision++;
    s.pendingDescent!.assaultIds!.shift();
    if (!s.pendingDescent!.assaultIds!.length) delete s.pendingDescent;
  }
  if (!s.pendingDescent && s.status === "playing" && s.turnLifecycle?.phase === "turn_start") enterTurnPhase(s, "before_main");
  k.processedActions[command.actionId] = s.revision;
  return { state: s, secret: k, duplicate: false };
}
