import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_HERO_IDS, EXPERIMENTAL_HERO_IDS, HERO_IDS, applyAuthoritativeMove, applyHeroAbility,
  advanceToFormalTurn, getCenYingPullOptions, getHeroPackage, getLegalMoves, hasAnyLegalMove,
  initializeFeatureGameState, initializeFeatureSecret, isGeneralInCheck, isStalemate,
  publicStateSnapshot, putGhostObject, startFormalClock,
} from "../src/index.ts";
import { openDestructionBatches } from "../src/settlement-context.ts";
import { captureMechanismEvents } from "../src/mechanism-observer.ts";
import type { GameState, HeroAbilityCommand, HeroId, MutationId, PublicPiece, SecretState, Side } from "../src/types.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";

type Pair = { state: GameState; secret: SecretState };
const cmd = (state: GameState, extra: Partial<HeroAbilityCommand> = {}): HeroAbilityCommand => ({
  kind: "hero_ability", ability: "tether_pull", anchorPieceId: "anchor", pieceId: "target",
  actionId: `pull:${state.revision}`, expectedRevision: state.revision, ...extra,
});
function pair(extra: PublicPiece[] = [], opponent: HeroId = "hunter", mutation?: MutationId): Pair {
  return {
    state: initializeFeatureGameState(gameState([
      revealed("anchor", "red", "pawn", 0, 6), revealed("target", "black", "horse", 0, 3), ...extra,
    ]), { red: "cen_ying", black: opponent }, mutation),
    secret: secretState(),
  };
}
function pull(a: Pair, extra: Partial<HeroAbilityCommand> = {}) {
  return applyHeroAbility(a.state, a.secret, cmd(a.state, extra), 1000, () => 0);
}
function rejectsUnchanged(a: Pair, code: string, extra: Partial<HeroAbilityCommand> = {}) {
  const before = structuredClone(a);
  assert.throws(() => pull(a, extra), (e: any) => e.code === code);
  assert.deepEqual(a, before);
}
const at = (state: GameState, id: string) => state.pieces.find(p => p.id === id)!;

test("CY01 explicit package exists while default and remote product pools remain 19", () => {
  assert.equal(HERO_IDS.length, 19); assert.equal(HERO_IDS.includes("cen_ying"), false);
  assert(EXPERIMENTAL_HERO_IDS.includes("cen_ying")); assert(ALL_HERO_IDS.includes("cen_ying"));
  assert.equal(getHeroPackage("cen_ying").name, "岑缨");
  assert.throws(() => getHeroPackage("cen_ying", "inner"), (e: any) => e.code === "HERO_FORM_UNAVAILABLE");
  for (const gameMode of ["xiangqi", "half_chaos"] as const) {
    assert.throws(() => initializeFeatureGameState({ ...gameState(), gameMode }, { red: "cen_ying" }), (e: any) => e.code === "HERO_PILOT_MODE");
  }
});

test("CY02 real authority moves enemy one square, leaves anchor, spends one whole turn and records true endpoints", () => {
  const a = pair(), before = structuredClone(a);
  const r = pull(a);
  assert.deepEqual(a, before);
  assert.deepEqual(at(r.state, "target"), revealed("target", "black", "horse", 0, 4));
  assert.deepEqual(at(r.state, "anchor"), at(a.state, "anchor"));
  assert.equal(r.state.heroRuntime!.red!.tetherPullUses, 1);
  assert.equal(r.state.turn, "black"); assert.equal(r.state.formalTurns!.red, 1);
  assert.equal(r.state.revision, 1); assert.deepEqual(r.state.captured, []);
  assert.equal(r.state.lastMove!.landed, true);
  assert.deepEqual(r.state.lastMove!.from, { x: 0, y: 3 });
  assert.deepEqual(r.state.lastMove!.to, { x: 0, y: 4 });
  assert.equal(r.state.lastMove!.pieceId, "target");
  assert.equal(r.state.lastMove!.tier, 2);
  assert.deepEqual(r.state.lastMove!.keywords, ["占步", "耗费", "移置"]);
  assert.equal(r.state.lastMove!.classification!.source, "hero");
  assert.equal(r.state.lastMove!.classification!.opportunity, "main");
  assert.equal(r.state.pendingHeroChild, undefined);
  assert.deepEqual(r.state.actionRecords!.at(-1)!.from, { x: 0, y: 3 });
  assert.deepEqual(r.state.actionRecords!.at(-1)!.to, { x: 0, y: 4 });
  assert.equal(r.secret.history!.at(-1)!.tier, 2);
});

for (const [anchor, target, destination] of [
  [[0, 6], [0, 4], [0, 5]], [[0, 6], [0, 3], [0, 4]],
  [[2, 6], [0, 6], [1, 6]], [[0, 6], [3, 6], [2, 6]],
] as const) test(`CY03 four directions/range ${anchor.join()}/${target.join()}`, () => {
  const a = pair(); Object.assign(at(a.state, "anchor"), { x: anchor[0], y: anchor[1] });
  Object.assign(at(a.state, "target"), { x: target[0], y: target[1], type: "elephant" });
  const r = pull(a); assert.deepEqual([at(r.state, "target").x, at(r.state, "target").y], destination);
});

test("CY04 black-side mirror has identical geometry, cost and full opponent response", () => {
  const a = pair();
  a.state = initializeFeatureGameState(gameState(a.state.pieces.slice(2).map(p => ({ ...p, x: 8 - p.x, y: 9 - p.y, faceDown: false as const, color: p.id === "anchor" ? "black" as const : "red" as const, type: "horse" })), { turn: "black" }), { red: "hunter", black: "cen_ying" });
  const r = pull(a); assert.equal(at(r.state, "target").y, 5);
  assert.equal(r.state.turn, "red"); assert.equal(r.state.heroRuntime!.black!.tetherPullUses, 1);
  assert.equal(r.state.formalTurns!.black, 1);
});

for (const [x, y] of [[0, 5], [0, 2], [1, 3], [1, 5]]) test(`CY05 invalid near/far/diagonal ${x},${y} is rejected atomically`, () => {
  const a = pair(); Object.assign(at(a.state, "target"), { x, y });
  rejectsUnchanged(a, "INVALID_TETHER_PAIR"); assert.deepEqual(getCenYingPullOptions(a.state), []);
});

for (const role of ["anchor", "target"] as const) for (const disqualifier of ["covered", "general", "air", "river", "intangible", "stealth", "wrong_side"] as const) {
  test(`CY06 ${role}/${disqualifier} direct designation is unavailable and non-consuming`, () => {
    const a = pair(), piece = at(a.state, role);
    if (disqualifier === "covered") {
      a.state.pieces[a.state.pieces.indexOf(piece)] = covered(role, piece.x, piece.y);
      a.secret.identities[role] = { color: role === "anchor" ? "red" : "black", type: "rook" };
    } else if (disqualifier === "general") Object.assign(piece, { type: "general" });
    else if (disqualifier === "air") Object.assign(piece, { layer: "air" });
    else if (disqualifier === "river") Object.assign(piece, { layer: "river", river: { source: "fixture", spaceId: "fixture", cellId: "0" } });
    else if (disqualifier === "intangible") a.state.effectsByPieceId![role] = { intangible: true };
    else if (disqualifier === "stealth") a.state.effectsByPieceId![role] = { stealth: { owner: role === "anchor" ? "red" : "black", remainingOwnerTurns: 2, strongStrikeAvailable: true, source: "hero" } };
    else Object.assign(piece, { color: role === "anchor" ? "black" : "red" });
    rejectsUnchanged(a, "INVALID_TETHER_PAIR");
  });
}

test("CY07 any intermediate ground body blocks, including intangible and covered; air and river do not", () => {
  for (const kind of ["revealed", "covered", "intangible", "air", "river"] as const) {
    const p = kind === "covered" ? covered("blocker", 0, 5) : revealed("blocker", "red", "pawn", 0, 5);
    if (kind === "air") Object.assign(p, { layer: "air" });
    if (kind === "river") Object.assign(p, { layer: "river", river: { source: "fixture", spaceId: "fixture", cellId: "0" } });
    const a = pair([p]);
    if (kind === "covered") a.secret.identities.blocker = { color: "black", type: "cannon" };
    if (kind === "intangible") a.state.effectsByPieceId!.blocker = { intangible: true };
    if (kind === "air" || kind === "river") assert.equal(pull(a).state.heroRuntime!.red!.tetherPullUses, 1);
    else rejectsUnchanged(a, "INVALID_TETHER_PAIR");
  }
});

test("CY08 air at the destination coexists without capture or forced landing", () => {
  const a = pair([{ ...revealed("flyer", "black", "pawn", 0, 4), layer: "air" }]);
  const r = pull(a); assert.equal(r.state.pieces.filter(p => p.x === 0 && p.y === 4).length, 2);
  assert.equal(at(r.state, "flyer").layer, "air"); assert.deepEqual(r.state.captured, []);
});

test("CY09 iron wall uses the pulled enemy's control side and blocks outside-to-opponent-palace entry", () => {
  const a = pair([], "hunter", "iron_wall");
  Object.assign(at(a.state, "anchor"), { x: 4, y: 8 });
  Object.assign(at(a.state, "target"), { x: 4, y: 6 });
  rejectsUnchanged(a, "INVALID_TETHER_PAIR");
  // An already-infiltrated enemy may move within the palace under the shared rule.
  Object.assign(at(a.state, "anchor"), { x: 5, y: 7 });
  Object.assign(at(a.state, "target"), { x: 3, y: 7, type: "elephant" });
  assert.equal(pull(a).state.heroRuntime!.red!.tetherPullUses, 1);
});

test("CY10 no skill while in check and no public self-check from unpinning an enemy blocker", () => {
  const checked = pair([revealed("checker", "black", "rook", 3, 5)]);
  rejectsUnchanged(checked, "IN_CHECK"); assert.deepEqual(getCenYingPullOptions(checked.state), []);
  const a = pair([revealed("rear-rook", "black", "rook", 3, 2)]);
  Object.assign(at(a.state, "anchor"), { x: 0, y: 7 });
  Object.assign(at(a.state, "target"), { x: 3, y: 7, type: "pawn" });
  assert.equal(isGeneralInCheck(a.state, "red"), false);
  rejectsUnchanged(a, "INVALID_TETHER_PAIR"); assert.deepEqual(getCenYingPullOptions(a.state), []);
});

test("CY11 releasing an enemy screen can give check with normal opponent evasion", () => {
  const state = initializeFeatureGameState(gameState([
    revealed("anchor", "red", "pawn", 1, 5), revealed("target", "black", "elephant", 4, 5),
    revealed("line-rook", "red", "rook", 4, 8),
  ], { blackGeneral: { x: 4, y: 0 } }), { red: "cen_ying", black: "hunter" });
  const r = pull({ state, secret: secretState() });
  assert.equal(isGeneralInCheck(r.state, "black"), true);
  assert.equal(r.state.status, "playing"); assert.equal(r.state.turn, "black");
  assert(getLegalMoves(r.state, "black-general").length > 0);
});

test("CY12 enemy can return the pulled rook normally; exactly two uses, no infinite loop", () => {
  let a: Pair = pair(); Object.assign(at(a.state, "target"), { type: "rook" });
  for (let i = 0; i < 2; i++) {
    a = pull(a);
    a = applyAuthoritativeMove(a.state, a.secret, move({ x: 0, y: 4 }, { x: 0, y: 3 }, `return:${i}`, a.state.revision));
    assert.equal(a.state.turn, "red");
  }
  assert.equal(a.state.heroRuntime!.red!.tetherPullUses, 2);
  rejectsUnchanged(a, "SKILL_USED");
});

test("CY13 malformed pair, stale revision and caller-supplied destination never spend", () => {
  for (const extra of [{ anchorPieceId: "missing" }, { pieceId: "missing" }, { anchorPieceId: "target" }, { pieceId: "anchor" }]) rejectsUnchanged(pair(), "INVALID_TETHER_PAIR", extra);
  rejectsUnchanged(pair(), "STALE_REVISION", { expectedRevision: 55 });
  rejectsUnchanged(pair(), "TETHER_DESTINATION_DERIVED", { to: { x: 8, y: 8 } });
});

test("CY14 duplicate after success or stale retry is idempotent and immutable", () => {
  const a = pair(), command = cmd(a.state), r = pull(a), before = structuredClone(r);
  const repeated = applyHeroAbility(r.state, r.secret, command);
  assert.equal(repeated.duplicate, true); assert.deepEqual(repeated.state, r.state); assert.deepEqual(repeated.secret, r.secret);
  assert.deepEqual(r, before);
});

test("CY15 finished, extra-defense, flow and forced-landing windows reject pull", () => {
  const finished = pair(); finished.state.status = "finished"; rejectsUnchanged(finished, "INVALID_PHASE");
  const defense = pair(); defense.state.forcedDefense = { side: "red" } as any; rejectsUnchanged(defense, "INVALID_PHASE");
  const flow = pair(); flow.state.flowDance = { side: "red", pieceId: "red-general", steps: 0, resumeTurn: "black" }; rejectsUnchanged(flow, "INVALID_PHASE");
  const flight = pair([{ ...revealed("flyer", "red", "pawn", 8, 5), layer: "air" }]);
  flight.state.effectsByPieceId!.flyer = { flight: { remainingOwnerTurns: 0, source: "sky_admiral", forcedLanding: true } };
  rejectsUnchanged(flight, "FORCED_LANDING_REQUIRED");
});

test("CY16 already-consumed main window cannot create a second action", () => {
  const a = pair(); a.state.turnLifecycle = { side: "red", number: 1, phase: "main_action", phases: ["turn_start", "before_main", "main_action"], mainActionId: "prior" };
  a.secret.formalStart = { side: "red", number: 1 };
  rejectsUnchanged(a, "INVALID_PRE_MAIN_WINDOW"); assert.deepEqual(getCenYingPullOptions(a.state), []);
});

test("CY17 public query is immutable and reveals no identities, trap coordinates or hidden host", () => {
  const a = pair([covered("hidden", 8, 3)]), before = structuredClone(a.state);
  const publicOptions = getCenYingPullOptions(a.state);
  a.secret.identities.hidden = { color: "red", type: "rook" };
  a.secret.traps = [{ id: "private", owner: "black", position: { x: 7, y: 5 }, opponentTurnsRemaining: 12 }];
  a.secret.trueGenerals = { black: "target" };
  assert.deepEqual(getCenYingPullOptions(a.state), publicOptions);
  const capture = captureMechanismEvents(() => getCenYingPullOptions(a.state));
  assert.deepEqual(capture.events, []); assert.deepEqual(a.state, before);
  assert(!JSON.stringify(publicStateSnapshot(a.state)).includes("private"));
});

test("CY18 hidden Wind host remains eligible as an ordinary-looking non-general", () => {
  const a = pair([], "wind"); a.state.turn = "black";
  const shadow = applyHeroAbility(a.state, a.secret, { kind: "hero_ability", ability: "shadow", pieceId: "target", actionId: "shadow", expectedRevision: 0 }, 0, () => 0);
  shadow.state.turn = "red"; delete shadow.state.turnLifecycle;
  assert(getCenYingPullOptions(shadow.state).some(o => o.pieceId === "target"));
  const r = pull(shadow); assert.equal(r.secret.wind!.black!.hostId, "target");
  assert.equal(at(r.state, "target").y, 4); assert.equal(at(r.state, "target").faceDown, false);
});

test("CY19 synthetic trap compatibility uses the moved enemy controller and commits lethal landing", () => {
  // Injected source-interaction fixture, not a claim that Cen Ying owns hunter traps.
  for (const owner of ["red", "black"] as const) {
    const a = pair(); a.secret.traps = [{ id: "synthetic", owner, position: { x: 0, y: 4 }, opponentTurnsRemaining: 12 }];
    assert.equal(getCenYingPullOptions(a.state).length, 1);
    const r = pull(a); assert.equal(r.state.heroRuntime!.red!.tetherPullUses, 1);
    assert.equal(r.state.pieces.some(p => p.id === "target"), owner === "black");
    if (owner === "red") assert.equal(r.state.captured[0].cause, "trap_ambush");
  }
});

test("CY20 synthetic ghost interaction preserves attachment identity and enters only once before normal end tick", () => {
  const a = pair(); a.state.effectsByPieceId!.target = { barrier: { owner: "black", enemyTurnsRemaining: 3 }, dragonScale: 1 };
  putGhostObject(a.state, { kind: "ghost", source: "fixture", owner: "red", position: { x: 0, y: 4 }, remaining: 3 }, "replace");
  const r = pull(a);
  assert.equal(r.state.effectsByPieceId!.target.infection!.stacks, 2); // entry + ordinary red turn end
  assert.equal(r.state.effectsByPieceId!.target.barrier!.enemyTurnsRemaining, 2); // not refreshed
  assert.equal(r.state.effectsByPieceId!.target.dragonScale, 1); // displacement is not an attack
});

test("CY21 failed request publishes no research action events", () => {
  const a = pair();
  const capture = captureMechanismEvents(() => assert.throws(() => pull(a, { pieceId: "missing" })));
  assert.deepEqual(capture.events, []);
});

test("CY22 H05 cannot read this II-tier displacement as an ordinary previous move", () => {
  const r = pull(pair([], "murozond")), before = structuredClone(r);
  assert.throws(() => applyHeroAbility(r.state, r.secret, { kind: "hero_ability", ability: "timeline_twist", actionId: "twist", expectedRevision: r.state.revision, to: { x: 1, y: 4 } }), (e: any) => e.code === "NOT_PREVIOUS_ORDINARY");
  assert.deepEqual(r, before);
});

test("CY23 H06 restores position and public charges once, retaining timeline-external rewind use", () => {
  let a: Pair = pair([revealed("red-mover", "red", "rook", 1, 8), revealed("black-mover", "black", "rook", 8, 1)], "nozdormu");
  startFormalClock(a.state, 0, a.secret, () => 0);
  a = applyAuthoritativeMove(a.state, a.secret, move({ x: 1, y: 8 }, { x: 1, y: 7 }, "red-open", 0), false, 1000);
  startFormalClock(a.state, 1000, a.secret, () => 0);
  a = applyAuthoritativeMove(a.state, a.secret, move({ x: 8, y: 1 }, { x: 8, y: 2 }, "black-open", a.state.revision), false, 2000);
  startFormalClock(a.state, 2000, a.secret, () => 0); a = pull(a);
  startFormalClock(a.state, 3000, a.secret, () => 0);
  const r = applyHeroAbility(a.state, a.secret, { kind: "hero_ability", ability: "rewind", actionId: "rewind", expectedRevision: a.state.revision }, 4000, () => 0);
  assert.equal(r.state.heroRuntime!.red!.tetherPullUses ?? 0, 0);
  assert.equal(at(r.state, "target").y, 3); assert.equal(r.secret.rewindUsed!.black, true);
  assert.equal(r.secret.replay!.pieceId, "black-mover");
  assert.throws(() => applyHeroAbility(r.state, r.secret, { kind: "hero_ability", ability: "rewind", actionId: "rewind-again", expectedRevision: r.state.revision }, 5000), (e: any) => e.code === "SKILL_USED");
});

test("CY24 legal pull prevents ordinary-move-only false stalemate, exhaustion restores stalemate", () => {
  const a = pair([
    revealed("left-control", "black", "rook", 3, 0), revealed("right-control", "black", "rook", 5, 1),
    revealed("front-control", "black", "rook", 8, 8), revealed("royal-screen", "black", "pawn", 4, 3),
  ]);
  Object.assign(at(a.state, "red-general"), { x: 4, y: 9 });
  Object.assign(at(a.state, "black-general"), { x: 4, y: 0 });
  a.state.effectsByPieceId!.anchor = { controlTrap: { controller: "red", blockedFormalTurn: 1 } } as any;
  assert.equal(isGeneralInCheck(a.state, "red"), false);
  assert.deepEqual(getLegalMoves(a.state, "red-general"), []); assert.deepEqual(getLegalMoves(a.state, "anchor"), []);
  assert(getCenYingPullOptions(a.state).length > 0); assert.equal(hasAnyLegalMove(a.state, "red"), true); assert.equal(isStalemate(a.state, "red"), false);
  const before = structuredClone(a); advanceToFormalTurn(a.state, a.secret, "red", () => 0); assert.equal(a.state.status, "playing");
  before.state.heroRuntime!.red!.tetherPullUses = 2; assert.equal(isStalemate(before.state, "red"), true);
});

test("CY25 opponent may remove or obscure the public anchor before the opportunity", () => {
  const a = pair(); a.state.pieces = a.state.pieces.filter(p => p.id !== "anchor");
  rejectsUnchanged(a, "INVALID_TETHER_PAIR"); assert.deepEqual(getCenYingPullOptions(a.state), []);
});

test("CY26 classic no-extra-resource game still supports the usual legal reply", () => {
  const a = pair(), r = pull(a);
  const reply = getLegalMoves(r.state, "target")[0]; assert(reply);
  const moved = applyAuthoritativeMove(r.state, r.secret, move({ x: 0, y: 4 }, reply, "reply", r.state.revision));
  assert.equal(moved.state.turn, "red"); assert.equal(moved.state.heroRuntime!.red!.tetherPullUses, 1);
});


test("CY27 an open destruction batch cannot be bypassed by cloning the authority", () => {
  const a = pair(), before = structuredClone(a);
  openDestructionBatches.set(a.state, { batchId: "still-open", targets: [] });
  try {
    assert.throws(() => pull(a), (e: any) => e.code === "DESTRUCTION_BATCH_OPEN");
    assert.throws(() => getCenYingPullOptions(a.state), (e: any) => e.code === "DESTRUCTION_BATCH_OPEN");
    assert.deepEqual(a, before);
  } finally { openDestructionBatches.delete(a.state); }
});


for (const window of ["pendingShuffle", "pendingHeroChild", "pendingDescent"] as const) {
  test(`CY28 ${window} cannot reinterpret a malformed pull as a generic skip`, () => {
    const a = pair();
    (a.state as any)[window] = window === "pendingShuffle" ? { side: "black", window: "A" }
      : window === "pendingHeroChild" ? { side: "red", kind: "blade", pieceId: "anchor", parent: {} }
      : { side: "red", variant: "storm", pieces: [], atom: "fixture", assaultIds: [] };
    rejectsUnchanged(a, "INVALID_PHASE", { skip: true });
    assert.deepEqual(getCenYingPullOptions(a.state), []);
  });
}

test("CY29 another hero cannot invoke the experimental ability", () => {
  const a = pair();
  a.state = initializeFeatureGameState(gameState(a.state.pieces.slice(2)), { red: "hunter", black: "hunter" });
  rejectsUnchanged(a, "WRONG_HERO");
});
