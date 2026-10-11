import { playerRoomView, type RemoteRoom } from "../../src/remote-room.ts";
import { getLegalMoves } from "../../src/rules.ts";
import type { GameState, Side } from "../../src/types.ts";

export type Intent = { kind: "move"; pieceId: string; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "insight"; pieceId: string; secretInsight: boolean }
  | { kind: "shuffle"; skip: boolean } | { kind: "resign" } | { kind: "wait" };
const pick = (value: any, fields: readonly string[]) => Object.fromEntries(fields.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
const copy = <T>(v: T): T => structuredClone(v);
const approvedInputs = new WeakSet<object>();
export function isApprovedPolicyInput(input: object): boolean { return approvedInputs.has(input); }
export function freezeTree<T>(v: T): T {
  if (v && typeof v === "object") { for (const c of Object.values(v)) freezeTree(c); Object.freeze(v); }
  return v;
}

/** EP-HH-01 whitelist. New fields/sources require a new review, not spread-copy. */
export function policyProjection(room: RemoteRoom, actor: string) {
  const view = playerRoomView(room, actor), s = view.state;
  if (s && ((s.gameMode ?? "jieqi") !== "jieqi" || s.featureRules?.mutation !== "jian_xie" ||
      Object.values(s.featureRules?.heroes ?? {}).some(h => h !== "night" && h !== "shuffler") ||
      s.pendingHeroChild || s.pendingDescent || s.flowDance || s.forcedDefense)) {
    throw new Error("blocked_supported_scope");
  }
  const selections = Object.fromEntries(Object.entries(s?.featureRules?.heroSelections ?? {}).map(([side, source]) => [side, pick(source, ["heroId", "form", "packageId"])]));
  const publicState = s ? {
    ...pick(s, ["status", "turn", "revision", "winner", "reason", "drawReason", "turnStartedAt", "turnDeadlineAt"]),
    ...(s.formalTurns ? { formalTurns: pick(s.formalTurns, ["red", "black"]) } : {}),
    ...(s.formalClock ? { formalClock: pick(s.formalClock, ["side", "number"]) } : {}),
    ...(s.pendingShuffle ? { pendingShuffle: pick(s.pendingShuffle, ["side", "window"]) } : {}),
    pieces: s.pieces.map(p => ({ ...pick(p, ["id", "x", "y", "faceDown"]), ...(!p.faceDown ? pick(p, ["type", "color"]) : {}) })),
    captured: s.captured.map(p => ({ ...pick(p, ["id", "color", "type", "capturedBy", "moveNumber", "cause"]), ...(p.position ? { position: pick(p.position, ["x", "y"]) } : {}) })),
    featureRules: { heroes: pick(s.featureRules?.heroes, ["red", "black"]), heroSelections: selections, mutation: "jian_xie" },
    heroFormLock: selections,
    heroRuntime: Object.fromEntries(Object.entries(s.heroRuntime ?? {}).map(([side, runtime]) => [side, pick(runtime, ["used", "pupil", "insightCount", "insightTurn", "shuffleWindow", "shuffleLost"])])),
    effectsByPieceId: Object.fromEntries(Object.entries(s.effectsByPieceId ?? {}).map(([id, effect]) => [id, pick(effect, ["insightMark"])]).filter(([,effect]) => Object.keys(effect).length)),
    ...(s.turnLifecycle ? { turnLifecycle: pick(s.turnLifecycle, ["side", "number", "phase", "phases", "mainPieceId"]) } : {}),
    ...(s.lastCompletedFormalTurn ? { lastCompletedFormalTurn: pick(s.lastCompletedFormalTurn, ["side", "number", "phase", "phases", "mainPieceId"]) } : {}),
    ...(s.lastMove ? { lastMove: { ...pick(s.lastMove, ["pieceId", "actingSide", "landed", "tier", "keywords", "source", "opportunity", "countsAsFormalTurn"]),
      from: pick(s.lastMove.from, ["x", "y"]), to: pick(s.lastMove.to, ["x", "y"]),
      ...(s.lastMove.revealed ? { revealed: pick(s.lastMove.revealed, ["type", "color"]) } : {}),
      ...(s.lastMove.captured ? { captured: pick(s.lastMove.captured, ["id", "type", "color", "capturedBy", "cause", "moveNumber"]) } : {}) } } : {}),
    actionRecords: (s.actionRecords ?? []).map(a => ({ ...pick(a, ["actingSide", "pieceId", "tier", "keywords", "source", "opportunity", "countsAsFormalTurn"]),
      ...(a.from ? { from: pick(a.from, ["x", "y"]) } : {}), ...(a.to ? { to: pick(a.to, ["x", "y"]) } : {}) })),
    automaticEvents: (s.automaticEvents ?? []).filter(e => e.kind === "shuffle").map(e => pick(e, ["kind", "side"])),
  } : undefined;
  return copy({ phase: view.phase, ...(view.viewerSide ? { viewer_side: view.viewerSide } : {}),
    ...(publicState ? { public_state: publicState } : {}),
    public_rule_descriptor: { mode_id: "original_jieqi", engine_mode_id: "jieqi", background: "jian_xie", effective_sources: selections },
    ...(view.ownHeroChoice ? { own_source: view.ownHeroChoice } : {}),
    ...(view.ownHeroSecrets?.insights ? { own_insights: view.ownHeroSecrets.insights.map(i => ({ ...pick(i, ["pieceId", "revision", "valid"]), identity: pick(i.identity, ["type", "color"]) })) } : {}),
    ...(view.rps ? { rps: { ...pick(view.rps, ["status", "round", "submitted", "assignments"]) } } : {}),
  });
}

/** Public geometry only: this function never receives SecretState or a room. */
export function attemptCatalog(projection: ReturnType<typeof policyProjection>): Intent[] {
  const s = projection.public_state as GameState | undefined, side = projection.viewer_side as Side | undefined;
  if (projection.phase !== "playing" || !s || s.status !== "playing" || side !== s.turn) return [{ kind: "wait" }];
  if (s.pendingShuffle) return [{ kind: "shuffle", skip: false }, { kind: "shuffle", skip: true }];
  const intents: Intent[] = [];
  for (const p of s.pieces) for (const to of getLegalMoves(s, p.id, side)) {
    intents.push({ kind: "move", pieceId: p.id, from: { x: p.x, y: p.y }, to });
  }
  if (s.featureRules?.heroes?.[side] === "night" && s.turnLifecycle?.phase === "before_main") {
    const r = s.heroRuntime?.[side], number = (s.formalTurns?.[side] ?? 0) + 1;
    if (r?.insightTurn !== number) for (const secretInsight of [false, true]) {
      const cost = secretInsight ? 7 + 6 * (r?.insightCount ?? 0) : 4 + 4 * (r?.insightCount ?? 0);
      if ((r?.pupil ?? 0) >= cost) for (const p of s.pieces.filter(p => p.faceDown)) intents.push({ kind: "insight", pieceId: p.id, secretInsight });
    }
  }
  return intents.length ? intents : [{ kind: "wait" }];
}

export interface DecisionConfig { profile: "P0"; maxAttempts: number; workerTimeoutMs: number; maxInputBytes: number; maxCatalogEntries: number }
export interface PolicyInput { actor_id: string; projection: ReturnType<typeof policyProjection>; visible_history: any[]; command_catalog: Intent[]; mapping_epoch: number; decision_budget: DecisionConfig }

/** Delivery sequence counts only changed authorized projections / own receipts. */
export class ObservationBroker {
  #history = new Map<string, any[]>();
  #last = new Map<string, string>();
  #epochs = new Map<string, number>();
  #washRevision = new Map<string, number>();
  deliver(room: RemoteRoom, actor: string, receipt?: unknown): void {
    const projection = policyProjection(room, actor), serialized = JSON.stringify(projection);
    const history = this.#history.get(actor) ?? []; this.#history.set(actor, history);
    if (this.#last.get(actor) !== serialized) {
      const state = projection.public_state;
      if (state?.automaticEvents?.some(e => e.kind === "shuffle") && this.#washRevision.get(actor) !== state.revision) {
        this.#washRevision.set(actor, state.revision); this.#epochs.set(actor, (this.#epochs.get(actor) ?? 0) + 1);
      }
      history.push({ delivery_seq: history.length, kind: "observation", mapping_epoch: this.#epochs.get(actor) ?? 0, projection });
      this.#last.set(actor, serialized);
    }
    if (receipt !== undefined) history.push({ delivery_seq: history.length, kind: "own_receipt", receipt: copy(receipt) });
  }
  input(room: RemoteRoom, actor: string, config: DecisionConfig): Readonly<PolicyInput> {
    this.deliver(room, actor);
    const projection = policyProjection(room, actor), catalog = attemptCatalog(projection);
    if (catalog.length > config.maxCatalogEntries) throw new Error("blocked_catalog_budget");
    const input = freezeTree(copy({ actor_id: actor, projection, command_catalog: catalog, visible_history: this.#history.get(actor)!, mapping_epoch: this.#epochs.get(actor) ?? 0, decision_budget: config }));
    approvedInputs.add(input); return input;
  }
}
