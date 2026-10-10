import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { captureMechanismEvents } from "../../src/mechanism-observer.ts";
import { createIdentityPool } from "../../src/setup.ts";
import { MUTATION_IDS } from "../../src/mutations.ts";
import { advanceRemoteRoomTime, completeRemoteHeroIntro, createRemoteRoom, joinRemoteRoom, submitRemoteHeroAbility, submitRemoteHeroSelection, submitRemoteMove, submitRemoteRps, type RemoteRoom } from "../../src/remote-room.ts";
import type { HeroAbilityCommand, MoveCommand, SecretIdentity } from "../../src/types.ts";
import { readInput, ResearchLog, sha256 } from "./research-log.ts";

export const layout = readInput("INITIAL_LAYOUT.json");
export const resetLayout = readInput("RESET_REALIZATION.json");
export const fixtures: any[] = readInput("FIXTURE_SPECIFICATIONS.json").fixtures;
export const ruleHash = sha256(readdirSync(new URL("../../src/", import.meta.url)).filter(n => n.endsWith(".ts")).sort().map(n => `${n}\n${readFileSync(new URL(`../../src/${n}`, import.meta.url), "utf8")}`).join("\n"));
const equalIdentity = (a: SecretIdentity, b: SecretIdentity) => a.type === b.type && a.color === b.color;
type Draw = { event_key: string; max_exclusive: number; value: number };

/** Construct a legal Fisher-Yates realization, never overwrite dealt identities. */
export function permutationDraws(pool: SecretIdentity[], desired: SecretIdentity[], prefix: string): Draw[] {
  assert.equal(pool.length, desired.length);
  const work = structuredClone(pool), draws: Draw[] = [];
  for (let i = work.length - 1; i > 0; i--) {
    const j = work.findIndex((entry, index) => index <= i && equalIdentity(entry, desired[i]));
    assert(j >= 0, "Desired mapping must use the same identity multiset");
    draws.push({ event_key: `${prefix}:fisher_yates:${i}`, max_exclusive: i + 1, value: j });
    [work[i], work[j]] = [work[j], work[i]];
  }
  assert.deepEqual(work, desired);
  return draws;
}

export class RandomTape {
  readonly recorded: Draw[] = [];
  private planned: Draw[] = [];
  private index = 0;
  private replay: Draw[] | undefined;
  private replayIndex = 0;
  constructor(replay?: Draw[]) { this.replay = replay; }
  plan(draws: Draw[]) { this.planned = draws; this.index = 0; }
  next = (max: number): number => {
    const expected = this.planned[this.index++];
    assert(expected, "Unexpected RNG call");
    assert.equal(max, expected.max_exclusive, "RNG semantic event range changed");
    const actual = this.replay ? this.replay[this.replayIndex++] : expected;
    assert.deepEqual(actual, expected, "RNG replay event key/order/range/value changed");
    assert(Number.isInteger(actual.value) && actual.value >= 0 && actual.value < max);
    this.recorded.push(structuredClone(actual));
    return actual.value;
  };
  finish(required = true) { if (required) assert.equal(this.index, this.planned.length, "Missing planned RNG calls"); }
  verifyReplayComplete() { if (this.replay) assert.equal(this.replayIndex, this.replay.length, "Unused RNG replay events"); }
}

export class FixtureRunner {
  room: RemoteRoom;
  readonly log: ResearchLog;
  readonly random: RandomTape;
  readonly observerEnabled: boolean;
  now = 1000;
  counter = 0;
  readonly attempts: any[] = [];

  constructor(id: string, options: { observer?: boolean; replay?: Draw[] } = {}) {
    this.log = new ResearchLog(id, ruleHash);
    this.random = new RandomTape(options.replay);
    this.observerEnabled = options.observer !== false;
    let room = createRemoteRoom(`scoring:${id}`, "A", "fixture-admission", this.now++, { baseMode: "jieqi", heroesEnabled: true, mutationsEnabled: true });
    room = joinRemoteRoom(room, "B", "fixture-admission", this.now++).room;
    room = submitRemoteHeroSelection(room, "A", "night", this.random.next, this.now++);
    room = submitRemoteHeroSelection(room, "B", "shuffler", this.random.next, this.now++);
    this.random.plan([...permutationDraws(createIdentityPool(), Object.values(layout.authoritative_private_identities), "initial"), { event_key: "conditioned_mutation:jian_xie", max_exclusive: MUTATION_IDS.length, value: MUTATION_IDS.indexOf("jian_xie") }]);
    // B wins the external RPS, then the single shuffler exchange makes A red.
    room = submitRemoteRps(room, "A", "scissors", 1, this.random.next, this.now++);
    room = submitRemoteRps(room, "B", "rock", 1, this.random.next, this.now++);
    this.random.finish();
    room = completeRemoteHeroIntro(room, "A", this.now++);
    room = completeRemoteHeroIntro(room, "B", this.now++);
    const start = this.observe(() => advanceRemoteRoomTime(room, this.random.next, this.now++));
    this.room = start.result;
    assert.equal(this.room.phase, "playing");
    assert.deepEqual(this.room.game!.players, { red: "A", black: "B" });
    assert.deepEqual(this.room.game!.state.pieces, layout.public_pieces);
    assert.deepEqual(this.room.game!.secret.identities, layout.authoritative_private_identities);
    assert.equal(this.room.game!.state.featureRules!.mutation, "jian_xie");
    assert(this.room.game!.state.heroFormLock && this.room.game!.secret.heroFormLock);
    assert.equal(this.room.game!.state.heroRuntime!.red!.pupil, 0);
    this.log.record(this.room, this.room, { attemptId: `${id}:initialization`, outcome: "initialization", now: this.now - 1, randomKeys: this.random.recorded.map(r => r.event_key) }, start.events);
  }

  private observe<T>(operation: () => T) { return this.observerEnabled ? captureMechanismEvents(operation) : { result: operation(), events: [] }; }

  commandFor(action: any, suffix?: string): HeroAbilityCommand | MoveCommand {
    const actionId = suffix ?? `${this.log.fixtureId}:command:${++this.counter}`;
    const expectedRevision = this.room.game!.state.revision;
    if (action.kind === "ordinary_move") return { actionId, expectedRevision, from: { x: action.from_xy[0], y: action.from_xy[1] }, to: { x: action.to_xy[0], y: action.to_xy[1] } };
    return { kind: "hero_ability", ability: action.kind === "shuffle_choice" ? "shuffle" : "insight", actionId, expectedRevision, ...(action.kind === "shuffle_choice" ? { skip: action.choice === "skip" } : { secretInsight: action.normal_or_secret === "secret", pieceId: action.target_piece_id }) };
  }

  submit(command: HeroAbilityCommand | MoveCommand, actorId: string, at = ++this.now) {
    const input = this.room;
    const before = structuredClone(this.room);
    const randomStart = this.random.recorded.length;
    const wash = "ability" in command && command.ability === "shuffle" && !command.skip;
    this.random.plan(wash ? permutationDraws(Object.values(this.room.game!.secret.shuffleOpening!.identities), Object.values(resetLayout.authoritative_private_identities), `${command.actionId}:reset`) : []);
    const captured = this.observe(() => {
      try {
        const result = "ability" in command ? submitRemoteHeroAbility(this.room, actorId, command, at, this.random.next) : submitRemoteMove(this.room, actorId, command, at);
        // BluetoothHostRoom.handle() returns views(), whose existing time tick
        // starts a clock after skipping B (the side stays black). This is an
        // explicit harness step, not a side effect of observing/logging state.
        if (result.room.phase === "playing") result.room = advanceRemoteRoomTime(result.room, this.random.next, at);
        return { result, errorCode: null };
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error)) throw error;
        return { result: undefined, errorCode: String(error.code) };
      }
    });
    const { result, errorCode } = captured.result;
    if (result) this.room = result.room;
    const processed = this.room.game!.secret.processedActions[command.actionId] !== undefined;
    const outcome = errorCode ? "rejected" : result?.duplicate ? "duplicate" : processed ? "committed" : this.room.game!.state.reason === "timeout" ? "timeout" : "not_committed";
    if (outcome === "rejected" || outcome === "duplicate") assert.deepEqual(this.room, before, "Failed/duplicate authority submission changed state");
    assert.deepEqual(input, before, "Authority operation mutated its input room");
    this.random.finish(outcome === "committed");
    const context = { attemptId: `${this.log.fixtureId}:attempt:${this.attempts.length}`, actorId, command, now: at, outcome, errorCode, randomKeys: this.random.recorded.slice(randomStart).map(r => r.event_key) };
    const fields = this.log.record(before, this.room, context, captured.events);
    const attempt = { ...context, before, after: structuredClone(this.room), sourceEvents: captured.events, fields };
    this.attempts.push(attempt);
    return attempt;
  }

  execute(action: any) {
    const state = this.room.game!.state;
    assert.equal(state.turn, action.side);
    if (action.kind === "shuffle_choice") assert.equal(state.pendingShuffle?.window, action.window);
    if (action.kind === "ordinary_move") {
      const piece = state.pieces.find(p => p.id === action.piece_id)!;
      assert(piece);
      assert.deepEqual([piece.x, piece.y], action.from_xy);
      assert(!state.pieces.some(p => p.x === action.horse_leg_xy[0] && p.y === action.horse_leg_xy[1]), "Horse leg occupied");
    }
    const attempt = this.submit(this.commandFor(action), this.room.game!.players[action.side]);
    if (action.kind === "insight_attempt") {
      assert.equal(attempt.outcome, action.expected_commit ? "committed" : "rejected");
      assert.equal(attempt.errorCode, action.expected_error_code_from_pinned_source);
    } else assert.equal(attempt.outcome, "committed");
    if (action.kind === "ordinary_move") {
      const piece = this.room.game!.state.pieces.find(p => p.id === action.piece_id)!;
      assert(!piece.faceDown);
      assert.deepEqual({ color: piece.color, type: piece.type }, action.expected_revealed_identity);
      assert.equal(this.room.game!.state.captured.length, 0);
    }
    if (action.kind === "shuffle_choice" && action.choice === "wash") assert.deepEqual(this.room.game!.secret.identities, resetLayout.authoritative_private_identities);
    assert.equal(this.room.game!.state.status, "playing", "Controlled prefix unexpectedly reached a terminal state");
    return attempt;
  }

  run(fixture: any) {
    for (const action of [...fixture.prefix, ...fixture.actions]) this.execute(action);
    this.random.verifyReplayComplete();
    if (this.observerEnabled) verifyFixture(fixture, this);
    return this;
  }
}

export function verifyFixture(fixture: any, runner: FixtureRunner) {
  const state = runner.room.game!.state, secret = runner.room.game!.secret;
  const expected = fixture.expected;
  const pupil = state.heroRuntime!.red!.pupil, n = state.heroRuntime!.red!.insightCount;
  const last = runner.attempts.at(-1)!;
  const mark = Boolean(state.effectsByPieceId?.["covered-10"]?.insightMark);
  const observation = secret.insights?.red?.at(-1);
  const checks: Record<string, () => void> = {
    JF01: () => { assert.equal(pupil, 0); assert.equal(n, 0); assert.equal(observation, undefined); },
    JF02: () => { const reset = last.sourceEvents.find(e => e.kind === "shuffle_reset")!; assert.equal(reset.state.heroRuntime!.red!.pupil, 0); assert.equal(pupil, 6); assert.equal(n, 0); assert.equal(state.formalTurns!.black, 1); assert.equal(state.turnLifecycle!.number, 2); assert.equal(state.heroRuntime!.black!.used, true); assert.equal(state.pendingShuffle, undefined); assert.equal(last.fields.H14_resources.periodic_grant.value, 6); },
    JF03: () => { assert.equal(pupil, 2); assert.equal(n, 1); assert.equal(mark, false); assert.equal(observation!.valid, false); assert.deepEqual(observation!.identity, expected.private_payload); assert.equal(state.formalTurns!.black, 2); assert.equal(state.turnLifecycle!.side, "red"); assert.equal(state.turnLifecycle!.number, 3); assert.equal(last.fields.H14_resources.periodic_grant.value, 0); for (const key of ["regular_turn_begin_executed", "ordinary_main_action_executed", "regular_turn_end_executed"]) assert.equal(last.fields.H11_B_count_delta[key].value, false); },
    JF04: () => { assert.equal(pupil, 2); assert.equal(n, 1); assert.equal(mark, true); assert.equal(observation!.valid, true); assert.equal(state.turn, "black"); assert.equal(state.formalTurns!.black, 1); assert.equal(state.turnLifecycle!.number, 2); assert.equal(state.heroRuntime!.black!.used, false); },
    JF05: () => { assert.equal(pupil, 6); assert.equal(n, 0); assert.equal(observation, undefined); },
    JF06: () => { assert.equal(last.before.game!.state.heroRuntime!.red!.pupil, 12); assert.equal(pupil, 5); assert.equal(n, 1); assert.equal(mark, false); assert.deepEqual(observation!.identity, expected.private_payload); assert.equal(last.fields.H14_resources.actually_charged_cost.value, 7); assert.equal(state.turnLifecycle!.phase, "before_main"); },
    JF07: () => { assert.equal(pupil, 5); assert.equal(n, 1); assert.equal(secret.insights!.red!.length, 1); },
    JF08: () => { assert.equal(pupil, 6); assert.equal(n, 0); assert.equal(observation, undefined); const target = state.pieces.find(p => p.id === "covered-16")!; assert.equal(target.faceDown, false); assert.deepEqual([target.x, target.y], [2, 7]); },
    JF09: () => { assert.equal(pupil, 5); assert.equal(n, 1); assert.equal(state.turnLifecycle!.number, 5); assert.equal(4 + 4 * n!, 8); assert.equal(7 + 6 * n!, 13); assert.equal(last.fields.H14_resources.periodic_grant.value, 0); },
  };
  checks[fixture.id]();
  assert.equal(state.status, "playing");
  assert.equal(state.winner, undefined);
  if (last.outcome === "rejected") assert.deepEqual(last.after, last.before);
  if (fixture.id.startsWith("JF") && fixture.id !== "JF02" && fixture.id !== "JF03" && fixture.id !== "JF04") assert.equal(state.turnLifecycle!.phase, "before_main");
}
