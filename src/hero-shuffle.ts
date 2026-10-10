import { isCheckmate, isStalemate } from "./rules.ts";
import { RuleError } from "./errors.ts";
import { selectedHeroId } from "./hero-forms.ts";
import { shuffleIdentities } from "./setup.ts";
import { reconcileGhostInfections } from "./ghosts.ts";
import { copy, advanceToFormalTurn, beginFormalTurn } from "./settlement.ts";
import { emitMechanismEvent } from "./mechanism-observer.ts";
import type { GameState, HeroAbilityCommand, MoveResult, RandomInt, SecretIdentity, SecretState, Side } from "./types.ts";
export function saveShuffleOpening(state: GameState, secret: SecretState): void {
  if (secret.shuffleOpening || !["red", "black"].some(side => selectedHeroId(state, side as Side) === "shuffler")) return;
  if (state.revision !== 0 || state.lastMove) throw new RuleError("MISSING_SHUFFLE_OPENING", "洗牌初始结构必须在开局保存");
  secret.shuffleOpening = { pieces: copy(state.pieces), identities: copy(secret.identities) };
}
export function openShuffleA(state: GameState, side: Side): boolean {
  const runtime = state.heroRuntime?.black;
  if (side !== "black" || selectedHeroId(state, "black") !== "shuffler" || runtime?.used || runtime?.shuffleLost || state.formalTurns?.black !== 1 || runtime?.shuffleWindow) return false;
  if (!state.heroRuntime?.red?.omen) { const probe = copy(state); probe.turn = "red"; beginFormalTurn(probe, undefined, () => 99); if (isCheckmate(probe, "red") || isStalemate(probe, "red")) return false; }
  delete state.turnStartedAt; delete state.turnDeadlineAt; delete state.formalClock;
  (state.heroRuntime!.black ??= {}).shuffleWindow = "A";
  state.pendingShuffle = { window: "A", side: "black" }; return true;
}
export function openShuffleB(state: GameState, side: Side): boolean {
  const runtime = state.heroRuntime?.black;
  if (side !== "black" || selectedHeroId(state, "black") !== "shuffler" || runtime?.used || runtime?.shuffleLost || runtime?.shuffleWindow !== "B" || state.formalTurns?.black !== 1) return false;
  delete state.turnStartedAt; delete state.turnDeadlineAt; delete state.formalClock;
  state.turn = "black"; state.pendingShuffle = { window: "B", side: "black" }; return true;
}
export function applyShuffleAction(state: GameState, secret: SecretState, command: HeroAbilityCommand, random: RandomInt): MoveResult {
  const s = copy(state), k = copy(secret), pending = s.pendingShuffle;
  if (!pending || s.status !== "playing" || command.ability !== "shuffle") throw new RuleError("NO_SHUFFLE_WINDOW", "当前没有洗牌窗口");
  if (command.expectedRevision !== s.revision) throw new RuleError("STALE_REVISION", "客户端版本過期");
  const runtime = s.heroRuntime!.black!; delete s.pendingShuffle;
  if (command.skip) {
    if (pending.window === "A") { runtime.shuffleWindow = "B"; advanceToFormalTurn(s, k, "red", random); }
    else { runtime.shuffleLost = true; delete runtime.shuffleWindow; advanceToFormalTurn(s, k, "black", random); }
  } else {
    if (!k.shuffleOpening) throw new RuleError("MISSING_SHUFFLE_OPENING", "没有开局权威结构");
    runtime.used = true; delete runtime.shuffleWindow;
    const opening = k.shuffleOpening, rebuilt = copy(opening.pieces), pool: SecretIdentity[] = Object.values(copy(opening.identities));
    const anchors = new Map<string, Side>();
    for (const side of ["red", "black"] as const) {
      const hostId = k.wind?.[side]?.hostId;
      if (!hostId) continue;
      const host = rebuilt.find(p => p.id === hostId && p.faceDown);
      if (!host) throw new RuleError("SHUFFLE_WIND_ANCHOR", "宿主没有合法初始暗子结构");
      const slots = rebuilt.filter(p => p.faceDown && (side === "red" ? p.y >= 5 : p.y <= 4) && !anchors.has(p.id));
      if (!slots.length) throw new RuleError("SHUFFLE_WIND_ANCHOR", "己方开局暗子位置不足");
      const target = slots[random(slots.length)], from = { x: host.x, y: host.y }; host.x = target.x; host.y = target.y; target.x = from.x; target.y = from.y;
      anchors.set(hostId, side);
    }
    k.identities = {};
    for (const [id, side] of anchors) {
      const candidates = pool.map((identity, index) => ({ identity, index })).filter(p => p.identity.color === side);
      if (!candidates.length) throw new RuleError("SHUFFLE_WIND_ANCHOR", "阵营锚定身份不足");
      const chosen = candidates[random(candidates.length)]; k.identities[id] = pool.splice(chosen.index, 1)[0];
    }
    const shuffled = shuffleIdentities(pool, random); let index = 0;
    for (const p of rebuilt) if (p.faceDown && !anchors.has(p.id)) k.identities[p.id] = shuffled[index++];
    const initialIds = new Set(rebuilt.map(p => p.id));
    s.pieces = rebuilt; s.captured = s.captured.filter(p => !initialIds.has(p.id));
    // 恢复开局公开将帅结构时同步其权威引用，技能次数/冷却和有效宿主不回滚。
    for (const side of ["red", "black"] as const) {
      const general = rebuilt.find(p => !p.faceDown && p.type === "general" && p.color === side);
      if (general) {
        (k.trueGenerals ??= {})[side] = general.id;
        if (k.wind?.[side]) k.wind[side]!.decoyId = general.id;
      }
    }
    for (const effects of Object.values(s.effectsByPieceId ?? {})) delete effects.insightMark;
    for (const insights of Object.values(k.insights ?? {})) for (const result of insights ?? []) result.valid = false;
    for (const p of s.pieces) {
      const effects = s.effectsByPieceId?.[p.id];
      if (effects?.flight) p.layer = "air";
      if (effects?.riverTurns !== undefined) delete effects.riverTurns;
    }
    reconcileGhostInfections(s);
    k.history = []; delete k.replay; delete k.formalStart;
    k.timelineEpoch = (k.timelineEpoch ?? 0) + 1;
    delete s.turnLifecycle; delete s.lastMove; delete s.turnStartedAt; delete s.turnDeadlineAt; delete s.formalClock;
    s.automaticEvents = [{ kind: "shuffle", side: "black" }]; s.destructionBatches = []; s.landingEvents = [];
    // Window B replaces black's second formal turn without running its ordinary
    // begin/main/end callbacks. The authority entry deduplicates this transaction.
    const blackBefore = s.formalTurns?.black ?? 0;
    if (pending.window === "B") {
      s.formalTurns ??= { red: 0, black: 0 };
      s.formalTurns.black += 1;
    }
    s.turn = "red";
    emitMechanismEvent("shuffle_reset", s, k, { window: pending.window, countsAsFormalTurn: pending.window === "B", blackBefore, blackAfter: s.formalTurns?.black ?? 0 });
    advanceToFormalTurn(s, k, "red", random);
  }
  s.revision++; k.processedActions[command.actionId] = s.revision;
  return { state: s, secret: k, duplicate: false };
}
