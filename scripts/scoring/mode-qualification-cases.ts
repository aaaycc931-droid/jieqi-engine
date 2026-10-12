import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { PolicySession, MODE_BRIDGE_VERSION, type ModeQualificationPlan, type WorldMask, type RpsStratum } from "./policy-session.ts";
import { halfChaosFixtureRandom } from "./mode-fixture-loader.ts";
import { decideIsolated } from "./policy-process.ts";
import { createRemoteRoom } from "../../src/remote-room.ts";
import { GAME_MODES } from "../../src/modes.ts";
import { withResearchSources } from "../../src/research-source-context.ts";
import { initializeFeatureGameState } from "../../src/game.ts";
import { createInitialGame, countPoolByColorAndType } from "../../src/setup.ts";
import { isGeneralInCheck } from "../../src/rules.ts";
import { digest } from "./policy-archive.ts";
import type { Intent } from "./policy-observation.ts";

const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/mode-bridge/${name}`, import.meta.url), "utf8"));
const standardPrefix = load("STD_FX02_LEGAL_PREFIX.json");
const heroPrefixes = load("STD_H01_H02_H11_SCOPED_PREFIXES.json");
const worlds = load("HC_N01_AUTHORITY_PERMUTATION_WITNESSES.json").authority_worlds;
const hcPrefix = load("HC_N01_LEGAL_PREFIXES.json").prefix_steps;
const inventory = { rook: 2, horse: 2, elephant: 2, advisor: 2, cannon: 2, pawn: 5 };
const clone = <T>(v: T): T => structuredClone(v);
const square = (v: any) => Array.isArray(v) ? { x: v[0], y: v[1] } : v;
const normalizedBoard = (pieces: any[]) => pieces.map(({ color, type, x, y, faceDown }) => ({ color, type, x, y, faceDown })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
function actualMove(s: PolicySession, from: any, to: any, extras: any = {}) {
  from = square(from); to = square(to);
  const p = s.room.game!.state.pieces.find(p => p.x === from.x && p.y === from.y)!;
  assert(p, "fixture must bind an actual runtime piece");
  const actor = s.room.game!.players[s.room.game!.state.turn];
  return s.submit(actor, { kind: "move", pieceId: p.id, from, to, ...extras });
}
function replay(s: PolicySession, steps: any[]) {
  const receipts = steps.map(step => { const r = actualMove(s, step.from, step.to); assert.equal(r.outcome, "committed", JSON.stringify(r)); assert.equal(s.room.game!.state.status, "playing"); assert(!isGeneralInCheck(s.room.game!.state, "red")); assert(!isGeneralInCheck(s.room.game!.state, "black")); return r; });
  return receipts;
}
function callbackCounts(s: PolicySession, side: string, number: number) {
  const events = s.journal.flatMap(row => row.source_events ?? []);
  return Object.fromEntries(["formal_turn_begin", "formal_main_action", "formal_turn_end"].map(kind => [kind, events.filter(e => e.kind === kind && e.details.side === side && e.details.number === number).length]));
}
function sidePool(s: PolicySession) {
  const secret = s.room.game!.secret;
  for (const p of s.room.game!.state.pieces.filter(p => p.faceDown)) assert.equal(secret.identities[p.id].color, p.y >= 5 ? "red" : "black");
  assert.deepEqual(countPoolByColorAndType(Object.values(secret.identities)), { red: inventory, black: inventory });
}
export interface CaseContext { sessions: PolicySession[] }
function make(ctx: CaseContext, mode: "xiangqi" | "half_chaos", options: { mask?: WorldMask; stratum?: RpsStratum; sources?: ModeQualificationPlan["sources"]; traps?: ModeQualificationPlan["traps"]; world?: string; observer?: boolean; ruleSeed?: string } = {}) {
  const world = options.world ? worlds.find((w: any) => w.world_id === options.world) : undefined;
  const session = new PolicySession({ ruleSeed: options.ruleSeed ?? "mode-bridge-fixed-diagnostic", policySeed: "mode-bridge-policy-separate", mask: options.mask ?? "00", stratum: options.stratum ?? "A_initial_red",
    ...(world ? { initialRandom: halfChaosFixtureRandom(world) } : {}), observer: options.observer,
    modeQualification: { mode, sources: options.sources ?? (mode === "xiangqi" ? { A: "hunter", B: "hunter" } : { A: "shuffler", B: "shuffler" }), traps: options.traps } });
  ctx.sessions.push(session); return session;
}
function assertSamePolicy(l: PolicySession, r: PolicySession, actor: string) {
  const a = l.input(actor), b = r.input(actor);
  assert.deepEqual(a, b);
  const bytes = [0,0,4,7], memory = { decisions: 2, known_then: [], current_constraints: [] };
  const da = decideIsolated(a, memory, bytes), db = decideIsolated(b, memory, bytes);
  assert.deepEqual(da, db);
  return { player_input_hash: digest(JSON.stringify(a)), command_catalog_hash: digest(JSON.stringify(a.command_catalog)), policy_output_hash: digest(JSON.stringify(da)), delivery_count: a.visible_history.length, decision_usage: da.decisionUsage };
}
function standardH11(ctx: CaseContext) { return make(ctx, "xiangqi", { mask: "01", sources: { A: "shuffler", B: "shuffler" }, stratum: "A_initial_black" }); }
function halfH11(ctx: CaseContext, observer = true) { return make(ctx, "half_chaos", { mask: "01", sources: { A: "shuffler", B: "shuffler" }, stratum: "A_initial_black", world: "P", observer }); }
const wash = (s: PolicySession, skip = false, options: any = {}) => s.submit(s.room.game!.players.black, { kind: "shuffle", skip }, options);

export const MODE_QUALIFICATION_CASES: Array<{ id: string; run: (ctx: CaseContext) => unknown }> = [
  { id: "STD-FX-01-fixed-opening", run(ctx) {
    const a = make(ctx, "xiangqi"), b = make(ctx, "xiangqi", { ruleSeed: "another-layout-seed" });
    const expected = load("STD_FX01_STANDARD_OPENING.json").public_board_state;
    assert.deepEqual(normalizedBoard(a.room.game!.state.pieces), normalizedBoard(expected));
    assert.deepEqual(a.room.game!.state.pieces, b.room.game!.state.pieces);
    assert.deepEqual(a.room.game!.secret.identities, {}); assert.equal(a.random.audit.length, 0);
    assert(!JSON.stringify(a.input("A")).includes('"identities"'));
    return { pieces: 32, face_down: 0, random_draws: 0, initialization: "room_selection_RPS_intro_clock", mode: a.mode };
  } },
  { id: "STD-FX-02-eight-plies-and-isolated-probes", run(ctx) {
    const s = make(ctx, "xiangqi"); replay(s, standardPrefix.prefix);
    assert.deepEqual(normalizedBoard(s.room.game!.state.pieces), normalizedBoard(standardPrefix.end_public_board));
    assert.deepEqual(s.room.game!.state.formalTurns, { red: 4, black: 4 });
    const probes = standardPrefix.probes.map((probe: any) => {
      const p = make(ctx, "xiangqi"); replay(p, standardPrefix.prefix);
      const before = clone(p.room.game), actor = p.room.game!.players[probe.actor_side];
      const piece = p.room.game!.state.pieces.find(x => x.x === probe.from.x && x.y === probe.from.y)!;
      const receipt = p.submit(actor, { kind: "move", pieceId: piece.id, from: probe.from, to: probe.to });
      assert.equal(receipt.outcome === "committed", probe.expected_accept);
      if (!probe.expected_accept) assert.deepEqual(p.room.game, before);
      return { id: probe.id, accepted: receipt.outcome === "committed", actual_code: receipt.code };
    });
    return { plies: 8, probes, snapshot_isolation: "independent_full_lifecycle_replays", counts: s.room.game!.state.formalTurns };
  } },
  { id: "STD-NI-01-private-traps-process-noninterference", run(ctx) {
    const l = make(ctx, "xiangqi", { mask: "01", traps: { B: [{x:4,y:4},{x:5,y:4}] } });
    const r = make(ctx, "xiangqi", { mask: "01", traps: { B: [{x:3,y:4},{x:5,y:4}] } });
    assert.notDeepEqual(l.input("B").projection.own_traps, r.input("B").projection.own_traps);
    const initial = assertSamePolicy(l, r, "A");
    for (const s of [l,r]) replay(s, heroPrefixes.H01.steps.slice(0,2));
    const beforeEntry = assertSamePolicy(l, r, "A");
    for (const s of [l,r]) assert.equal(actualMove(s, [4,5], [4,4]).outcome, "committed");
    assert.notDeepEqual(l.input("A").projection, r.input("A").projection);
    return { initial, before_entry: beforeEntry, divergence_only_after_authorized_trigger: true };
  } },
  { id: "STD-FX-03-H01-one-layer-canonical-death", run(ctx) {
    const s = make(ctx, "xiangqi", { mask: "01", traps: { B: [{x:4,y:4},{x:4,y:4}] } });
    const pawn = s.room.game!.state.pieces.find(p => p.x === 4 && p.y === 6)!.id;
    replay(s, heroPrefixes.H01.steps);
    assert(!s.room.game!.state.pieces.some(p => p.id === pawn));
    const death = s.room.game!.state.captured.find(p => p.id === pawn)!;
    assert.equal(death.cause, "trap_ambush"); assert.equal(s.room.featureSecret!.traps.length, 1);
    assert.equal(s.room.lastTrapTrigger!.victimPieceId, pawn);
    assert.equal(s.room.game!.state.formalTurns!.red, 2);
    return { death_cause: death.cause, remaining_layers: 1, victim_id: pawn, owner_private: true };
  } },
  { id: "STD-FX-05-H01-twelfth-enemy-turn-expiry", run(ctx) {
    const s = make(ctx, "xiangqi", { mask: "01", traps: { B: [{x:4,y:4},{x:5,y:4}] } });
    for (let n = 1; n <= 12; n++) {
      assert.equal(s.room.featureSecret!.traps.length, 2);
      assert.equal(actualMove(s, n%2 ? [3,9] : [4,8], n%2 ? [4,8] : [3,9]).outcome, "committed");
      assert.equal(s.room.featureSecret!.traps.length, n === 12 ? 0 : 2);
      if (n < 12) assert.equal(actualMove(s, n%2 ? [3,0] : [4,1], n%2 ? [4,1] : [3,0]).outcome, "committed");
    }
    return { covered_enemy_formal_turns: 12, expiry: "after_red_12_end" };
  } },
  { id: "STD-FX-06-H02-activation-delayed-strike", run(ctx) {
    const s = make(ctx, "xiangqi", { mask: "10", sources: { A: "rogue", B: "hunter" } });
    const cannon = s.room.game!.state.pieces.find(p => p.x === 1 && p.y === 7)!.id;
    const activate: Intent = { kind: "assassination", pieceId: cannon, from: {x:1,y:7}, to: {x:4,y:7}, source: "hero", useStrongStrike: false };
    assert(s.input("A").command_catalog.some(i => isDeepStrictEqual(i, activate)));
    assert.equal(s.submit("A", { ...activate, useStrongStrike: true }).outcome, "rejected");
    assert.equal(s.submit("A", activate).outcome, "committed");
    assert.equal(s.room.game!.state.assassination!.red.heroChargeAvailable, false);
    assert.equal(s.room.game!.state.effectsByPieceId![cannon].stealth!.remainingOwnerTurns, 2);
    assert.equal(actualMove(s, [0,3], [0,4]).outcome, "committed");
    const before = clone(s.room.game);
    assert.equal(s.submit("A", { kind: "assassination", pieceId: cannon, from: {x:4,y:7}, to: {x:4,y:0}, useStrongStrike: true }).code, "ILLEGAL_TARGET");
    assert.deepEqual(s.room.game, before);
    assert.equal(s.submit("A", { kind: "assassination", pieceId: cannon, from: {x:4,y:7}, to: {x:4,y:3}, useStrongStrike: true }).outcome, "committed");
    assert(!s.room.game!.state.effectsByPieceId?.[cannon]?.stealth);
    assert(s.room.game!.state.captured.some(p => p.color === "black" && p.type === "pawn"));
    return { source_once_spent: true, activation_not_enhanced: true, general_target_rejected: true, eligible_window: "red_formal_2", strike_committed: true };
  } },
  { id: "STD-H02-two-future-formal-windows", run(ctx) {
    const s = make(ctx, "xiangqi", { mask: "10", sources: { A: "rogue", B: "hunter" } });
    const id = s.room.game!.state.pieces.find(p => p.x === 1 && p.y === 7)!.id;
    assert.equal(s.submit("A", { kind: "assassination", pieceId: id, from: {x:1,y:7}, to: {x:4,y:7}, source: "hero", useStrongStrike: false }).outcome, "committed");
    assert.equal(actualMove(s,[0,3],[0,4]).outcome,"committed");
    assert.equal(actualMove(s,[4,9],[4,8]).outcome,"committed");
    assert.equal(s.room.game!.state.effectsByPieceId![id].stealth!.remainingOwnerTurns,1);
    assert.equal(actualMove(s,[2,3],[2,4]).outcome,"committed");
    assert.equal(actualMove(s,[4,8],[4,9]).outcome,"committed");
    assert(!s.room.game!.state.effectsByPieceId?.[id]?.stealth);
    return { activation_turn_excluded: true, expiry: "red_formal_3_end" };
  } },
  { id: "STD-FX-09-H11-A-restores-both-captures", run(ctx) {
    const s = standardH11(ctx), opening = clone(s.room.game!.state.pieces);
    replay(s, heroPrefixes.H11_A.steps); assert.equal(s.room.game!.state.pieces.length,30);
    assert.equal(s.room.game!.state.pendingShuffle!.window,"A");
    const at = s.now, before = clone(s.room.game!.state.formalTurns), draws = s.random.audit.length;
    assert.equal(wash(s).outcome,"committed");
    assert.deepEqual(s.room.game!.state.pieces,opening); assert.deepEqual(s.room.game!.secret.identities,{});
    assert.equal(s.room.game!.state.captured.length,0); assert.deepEqual(s.room.game!.state.formalTurns,before);
    assert.equal(s.random.audit.length,draws); assert.equal(s.room.game!.state.turn,"red"); assert(s.now > at);
    assert.equal(s.input("A").mapping_epoch,1); assert(s.room.game!.state.heroRuntime!.black!.used);
    return { restored_count:32, restored_initial_deaths:2, random_draw_delta:0, time_rewound:false, counts:before, mapping_epoch:1 };
  } },
  { id: "STD-FX-10-H11-B-count-and-callback-separation", run(ctx) {
    const s = standardH11(ctx); replay(s,heroPrefixes.H11_B.steps.slice(0,2)); assert.equal(wash(s,true).outcome,"committed");
    replay(s,heroPrefixes.H11_B.steps.slice(2)); assert.equal(s.room.game!.state.pendingShuffle!.window,"B");
    const before = clone(s.room.game!.state.formalTurns), at=s.now;
    const actionId="std-B-once", rev=s.room.game!.state.revision;
    assert.equal(wash(s,false,{actionId,expectedRevision:rev}).outcome,"committed");
    assert.deepEqual(s.room.game!.state.formalTurns,{red:2,black:2});
    assert.deepEqual(callbackCounts(s,"black",2),{formal_turn_begin:0,formal_main_action:0,formal_turn_end:0});
    const snapshot=clone(s.room.game), draws=s.random.audit.length;
    assert.equal(wash(s,false,{actionId,expectedRevision:rev}).outcome,"duplicate");
    assert.deepEqual(s.room.game,snapshot); assert.equal(s.random.audit.length,draws);
    return { formal_before:before,formal_after:s.room.game!.state.formalTurns, black_2_callbacks:callbackCounts(s,"black",2), receipt_clock_delta:s.now-at, exact_retry_no_effect:true };
  } },
  { id: "HC-F01-F02-legal-initial-worlds-and-first-reveal", run(ctx) {
    const results=worlds.map((w:any)=>{
      const s=make(ctx,"half_chaos",{world:w.world_id}); sidePool(s);
      for(const p of s.room.game!.state.pieces.filter(p=>p.faceDown)) assert.equal(s.room.game!.secret.identities[p.id].type,w.true_type_by_stable_piece_id[p.id]);
      const receipts=replay(s,hcPrefix); assert.equal(s.room.game!.state.turn,"black");
      return { world:w.world_id,receipt_count:receipts.length,formal_counts:s.room.game!.state.formalTurns,first_reveal:s.journal.find(r=>r.kind==="attempt")!.after.game.state.lastMove.revealed };
    }); return { worlds:results, identity_injection:"none_Fisher_Yates_witness_through_real_setup" };
  } },
  { id: "HC-NI-real-process-matched-history", run(ctx) {
    const p=make(ctx,"half_chaos",{world:"P"}),q=make(ctx,"half_chaos",{world:"Q"}),r=make(ctx,"half_chaos",{world:"R"});
    const pq=assertSamePolicy(p,q,"A"),pr=assertSamePolicy(p,r,"A");
    for(const s of [p,q,r]) replay(s,hcPrefix.slice(0,1));
    const beforeBlackReveal=assertSamePolicy(p,q,"B"); assert.notDeepEqual(p.input("B"),r.input("B"));
    for(const s of [p,q]) replay(s,hcPrefix.slice(1,2));
    assert.notDeepEqual(p.input("A"),q.input("A"));
    const poisoned={...p.input("A"), hidden_type:"CANARY"};
    assert.throws(()=>decideIsolated(poisoned as any,{},[0,0,4,7]),/unqualified_policy_input/);
    return { initial_PQ:pq,initial_PR:pr,red_reveal_then_black_input:beforeBlackReveal,authorized_reveal_can_diverge:true,authority_extra_field_rejected:true };
  } },
  { id: "HC-F03-H11-A-per-side-redeal", run(ctx) {
    const s=halfH11(ctx); replay(s,hcPrefix.slice(0,2)); assert.equal(s.room.game!.state.pendingShuffle!.window,"A");
    const before=clone(s.room.game!.state.formalTurns),draws=s.random.audit.length;
    assert.equal(wash(s).outcome,"committed"); sidePool(s);
    assert.equal(s.room.game!.state.pieces.filter(p=>p.faceDown).length,30); assert.equal(s.room.game!.state.turn,"red");
    assert.deepEqual(s.room.game!.state.formalTurns,before); assert.equal(s.input("A").mapping_epoch,1);
    const newDraws=s.random.audit.slice(draws); assert.deepEqual(newDraws.map(d=>d.max_exclusive),[...Array.from({length:14},(_,i)=>15-i),...Array.from({length:14},(_,i)=>15-i)]);
    return { covered_each_original_side:15,side_pools_preserved:true,shuffle_draws:28,formal_before:before,formal_after:s.room.game!.state.formalTurns,mapping_epoch:1 };
  } },
  { id: "HC-F04-H11-B-confirmed-count-and-clock", run(ctx) {
    const s=halfH11(ctx); replay(s,hcPrefix.slice(0,2)); assert.equal(wash(s,true).outcome,"committed"); replay(s,hcPrefix.slice(2));
    assert.equal(s.room.game!.state.pendingShuffle!.window,"B"); const before=clone(s.room.game!.state.formalTurns),at=s.now;
    const decisionStart=s.room.game!.state.turnStartedAt!,decisionDeadline=s.room.game!.state.turnDeadlineAt!;
    assert.equal(before!.black,1);assert.equal(decisionStart,at);assert.equal(decisionDeadline-decisionStart,60_000);
    assert.deepEqual(callbackCounts(s,"black",2),{formal_turn_begin:0,formal_main_action:0,formal_turn_end:0});
    assert.equal(wash(s,false,{at:at+1700}).outcome,"committed"); sidePool(s);
    assert.deepEqual(callbackCounts(s,"black",2),{formal_turn_begin:0,formal_main_action:0,formal_turn_end:0});
    assert.equal(s.room.game!.state.turn,"red"); assert.equal(s.input("A").mapping_epoch,1);
    assert.deepEqual(s.room.game!.state.formalTurns,{red:2,black:2});
    assert.equal(s.room.game!.state.turnStartedAt,at+1700);assert.equal(s.room.game!.state.turnDeadlineAt,at+1700+60_000);
    assert.deepEqual(s.room.game!.state.formalClock,{side:"red",number:3});
    const silent=halfH11(ctx,false);replay(silent,hcPrefix.slice(0,2));wash(silent,true);replay(silent,hcPrefix.slice(2));
    wash(silent,false,{at:at+1700});assert.deepEqual(silent.room,s.room);assert.deepEqual(silent.random.audit,s.random.audit);
    return { qualification:"scoped_count_and_clock",confirmation:"CONF-HC-H11-B-20261012",expected_formal_counter_delta:1,observed_formal_before:before,observed_formal_after:s.room.game!.state.formalTurns,black_2_callbacks:callbackCounts(s,"black",2),decision_clock_start:decisionStart,decision_clock_deadline:decisionDeadline,red_clock_start:s.room.game!.state.turnStartedAt,red_clock_deadline:s.room.game!.state.turnDeadlineAt,receipt_clock_delta:s.now-at,receipt_delta_is_fixture_input_not_rule_constant:true,numeric_rule_accepted:true,observer_passivity:true,full_match_qualified:false };
  } },
  { id: "HC-F04-H11-B-skip-preserves-remaining-clock", run(ctx) {
    const s=halfH11(ctx);replay(s,hcPrefix.slice(0,2));assert.equal(wash(s,true).outcome,"committed");replay(s,hcPrefix.slice(2));
    const start=s.room.game!.state.turnStartedAt!,deadline=s.room.game!.state.turnDeadlineAt!;
    s.tick(start+2100);assert.equal(s.room.game!.state.turnDeadlineAt,deadline);
    assert.deepEqual(callbackCounts(s,"black",2),{formal_turn_begin:0,formal_main_action:0,formal_turn_end:0});
    assert.equal(wash(s,true,{at:start+3500}).outcome,"committed");
    assert.equal(s.room.game!.state.turnStartedAt,start);assert.equal(s.room.game!.state.turnDeadlineAt,deadline);
    assert.equal(s.room.game!.state.pendingShuffle,undefined);assert.equal(s.room.game!.state.formalTurns!.black,1);
    assert.deepEqual(callbackCounts(s,"black",2),{formal_turn_begin:1,formal_main_action:0,formal_turn_end:0});
    assert.equal(actualMove(s,[0,4],[0,5]).outcome,"committed");assert.equal(s.room.game!.state.formalTurns!.black,2);
    assert.deepEqual(callbackCounts(s,"black",2),{formal_turn_begin:1,formal_main_action:1,formal_turn_end:1});
    return { shared_deadline:deadline,decision_elapsed_ms:3500,remaining_after_skip_ms:deadline-(start+3500),skip_does_not_complete_black_turn:true,ordinary_action_completes_black_turn:true };
  } },
  { id: "HC-F04-H11-B-deadline-and-late-action", run(ctx) {
    const rows=[];
    for(const lateAction of [false,true]){
      const s=halfH11(ctx);replay(s,hcPrefix.slice(0,2));wash(s,true);replay(s,hcPrefix.slice(2));
      const deadline=s.room.game!.state.turnDeadlineAt!;s.tick(deadline-1);assert.equal(s.room.phase,"playing");
      if(lateAction){assert.equal(wash(s,false,{at:deadline}).outcome,"not_committed");assert.equal(s.room.game!.state.heroRuntime!.black!.used,false);}
      else s.tick(deadline);
      assert.equal(s.room.phase,"finished");assert.equal(s.room.game!.state.reason,"timeout");assert.equal(s.room.game!.state.winner,"red");
      assert.equal(s.room.game!.state.formalTurns!.black,1);assert.deepEqual(callbackCounts(s,"black",2),{formal_turn_begin:0,formal_main_action:0,formal_turn_end:0});
      rows.push({late_action:lateAction,deadline,timeout_side:"black",wash_committed:false});
    }
    return { deadline_exclusive_for_action:true,rows };
  } },
  { id: "HC-F04-H11-B-rejection-and-retry-keep-clock", run(ctx) {
    const s=halfH11(ctx);replay(s,hcPrefix.slice(0,2));wash(s,true);replay(s,hcPrefix.slice(2));
    const start=s.room.game!.state.turnStartedAt!,deadline=s.room.game!.state.turnDeadlineAt!;
    assert.equal(wash(s,false,{expectedRevision:s.room.game!.state.revision-1,at:start+800}).code,"STALE_REVISION");
    assert.equal(s.room.game!.state.turnStartedAt,start);assert.equal(s.room.game!.state.turnDeadlineAt,deadline);assert.equal(s.room.game!.state.formalTurns!.black,1);
    const actionId="hc-B-confirmed-once",expectedRevision=s.room.game!.state.revision;
    assert.equal(wash(s,false,{actionId,expectedRevision,at:start+1600}).outcome,"committed");
    const after=clone(s.room.game),draws=s.random.audit.length;
    assert.equal(wash(s,false,{actionId,expectedRevision,at:start+1700}).outcome,"duplicate");
    assert.equal(wash(s,true,{actionId,expectedRevision,at:start+1800}).code,"RESEARCH_ACTION_ID_CONFLICT");
    assert.deepEqual(s.room.game,after);assert.equal(s.random.audit.length,draws);
    return { stale_rejection_preserves_B_deadline:true,exact_retry_preserves_new_red_deadline:true,one_counter_increment:true,conflicting_retry_rejected:true };
  } },
  { id: "HC-F05-dual-death-restoration-subcheck-and-retry", run(ctx) {
    const s=halfH11(ctx),opening=clone(s.room.game!.state.pieces);
    replay(s,heroPrefixes.H11_A.steps);assert.equal(s.room.game!.state.pieces.length,30);
    assert.equal(s.room.game!.state.captured.length,2);
    const actionId="hc-A-once",expectedRevision=s.room.game!.state.revision;
    assert.equal(wash(s,false,{actionId,expectedRevision}).outcome,"committed");
    assert.deepEqual(s.room.game!.state.pieces,opening);sidePool(s);assert.equal(s.room.game!.state.captured.length,0);
    const after=clone(s.room.game),draws=s.random.audit.length;
    assert.equal(wash(s,false,{actionId,expectedRevision}).outcome,"duplicate");
    assert.equal(wash(s,true,{actionId,expectedRevision}).code,"RESEARCH_ACTION_ID_CONFLICT");
    assert.deepEqual(s.room.game,after);assert.equal(s.random.audit.length,draws);
    const invalid=clone(worlds[0]);invalid.all_initial_pieces_original_side["covered-00"]="red";
    assert.throws(()=>halfChaosFixtureRandom(invalid),/original_side_mismatch/);
    return { restored_initial_deaths:2,restored_count:32,original_side_preserved:true,exact_retry_no_effect:true,conflicting_retry_rejected:true,malformed_fixture_rejected:true,ground_effects_subcheck:"blocked_source_not_in_scope",whole_HC_F05_qualified:false };
  } },
  { id: "MODE-four-source-worlds-pre-RPS-strata", run(ctx) {
    const rows=[];
    for(const mode of ["xiangqi","half_chaos"] as const) for(const mask of ["00","10","01","11"] as const) for(const stratum of ["A_initial_red","A_initial_black"] as const) {
      const s=make(ctx,mode,{mask,stratum,sources:{A:"shuffler",B:"shuffler"}});
      const initialRed=stratum==="A_initial_red"?"A":"B",swapped=mask==="10"||mask==="01";
      assert.equal(s.room.game!.players.red,swapped?(initialRed==="A"?"B":"A"):initialRed);
      assert.equal(s.room.game!.secret.shuffleOpening!==undefined,mask!=="00");
      for(const actor of ["A","B"] as const) {
        const side=s.input(actor).projection.viewer_side!;
        assert.equal(s.room.game!.state.featureRules!.heroes![side]==="shuffler",mask[actor==="A"?0:1]==="1");
      }
      rows.push({mode,mask,stratum,final_red:s.room.game!.players.red});
    } return { related_setup_worlds:rows,independent_empirical_n:0 };
  } },
  { id: "MODE-product-gates-room-source-mutation-protection", run() {
    for(const mode of ["xiangqi","half_chaos"] as const) {
      assert.equal(GAME_MODES[mode].featuresReady,false);
      assert.throws(()=>createRemoteRoom("plain","A","token",0,{baseMode:mode,heroesEnabled:true}),(e:any)=>e.code==="MODE_ADAPTATION_PENDING");
      const wire:any={baseMode:mode,heroesEnabled:true,researchMask:"11",researchMode:true,featuresReady:true};
      assert.throws(()=>createRemoteRoom("plain","A","token",0,wire),(e:any)=>e.code==="MODE_ADAPTATION_PENDING");
    }
    const context:any={roomId:"scoped",mode:"xiangqi",actors:{A:{hero:"hunter",enabled:true},B:{hero:"rogue",enabled:false}}};
    withResearchSources(context,()=>{
      assert.throws(()=>createRemoteRoom("foreign","A","token",0,{baseMode:"xiangqi",heroesEnabled:true}),(e:any)=>e.code==="MODE_ADAPTATION_PENDING");
      assert.throws(()=>createRemoteRoom("scoped","A","token",0,{baseMode:"xiangqi",heroesEnabled:true,mutationsEnabled:true}),(e:any)=>e.code==="RESEARCH_SCOPE_INVALID");
      const initial=createInitialGame(undefined,"xiangqi");
      for(const hero of ["warrior","wind","sky_admiral","rogue"] as const) assert.throws(()=>initializeFeatureGameState(initial.state,{red:hero}),(e:any)=>e.code==="MODE_ADAPTATION_PENDING");
      assert.throws(()=>initializeFeatureGameState(initial.state,{red:"hunter"},"chaos"),(e:any)=>e.code==="MODE_ADAPTATION_PENDING");
    });
    assert.throws(()=>withResearchSources({...context,mode:"half_chaos"},()=>{}),(e:any)=>e.code==="RESEARCH_SCOPE_INVALID");
    assert.throws(()=>withResearchSources(context,()=>Promise.resolve()),/synchronous/);
    return { featuresReady:false,client_flag_capability:false,unqualified_sources_blocked:true,mutation_M07_blocked:true };
  } },
  { id: "MODE-H11-red-ineligible-used-and-declined-windows", run(ctx) {
    for(const mode of ["xiangqi","half_chaos"] as const) {
      const options={mask:"01" as const,stratum:"A_initial_red" as const,sources:{A:"shuffler" as const,B:"shuffler" as const},...(mode==="half_chaos"?{world:"P"}:{})};
      const redSource=make(ctx,mode,options);
      assert.equal(redSource.room.game!.players.red,"B");
      assert.equal(wash(redSource).code,"RESEARCH_SOURCE_DISABLED");
      const s=mode==="xiangqi"?standardH11(ctx):halfH11(ctx);
      const steps=mode==="xiangqi"?heroPrefixes.H11_B.steps:hcPrefix;
      replay(s,steps.slice(0,2));assert.equal(wash(s,true).outcome,"committed");replay(s,steps.slice(2));assert.equal(wash(s,true).outcome,"committed");
      const before=clone(s.room.game),draws=s.random.audit.length;
      assert.equal(wash(s).outcome,"rejected");assert.deepEqual(s.room.game,before);assert.equal(s.random.audit.length,draws);
      assert(s.room.game!.state.heroRuntime!.black!.shuffleLost);
    } return { final_red_source_cannot_wash:true,A_and_B_decline_loses_opportunity:true };
  } },
  { id: "MODE-actual-terminal-clock-and-censor-gate", run(ctx) {
    for(const mode of ["xiangqi","half_chaos"] as const) {
      const censored=make(ctx,mode);assert.equal(censored.classify().status,"censored");assert.equal(censored.classify().result,null);
      const timeout=make(ctx,mode);timeout.tick(timeout.room.game!.state.turnDeadlineAt!);assert.equal(timeout.classify().status,"legal_terminal");assert.equal(timeout.room.game!.state.reason,"timeout");
      const resigned=make(ctx,mode);assert.equal(resigned.submit("A",{kind:"resign"}).outcome,"committed");assert.equal(resigned.classify().status,"legal_terminal");assert.equal((resigned.classify() as any).winner_actor,"B");
    } return { natural_timeout_and_resign:true,nonterminal_cap_never_draw:true,unconfirmed_repetition_draw:"blocked_not_qualified",formal_scores:null,complete_match_qualification:false };
  } },
  { id: "MODE-observer-passivity-and-short-P0-flow", run(ctx) {
    for(const mode of ["xiangqi","half_chaos"] as const) {
      const active=make(ctx,mode),silent=make(ctx,mode,{observer:false});
      assert.deepEqual(active.runP0(3),silent.runP0(3));assert.deepEqual(active.room,silent.room);assert.deepEqual(active.random.audit,silent.random.audit);
      assert.equal(active.classify().result,null);
    } return { observed_and_silent_same_authority:true,short_flow_only:true,strength_qualification:false };
  } },
];

export function modeQualificationMetadata() {
  return { schema:"lezi.mode_bridge_qualification.v0.3",interface_version:MODE_BRIDGE_VERSION,rule_delta:1, confirmation:"CONF-HC-H11-B-20261012",qualification_environment:"trusted_room_bound_source_allowlist_not_product_release",product_featuresReady:{xiangqi:false,half_chaos:false},formal_scoring_status:"frozen",q:null,H:null,I:null,B:null,J:null,independent_empirical_n:0,
    blocked:["H03_candidate","H11_x_H15","M07_and_pre_refresh_secret_read","unconfirmed_repetition_draw_rules","P1","full_match_qualification","population_sampling"],
    scope:{xiangqi:["baseline","H01","H02","H11_A","H11_B"],half_chaos:["baseline","H11_A","H11_B_scoped_count_and_clock"]},
  };
}
