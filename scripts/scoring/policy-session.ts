import { createHmac } from "node:crypto";
import { mkdirSync, chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureMechanismEvents } from "../../src/mechanism-observer.ts";
import { withResearchSources, type ResearchSourceContext } from "../../src/research-source-context.ts";
import { createRemoteRoom, joinRemoteRoom, submitRemoteHeroSelection, submitRemoteRps, completeRemoteHeroIntro,
  advanceRemoteRoomTime, submitRemoteMove, submitRemoteHeroAbility, submitRemoteAssassination, updateRemoteTrapDraft, completeRemoteHeroPreparation, surrenderRemoteRoom, type RemoteRoom } from "../../src/remote-room.ts";
import type { RandomInt, MoveCommand, HeroAbilityCommand, GameModeId, Position } from "../../src/types.ts";
import { MUTATION_IDS } from "../../src/mutations.ts";
import { ObservationBroker, type DecisionConfig, type Intent, policyProjection } from "./policy-observation.ts";
import { decideIsolated } from "./policy-process.ts";
import { SemanticRandom } from "./semantic-rng.ts";
import { digest, verifyPolicyArchive } from "./policy-archive.ts";

export type WorldMask = "00" | "10" | "01" | "11";
export type RpsStratum = "A_initial_black" | "A_initial_red";
export const P0_CONFIG: DecisionConfig = Object.freeze({ profile: "P0", maxAttempts: 128, workerTimeoutMs: 1500, maxInputBytes: 4_000_000, maxCatalogEntries: 2000 });
export interface ModeQualificationPlan {
  mode: "xiangqi" | "half_chaos";
  sources: Record<"A" | "B", "hunter" | "rogue" | "shuffler">;
  traps?: Partial<Record<"A" | "B", readonly Position[]>>;
}
export const MODE_BRIDGE_VERSION = "mode_scoped_P0_v0.3";
function snapshot(room: RemoteRoom) {
  if (!room.game) return structuredClone(room);
  const { history, ...secret } = room.game.secret;
  return structuredClone({ ...room, game: { ...room.game, secret: { ...secret, history_length: history?.length ?? 0 } } });
}
const actors = ["A", "B"] as const;
const ruleError = (e: unknown): string => e instanceof Error && "code" in e ? String(e.code) : "invalid_execution";

/** Trusted authority driver; room/seeds/audit never cross the policy IPC boundary. */
export class PolicySession {
  room: RemoteRoom;
  now = 1000;
  readonly broker = new ObservationBroker();
  readonly journal: any[] = [];
  readonly random: SemanticRandom;
  readonly mask: WorldMask;
  readonly stratum: RpsStratum;
  readonly config: DecisionConfig;
  readonly mode: GameModeId;
  #context: ResearchSourceContext;
  #commands = new Map<string, { actor: string; payload: string }>();
  #decisionSequences = new Map<string, number>();
  #memory = new Map<string, any>();
  #policySeed: string;
  #attempts = 0;
  #ownAttempts = new Map<string, number>();
  #failure: string | undefined;
  #observer: boolean;

  constructor(options: { mask?: WorldMask; stratum?: RpsStratum; ruleSeed: string; policySeed: string; initialRandom?: RandomInt; config?: DecisionConfig; observer?: boolean; modeQualification?: ModeQualificationPlan }) {
    this.mask = options.mask ?? "11"; this.stratum = options.stratum ?? "A_initial_black";
    if (!["00", "10", "01", "11"].includes(this.mask) || !["A_initial_red", "A_initial_black"].includes(this.stratum)) throw new Error("Invalid research condition");
    Object.defineProperty(this, "mask", { value: this.mask, writable: false, configurable: false });
    Object.defineProperty(this, "stratum", { value: this.stratum, writable: false, configurable: false });
    this.config = Object.freeze({ ...(options.config ?? P0_CONFIG) });
    for (const key of ["maxAttempts", "workerTimeoutMs", "maxInputBytes", "maxCatalogEntries"] as const) if (!Number.isSafeInteger(this.config[key]) || this.config[key] < 1) throw new Error("Invalid finite policy budget");
    if (this.config.profile !== "P0" || !options.policySeed) throw new Error("P1 not qualified / policy seed missing");
    this.#policySeed = options.policySeed; this.random = new SemanticRandom(options.ruleSeed); this.#observer = options.observer !== false;
    const plan = options.modeQualification ? structuredClone(options.modeQualification) : undefined;
    this.mode = plan?.mode ?? "jieqi";
    Object.defineProperty(this, "mode", { value: this.mode, writable: false, configurable: false });
    this.#context = { roomId: "policy-qualification", ...(plan ? { mode: plan.mode } : {}), actors: { A: { hero: plan?.sources.A ?? "night", enabled: this.mask[0] === "1" }, B: { hero: plan?.sources.B ?? "shuffler", enabled: this.mask[1] === "1" } } };
    this.room = withResearchSources(this.#context, () => createRemoteRoom(this.#context.roomId, "A", "research-admission", this.now++, { baseMode: this.mode, heroesEnabled: true, mutationsEnabled: !plan }));
    this.#deliver();
    this.#prepare("join", () => joinRemoteRoom(this.room, "B", "research-admission", this.now++).room);
    this.#prepare("select_A", () => submitRemoteHeroSelection(this.room, "A", this.#context.actors.A.hero, undefined, this.now++));
    this.#prepare("select_B", () => submitRemoteHeroSelection(this.room, "B", this.#context.actors.B.hero, undefined, this.now++));
    const initial = this.random.transaction("initial_layout"); let count = 0;
    const fixtureDraws: Array<{ max_exclusive: number; value: number }> = [];
    const initialRandom: RandomInt = options.initialRandom ? max => { const value = options.initialRandom!(max); fixtureDraws.push({ max_exclusive: max, value }); return value; } : (max => {
      if (plan) {
        if (this.mode !== "half_chaos" || count >= 28 || max !== 15 - count % 14) throw new Error("Mode initial Fisher-Yates domain changed");
        count++; return initial.next(max);
      }
      if (count < 29) { if (max !== 30 - count) throw new Error("Initial Fisher-Yates domain changed"); count++; return initial.next(max); }
      count++;
      if (count !== 30 || max !== MUTATION_IDS.length) throw new Error("Unexpected initial random domain");
      return MUTATION_IDS.indexOf("jian_xie");
    });
    const choiceA = this.stratum === "A_initial_black" ? "scissors" : "rock";
    const choiceB = this.stratum === "A_initial_black" ? "rock" : "scissors";
    this.#prepare("rps_A", () => submitRemoteRps(this.room, "A", choiceA, 1, initialRandom, this.now++));
    this.#prepare("rps_B", () => submitRemoteRps(this.room, "B", choiceB, 1, initialRandom, this.now++));
    initial.commit();
    if (options.initialRandom) this.journal.push({ kind: "fixed_fixture_random", draws: fixtureDraws, empirical_population: false });
    if (this.room.game?.state.featureRules?.mutation !== (plan ? undefined : "jian_xie")) throw new Error("Research background mismatch");
    this.#prepare("intro_A", () => completeRemoteHeroIntro(this.room, "A", this.now++));
    this.#prepare("intro_B", () => completeRemoteHeroIntro(this.room, "B", this.now++));
    if (this.room.phase === "hero_preparation") {
      for (const actor of actors) if (this.#context.actors[actor].enabled && this.#context.actors[actor].hero === "hunter") {
        this.#prepare(`traps_${actor}`, () => updateRemoteTrapDraft(this.room, actor, plan?.traps?.[actor] ?? [], this.now++));
        this.#prepare(`ready_${actor}`, () => completeRemoteHeroPreparation(this.room, actor, this.now++));
      }
    }
    this.tick(this.now++);
  }
  #deliver(receiptActor?: string, receipt?: unknown) {
    for (const actor of actors) if (this.room.seats.host.playerId === actor || this.room.seats.guest?.playerId === actor) this.broker.deliver(this.room, actor, actor === receiptActor ? receipt : undefined);
  }
  #capture<T>(op: () => T) { return this.#observer ? captureMechanismEvents(op) : { result: op(), events: [] }; }
  #prepare(label: string, op: () => RemoteRoom) {
    const before = snapshot(this.room);
    const captured = this.#capture(() => withResearchSources(this.#context, op));
    this.room = captured.result;
    this.journal.push({ kind: "prepare", label, before, after: snapshot(this.room), source_events: captured.events });
    this.#deliver();
  }
  tick(at = this.now + 1) {
    if (!Number.isSafeInteger(at) || at < this.now - 1) throw new Error("Invalid research clock");
    const before = snapshot(this.room), random = this.random.transaction("normal_clock_start");
    const captured = this.#capture(() => withResearchSources(this.#context, () => advanceRemoteRoomTime(this.room, random.next, at)));
    this.room = captured.result; this.now = Math.max(this.now, at); if (random.draws.length) random.commit();
    this.journal.push({ kind: "clock_tick", at, before, after: snapshot(this.room), source_events: captured.events }); this.#deliver();
  }
  input(actor: string) { return this.broker.input(this.room, actor, this.config); }
  decide(actor: string) {
    const input = this.input(actor), memory = this.#memory.get(actor) ?? {};
    const ordinal = this.#decisionSequences.get(actor) ?? 0;
    const randomBytes = [...createHmac("sha256", this.#policySeed).update(JSON.stringify([actor, ordinal])).digest().subarray(0, 4)];
    const result = decideIsolated(input, memory, randomBytes);
    this.#memory.set(actor, result.nextMemory); this.#decisionSequences.set(actor, ordinal + 1);
    return result;
  }
  submit(actor: string, intent: Intent, options: { actionId?: string; expectedRevision?: number; at?: number; random?: RandomInt } = {}) {
    if (!actors.includes(actor as any)) throw new Error("Unknown actor");
    if (++this.#attempts > this.config.maxAttempts) { this.#failure = "attempt_budget"; return { outcome: "censored", code: "attempt_budget", result: null }; }
    const at = options.at ?? this.now + 1;
    if (!Number.isSafeInteger(at) || at < this.now) throw new Error("Invalid receipt time");
    this.now = at;
    const state = this.input(actor).projection.public_state;
    const ownAttempt = (this.#ownAttempts.get(actor) ?? 0) + 1; this.#ownAttempts.set(actor, ownAttempt);
    const actionId = options.actionId ?? `policy:${actor}:attempt:${ownAttempt}`;
    const expectedRevision = options.expectedRevision ?? state?.revision ?? 0;
    const payload = JSON.stringify({ intent, expectedRevision });
    const registered = this.#commands.get(actionId);
    const random = this.random.transaction(`hero_rule:${intent.kind}${intent.kind === "shuffle" ? intent.skip ? ":skip" : ":wash" : ""}:${actor}`);
    const before = snapshot(this.room);
    const captured = this.#capture(() => withResearchSources(this.#context, () => {
      try {
        if (registered && (registered.actor !== actor || registered.payload !== payload)) return { outcome: "rejected", code: "RESEARCH_ACTION_ID_CONFLICT" };
        this.#commands.set(actionId, { actor, payload });
        let result;
        if (intent.kind === "move") {
          const command: MoveCommand = { from: intent.from, to: intent.to, pieceId: intent.pieceId, expectedRevision, actionId };
          result = submitRemoteMove(this.room, actor, command, at);
        } else if (intent.kind === "assassination") {
          if (this.mode !== "xiangqi") return { outcome: "rejected", code: "RESEARCH_SOURCE_DISABLED" };
          result = submitRemoteAssassination(this.room, actor, { ...intent, expectedRevision, actionId }, at);
        } else if (intent.kind === "insight" || intent.kind === "shuffle") {
          const side = this.input(actor).projection.viewer_side;
          const source = side ? this.room.game?.state.featureRules?.heroes?.[side] : undefined;
          if (source !== (intent.kind === "insight" ? "night" : "shuffler") && this.room.game?.secret.processedActions[actionId] === undefined) return { outcome: "rejected", code: "RESEARCH_SOURCE_DISABLED" };
          const command: HeroAbilityCommand = { kind: "hero_ability", ability: intent.kind, expectedRevision, actionId,
            ...(intent.kind === "insight" ? { pieceId: intent.pieceId, secretInsight: intent.secretInsight } : { skip: intent.skip }) };
          result = submitRemoteHeroAbility(this.room, actor, command, at, options.random ?? random.next);
        } else if (intent.kind === "resign") {
          // Trusted explicit input only; P0 never offers or chooses resignation.
          result = surrenderRemoteRoom(this.room, actor, expectedRevision, actionId, at);
        } else return { outcome: "not_committed", code: "wait" };
        this.room = result.room;
        const committed = this.room.game?.secret.processedActions[actionId] !== undefined;
        if (committed) this.#commands.set(actionId, { actor, payload });
        return { outcome: result.duplicate ? "duplicate" : committed ? "committed" : "not_committed", code: null };
      } catch (error) { return { outcome: "rejected", code: ruleError(error) }; }
    }));
    if (captured.result.outcome === "committed") random.commit();
    if (captured.result.code === "invalid_execution") this.#failure = "invalid_execution";
    const receipt = { action_id: actionId, ...captured.result };
    this.journal.push({ kind: "attempt", actor, actionId, intent: structuredClone(intent), at, outcome: captured.result.outcome, code: captured.result.code,
      before, after: snapshot(this.room), source_events: captured.result.outcome === "committed" ? captured.events : [] });
    this.#deliver(actor, receipt);
    // Explicit declared receipt-clock tick, including failed attempts. Observer is passive.
    this.tick(at);
    return receipt;
  }
  runP0(decisions: number) {
    if (!Number.isSafeInteger(decisions) || decisions < 1 || decisions > this.config.maxAttempts) throw new Error("Invalid flow budget");
    for (let i = 0; i < decisions && this.room.phase === "playing" && !this.#failure; i++) {
      const actor = this.room.game!.players[this.room.game!.state.turn];
      const result = this.decide(actor); this.submit(actor, result.intent);
    }
    return this.classify();
  }
  classify() {
    const s = this.room.game?.state;
    if (this.#failure) return { status: this.#failure === "attempt_budget" ? "censored" : "invalid_execution", reason: this.#failure, result: null };
    if (s?.status === "finished") {
      const reason = s.reason ?? s.drawReason;
      if (!["ambush", "checkmate", "stalemate", "resign", "timeout"].includes(reason ?? "")) return { status: "blocked", reason: "blocked_pending_terminal_rule", result: null };
      return { status: "legal_terminal", rule_id: `pinned_${this.mode === "jieqi" ? "original_jieqi" : this.mode}:${reason}`, reason, winner_actor: s.winner ? this.room.game!.players[s.winner] : null, result: null };
    }
    if (s?.status === "execution") return { status: "blocked", reason: "unresolved_execution", result: null };
    return { status: "censored", reason: "controlled_flow_prefix_limit", result: null };
  }
  save(directory: string, sourceCommit: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    const rows = { authoritative: this.journal, actor_A_private: this.input("A").visible_history, actor_B_private: this.input("B").visible_history, rule_random: this.random.audit };
    const files: Record<string, unknown> = {};
    for (const [name, content] of Object.entries(rows)) {
      const p = join(directory, `${name}.jsonl`), text = content.map(row => JSON.stringify(row)).join("\n") + "\n";
      writeFileSync(p, text, { mode: 0o600 }); chmodSync(p, 0o600);
      files[`${name}.jsonl`] = { sha256: digest(text), bytes: Buffer.byteLength(text), rows: content.length, access: name === "actor_A_private" ? "A_only" : name === "actor_B_private" ? "B_only" : "authority_only" };
    }
    const manifest = { schema: "lezi.policy_flow_archive.v0.1", source_commit: sourceCommit, interface_version: this.mode === "jieqi" ? "original_jieqi_P0_v0.1" : MODE_BRIDGE_VERSION, mode: this.mode, mask: this.mask, stratum: this.stratum, config: this.config,
      qualification: "P0_flow_only_not_strength", classification: this.classify(), files, q: null, H: null, I: null, B: null, J: null, formal_scoring_status: "frozen", empirical_parameters_approved: false };
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 }); chmodSync(join(directory, "manifest.json"), 0o600);
    verifyPolicyArchive(directory); return manifest;
  }
}
