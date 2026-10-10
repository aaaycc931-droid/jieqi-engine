import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { publicRemoteRoom, playerRoomView, type RemoteRoom } from "../../src/remote-room.ts";
import type { MechanismEvent } from "../../src/mechanism-observer.ts";

export const inputDirectory = new URL("../../tests/fixtures/scoring/", import.meta.url);
export const readInput = (name: string) => JSON.parse(readFileSync(new URL(name, inputDirectory), "utf8"));
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const plan = readInput("LOG_FIELD_PLAN.json");
type Channel = "public" | "actor_A_private" | "actor_B_private" | "authoritative";
const channels: Channel[] = ["public", "actor_A_private", "actor_B_private", "authoritative"];

export function authoritySnapshot(room: RemoteRoom) {
  const game = room.game!;
  const { history, ...secret } = game.secret;
  return structuredClone({ state: game.state, secret: { ...secret, history_length: history?.length ?? 0 }, players: game.players });
}

/** Research-only archive. Its authority fields must never be used as policy input. */
export class ResearchLog {
  readonly fixtureId: string;
  readonly rows: Record<Channel, any[]> = Object.fromEntries(channels.map(c => [c, []])) as Record<Channel, any[]>;
  readonly observations = new Map<string, { id: string; epoch: number }>();
  readonly ruleHash: string;

  constructor(fixtureId: string, ruleHash: string) { this.fixtureId = fixtureId; this.ruleHash = ruleHash; }

  private projection(room: RemoteRoom, channel: Channel) {
    return channel === "authoritative" ? authoritySnapshot(room) : channel === "public" ? publicRemoteRoom(room) : playerRoomView(room, channel === "actor_A_private" ? "A" : "B");
  }

  private append(channel: Channel, row: Record<string, unknown>): void {
    const list = this.rows[channel];
    const value = { ...structuredClone(row), sequence: list.length, previous_hash: list.at(-1)?.hash ?? null };
    list.push({ ...value, hash: sha256(JSON.stringify(value)) });
  }

  record(before: RemoteRoom, after: RemoteRoom, context: any, events: readonly MechanismEvent[]) {
    const a = before.game!, b = after.game!;
    const cmd = context.command;
    const isInsight = cmd?.ability === "insight";
    const committed = context.outcome === "committed";
    const reset = committed ? events.find(e => e.kind === "shuffle_reset") : undefined;
    const sourceEvents = committed || context.outcome === "initialization" ? events : [];
    const grant = sourceEvents.filter(e => e.kind === "pupil_grant").reduce((n, e) => n + Number(e.details.amount), 0);
    const spent = sourceEvents.filter(e => e.kind === "insight_spend").reduce((n, e) => n + Number(e.details.amount), 0);
    const nBefore = a.state.heroRuntime?.red?.insightCount ?? 0;
    const pupilBefore = a.state.heroRuntime?.red?.pupil ?? 0;
    const pupilAfter = b.state.heroRuntime?.red?.pupil ?? 0;
    const epochBefore = a.secret.timelineEpoch ?? 0, epochAfter = b.secret.timelineEpoch ?? 0;
    for (const side of ["red", "black"] as const) for (const row of b.secret.insights?.[side] ?? []) {
      const key = `${side}:${row.revision}:${row.pieceId}`;
      if (!this.observations.has(key)) this.observations.set(key, { id: `${this.fixtureId}:observation:${key}`, epoch: epochBefore });
    }
    const newObservation = committed && isInsight ? b.secret.insights?.red?.at(-1) : undefined;
    const observationMeta = newObservation ? this.observations.get(`red:${newObservation.revision}:${newObservation.pieceId}`) : undefined;
    const ownNumber = a.state.pendingShuffle?.window === "B" ? (a.state.formalTurns?.black ?? 0) + 1 : a.state.turnLifecycle?.number ?? (a.state.formalTurns?.[a.state.turn] ?? 0) + 1;
    const fields: Record<string, Record<string, { value: unknown; null_reason: string | null }>> = {};
    for (const entry of plan.fields) {
      (fields[entry.group] ??= {})[entry.field] = { value: null, null_reason: entry.phase === "empirical_calibration_deferred" ? "empirical_calibration_deferred" : "not_applicable_to_this_event" };
    }
    const set = (group: string, values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) {
        if (!fields[group]?.[key]) throw new Error(`Unknown contract field ${group}.${key}`);
        fields[group][key] = { value: value ?? null, null_reason: value === undefined || value === null ? "not_applicable_to_this_event" : null };
      }
    };
    set("study_cluster", { study_id: "MODE-SCORE-MODEL-001", external_RPS_result: { red: "B", black: "A" }, actor_id_to_final_side: { A: "red", B: "black" }, rule_hash: this.ruleHash, random_law_id: "controlled_legal_fixture_not_population_sample", random_event_keys: context.randomKeys ?? [] });
    set("formal_window", { formal_turn_id: `${this.fixtureId}:${epochBefore}:${a.state.turn}:${ownNumber}`, own_turn_ordinal: ownNumber, atomic_action_id: cmd?.actionId, phase: a.state.pendingShuffle ? "shuffle_choice" : a.state.turnLifecycle?.phase, pending_shuffle_window: a.state.pendingShuffle?.window, window_reached: Boolean(a.state.pendingShuffle), legality_status: context.outcome, terminal_status: b.state.status, chosen_action: cmd, no_action_reason: context.errorCode });
    set("H14_resources", { pupil_before: pupilBefore, periodic_grant: grant, pupil_after: pupilAfter, successful_insight_n_before: nBefore, n_after: b.state.heroRuntime?.red?.insightCount ?? 0 });
    const quoteApplicable = !a.state.pendingShuffle && context.outcome !== "duplicate" && context.outcome !== "timeout" && !["INSIGHT_TURN_LIMIT", "WRONG_TURN", "STALE_REVISION", "INVALID_PHASE", "INVALID_PRE_MAIN_WINDOW"].includes(context.errorCode);
    if (isInsight) set("H14_resources", { quoted_cost: quoteApplicable ? cmd.secretInsight ? 7 + 6 * nBefore : 4 + 4 * nBefore : null, actually_charged_cost: spent, insight_attempt_id: context.attemptId, success: committed, failure_reason: context.errorCode, normal_or_secret: cmd.secretInsight ? "secret" : "normal" });
    if (newObservation) set("H14_observation", { viewer_id: "A", observation_id: observationMeta?.id, target_piece_or_slot_id: newObservation.pieceId, payload_access_permission: "hero:night:insight; owner_A_and_authority_only", public_payload_projection: cmd.secretInsight ? { operation: "insight", cost: spent } : { operation: "insight", cost: spent, target: newObservation.pieceId }, true_type_snapshot: newObservation.identity.type, original_side_snapshot_if_source_permits: newObservation.identity.color, mapping_epoch: observationMeta?.epoch, observed_at_revision: newObservation.revision, exact_mapping_validity: newObservation.valid, public_insight_mark: Boolean(b.state.effectsByPieceId?.[newObservation.pieceId]?.insightMark) });
    if (reset) {
      set("H11_reset", { window_A_or_B: reset.details.window, opening_snapshot_hash: sha256(JSON.stringify(a.secret.shuffleOpening)), initial_piece_set: a.secret.shuffleOpening?.pieces, restored_piece_set: reset.state.pieces, old_mapping_epoch: epochBefore, new_mapping_epoch: epochAfter, timeline_epoch_before_after: [epochBefore, epochAfter], attachment_transfer_source: "existing_piece_id_attachment_source", ground_effects_before_after: { before: a.state.ghosts ?? [], after: reset.state.ghosts ?? [] }, resources_before_after: { before: a.state.heroRuntime, immediately_after_reset: reset.state.heroRuntime, after_next_turn_begin: b.state.heroRuntime }, clock_before_after: { before: { start: a.state.turnStartedAt ?? null, deadline: a.state.turnDeadlineAt ?? null }, reset: { start: reset.state.turnStartedAt ?? null, deadline: reset.state.turnDeadlineAt ?? null }, after: { start: b.state.turnStartedAt ?? null, deadline: b.state.turnDeadlineAt ?? null } }, H14_marks_cleared: Object.keys(a.state.effectsByPieceId ?? {}).filter(id => a.state.effectsByPieceId?.[id]?.insightMark && !reset.state.effectsByPieceId?.[id]?.insightMark), observations_invalidated: (reset.secret.insights?.red ?? []).filter(o => !o.valid) });
      set("H11_B_count_delta", { formal_counter_before: a.state.formalTurns, formal_counter_after: reset.state.formalTurns, counts_as_formal_turn: reset.details.countsAsFormalTurn, regular_turn_begin_executed: sourceEvents.some(e => e.kind === "formal_turn_begin" && e.details.side === "black"), ordinary_main_action_executed: false, regular_turn_end_executed: sourceEvents.some(e => e.kind === "formal_turn_end" && e.details.side === "black") });
    }
    const memories = (b.secret.insights?.red ?? []).map(row => { const meta = this.observations.get(`red:${row.revision}:${row.pieceId}`)!; return { observation_id: meta.id, observed_epoch: meta.epoch, payload: row.identity, valid: row.valid }; });
    if (memories.length) set("private_memory", { viewer_id: "A", history_observation_id: memories.map(m => m.observation_id), observed_epoch: memories.map(m => m.observed_epoch), remembered_payload: memories.map(m => m.payload), current_precision_status: memories.map(m => m.valid), invalidation_reason: memories.some(m => !m.valid) ? "mapping_epoch_reset" : null });
    const naturalTerminal = b.state.status === "finished";
    set("trajectory_result", { winner: naturalTerminal ? b.state.winner : null, reason: naturalTerminal ? b.state.reason : null, draw_reason: naturalTerminal ? b.state.drawReason : null, censored: !naturalTerminal, censor_reason: !naturalTerminal ? "controlled_mechanism_prefix_only" : null, source_event_chain_id: this.fixtureId });
    const attempt = { event_id: context.attemptId, kind: "attempt", command: cmd ?? null, actor_id: context.actorId ?? null, at_ms: context.now, outcome: context.outcome, failure_reason: context.errorCode ?? null, before: authoritySnapshot(before), after: authoritySnapshot(after), fields, committed_source_events: sourceEvents.map(e => ({ kind: e.kind, details: e.details, state: e.state, secret: authoritySnapshot({ ...after, game: { ...b, state: e.state, secret: e.secret } }).secret })) };
    this.append("authoritative", attempt);
    if (committed || context.outcome === "timeout") this.append("authoritative", { event_id: `${context.attemptId}:commit`, kind: context.outcome === "timeout" ? "timeout_commit" : "commit", action_id: cmd?.actionId, attempt_id: context.attemptId, revision: b.state.revision });
    for (const channel of channels.filter(c => c !== "authoritative")) {
      const owner = channel === "actor_A_private" ? "A" : channel === "actor_B_private" ? "B" : null;
      // Permission comes from the existing product projection, not field names.
      // Public and peer channels never receive attempted commands or failures.
      this.append(channel, { event_id: context.attemptId, kind: "projection_snapshot", at_ms: context.now, before: this.projection(before, channel), after: this.projection(after, channel), ...(owner === context.actorId ? { own_attempt: { command: cmd, outcome: context.outcome, failure_reason: context.errorCode ?? null } } : {}) });
    }
    return fields;
  }

  save(directory: string, randomTape: unknown, metadata: Record<string, unknown> = {}) {
    mkdirSync(directory, { recursive: true });
    chmodSync(directory, 0o700);
    const files: Record<string, unknown> = {};
    for (const channel of channels) {
      const text = this.rows[channel].map(row => JSON.stringify(row)).join("\n") + "\n";
      const file = `${channel}.jsonl`;
      writeFileSync(join(directory, file), text);
      chmodSync(join(directory, file), 0o600);
      files[file] = { sha256: sha256(text), bytes: Buffer.byteLength(text), event_count: this.rows[channel].length, head_hash: this.rows[channel].at(-1)?.hash ?? null, access: channel };
    }
    const tapeText = JSON.stringify(randomTape, null, 2) + "\n";
    writeFileSync(join(directory, "random-tape.json"), tapeText);
    chmodSync(join(directory, "random-tape.json"), 0o600);
    files["random-tape.json"] = { sha256: sha256(tapeText), bytes: Buffer.byteLength(tapeText), access: "authoritative_only" };
    const manifest = { completion: "controlled_prefix_completed", ...metadata, schema: "lezi.mechanism_archive.v1", fixture_id: this.fixtureId, rule_hash: this.ruleHash, formal_scoring_status: "frozen", empirical_parameters_approved: false, q: null, H: null, I: null, B: null, sampled_population: false, fields: 85, deferred_fields: plan.empirical_stage_deferred_fields, files };
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    verifyArchive(directory);
    return manifest;
  }
}

export function verifyArchive(directory: string) {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  for (const [name, metadata] of Object.entries(manifest.files) as [string, any][]) {
    if (!/^(public|actor_A_private|actor_B_private|authoritative)\.jsonl$|^random-tape\.json$/.test(name)) throw new Error("Invalid archive path");
    const bytes = readFileSync(join(directory, name));
    if (sha256(bytes) !== metadata.sha256 || bytes.length !== metadata.bytes) throw new Error(`Archive checksum mismatch: ${name}`);
    if (!name.endsWith(".jsonl")) continue;
    const rows = bytes.toString("utf8").trimEnd().split("\n").map(line => JSON.parse(line));
    let previous: string | null = null;
    for (let i = 0; i < rows.length; i++) {
      const { hash, ...row } = rows[i];
      if (row.sequence !== i || row.previous_hash !== previous || sha256(JSON.stringify(row)) !== hash) throw new Error(`Archive event chain mismatch: ${name}`);
      previous = hash;
    }
    if (rows.length !== metadata.event_count || previous !== metadata.head_hash) throw new Error(`Archive count mismatch: ${name}`);
  }
  return manifest;
}
