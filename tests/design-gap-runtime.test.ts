import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeAssassination, applyAuthoritativeMove, applyHeroAbility, beginFormalTurn, destroyPieceBatch, formalTurnDurationMs, initializeFeatureGameState, startFormalClock } from "../src/index.ts";
import type { GameState, HeroAbilityCommand, HeroId, SecretState } from "../src/types.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";

const skill = (s: GameState, ability: HeroAbilityCommand["ability"], rest: Partial<HeroAbilityCommand> = {}) => ({ kind: "hero_ability" as const, ability, actionId: `gap:${ability}:${s.revision}`, expectedRevision: s.revision, ...rest });
function pair(hero: HeroId, pieces: GameState["pieces"] = [], chaos = false) {
  return { state: initializeFeatureGameState(gameState(pieces), { red: hero, black: "hunter" }, chaos ? "chaos" : undefined), secret: secretState() };
}
function brawl(will = 6) {
  const a = pair("berserker", [revealed("actor", "red", "rook", 0, 7), covered("first", 0, 6), covered("second", 2, 6), covered("enemy", 2, 3)], true);
  // Real factions deliberately oppose current controllers: neither entry nor resources may read them.
  a.secret.identities = { first: { color: "black", type: "horse" }, second: { color: "black", type: "cannon" }, enemy: { color: "red", type: "pawn" } };
  beginFormalTurn(a.state, a.secret, () => 0);
  a.secret.identities.first.color = "black"; a.secret.identities.second.color = "black"; a.secret.identities.enemy.color = "red";
  a.state.heroRuntime!.red!.will = will;
  a.state.effectsByPieceId!.enemy = { barrier: { owner: "black", enemyTurnsRemaining: 3 } };
  return a;
}
function start(a: { state: GameState; secret: SecretState }) {
  return applyHeroAbility(a.state, a.secret, skill(a.state, "brawl", { pieceId: "actor", to: { x: 0, y: 6 } }), 1000);
}

test("GAP-H07-01 mirror clock is 60/60, single transfer and explicit destiny first-turn clock remain intact", () => {
  const s = initializeFeatureGameState(gameState(), { red: "murozond_minion", black: "murozond_minion" }), k = secretState();
  startFormalClock(s, 1000, k); assert.equal(s.turnDeadlineAt, 61000);
  startFormalClock(s, 2000, k); assert.equal(s.turnStartedAt, 1000); assert.equal(s.turnDeadlineAt, 61000);
  s.turn = "black"; delete s.turnLifecycle; startFormalClock(s, 3000, k); assert.equal(s.turnDeadlineAt, 63000);
  const one = pair("murozond_minion"); assert.equal(formalTurnDurationMs(one.state, "red"), 75000); assert.equal(formalTurnDurationMs(one.state, "black"), 45000);
  const destiny = initializeFeatureGameState(gameState(), { red: "murozond_minion", black: "murozond_minion" }, "end_time");
  assert.equal(formalTurnDurationMs(destiny, "red"), 75000); destiny.formalTurns!.red = 1; assert.equal(formalTurnDurationMs(destiny, "red"), 60000);
});

test("GAP-H12-01 only public ordinary ranks at least three eliminate a non-center general", () => {
  for (const [type, lethal] of [["pawn", false], ["advisor", false], ["elephant", false], ["horse", true], ["cannon", true], ["rook", true]] as const) {
    const a = pair("warlock", [revealed("center", "red", type, 3, 8)]);
    const r = applyHeroAbility(a.state, a.secret, skill(a.state, "burning_flame", { pieceId: "center" }));
    assert.equal(r.state.captured.some(p => p.id === "red-general"), lethal, type);
    assert.equal(r.state.captured.some(p => p.id === "center"), true);
  }
  const a = pair("warlock", [covered("center", 2, 6)]); a.secret.identities.center = { color: "red", type: "rook" };
  a.state.pieces.find(p => p.id === "red-general")!.x = 3; a.state.pieces.find(p => p.id === "red-general")!.y = 7;
  const r = applyHeroAbility(a.state, a.secret, skill(a.state, "burning_flame", { pieceId: "center" }));
  assert(r.state.pieces.some(p => p.id === "red-general"));
});

test("GAP-H12-02 general center closes one batch including rook, air and both generals before mutual destruction", () => {
  const a = pair("warlock", [revealed("rook", "black", "rook", 2, 8), { ...revealed("air", "black", "horse", 3, 8), layer: "air" }, revealed("ground", "red", "pawn", 3, 8)]);
  // Prepared special position; this does not claim a naturally played whole match.
  const king = a.state.pieces.find(p => p.id === "black-general")!; king.x = 4; king.y = 8;
  a.state.ghosts = [{ kind: "ghost", source: "death_knight:death", owner: "red", position: { x: 2, y: 8 }, remaining: 3 }];
  const r = applyHeroAbility(a.state, a.secret, skill(a.state, "burning_flame", { pieceId: "red-general" }));
  assert.equal(r.state.destructionBatches!.length, 1); assert.equal(r.state.destructionBatches![0].phase, "closed");
  assert.deepEqual(new Set(r.state.destructionBatches![0].destroyedIds), new Set(["red-general", "black-general", "rook", "air", "ground"]));
  assert.equal(r.state.status, "finished"); assert.equal(r.state.drawReason, "mutual_destruction"); assert.equal(r.state.winner, undefined);
  assert.equal(r.state.ghosts!.length, 1);
});

test("GAP-H16-01 paid main starts same-piece chain; children earn current-controller resources and finish only one formal turn", () => {
  const a = brawl(); startFormalClock(a.state, 0, a.secret);
  const command = skill(a.state, "brawl", { pieceId: "actor", to: { x: 0, y: 6 } });
  let r = applyHeroAbility(a.state, a.secret, command, 1000);
  assert.equal(r.state.heroRuntime!.red!.will, 2); assert.equal(r.state.heroRuntime!.red!.chargeCount, 1);
  assert.equal(r.state.pendingHeroChild!.kind, "brawl"); assert.equal(r.state.formalTurns!.red, 0); assert.equal(r.state.turnDeadlineAt, 60000);
  assert.equal(r.secret.history!.length, 1); assert.equal(r.secret.history![0].state.heroRuntime!.red!.will, 6); assert.equal(r.secret.history![0].state.heroRuntime!.red!.chargeCount, undefined);
  assert.equal(r.state.lastMove!.classification!.opportunity, "main"); assert.equal(r.state.lastMove!.classification!.source, "hero");
  assert.deepEqual(applyHeroAbility(r.state, r.secret, command).state, r.state);
  r = applyHeroAbility(r.state, r.secret, skill(r.state, "brawl_attack", { to: { x: 2, y: 6 } }), 2000);
  assert.equal(r.state.heroRuntime!.red!.will, 4); assert.equal(r.state.formalTurns!.red, 0); assert.equal(r.state.turnDeadlineAt, 60000);
  assert.equal(r.state.effectsByPieceId!.enemy.barrier!.enemyTurnsRemaining, 3);
  delete r.state.effectsByPieceId!.enemy.barrier;
  r = applyHeroAbility(r.state, r.secret, skill(r.state, "brawl_attack", { to: { x: 2, y: 3 } }), 3000);
  assert.equal(r.state.heroRuntime!.red!.will, 7); assert.equal(r.state.heroRuntime!.red!.chargeCount, 1);
  assert.equal(r.state.pendingHeroChild, undefined); assert.equal(r.state.turn, "black"); assert.equal(r.state.formalTurns!.red, 1);
  assert.equal(r.secret.history!.length, 1); assert.equal(r.state.actionRecords!.length, 3);
  assert(r.state.actionRecords!.slice(1).every(c => !c.countsAsFormalTurn && c.parentActionId === command.actionId));
  assert(r.state.captured.every(p => p.realColor === undefined && p.realType === undefined));
});

test("GAP-H16-02 insufficient upfront balance cannot borrow first kill, invalid first targets preserve state", () => {
  const a = brawl(4), before = structuredClone(a);
  assert.throws(() => start(a), e => e.code === "INSUFFICIENT_WILL"); assert.deepEqual(a, before);
  for (const to of [{ x: 2, y: 3 }, { x: 2, y: 6 }]) {
    const b = brawl(), snapshot = structuredClone(b);
    assert.throws(() => applyHeroAbility(b.state, b.secret, skill(b.state, "brawl", { pieceId: "actor", to }))); assert.deepEqual(b, snapshot);
  }
});

test("GAP-H16-03 chain rejects another actor, revealed target and new main; skip closes parent and durations once", () => {
  const r = start(brawl()), before = structuredClone(r);
  for (const rest of [{ pieceId: "red-general", to: { x: 2, y: 6 } }, { to: { x: 5, y: 0 } }]) {
    assert.throws(() => applyHeroAbility(r.state, r.secret, skill(r.state, "brawl_attack", rest)), e => e.code === "INVALID_BRAWL_CHILD"); assert.deepEqual(r, before);
  }
  assert.throws(() => applyAuthoritativeMove(r.state, r.secret, move({ x: 0, y: 6 }, { x: 0, y: 5 }, "new-main", r.state.revision)), e => e.code === "HERO_CHILD_ACTION_REQUIRED");
  const command = skill(r.state, "skip_child", { skip: true }), skipped = applyHeroAbility(r.state, r.secret, command);
  assert.equal(skipped.state.turn, "black"); assert.equal(skipped.state.formalTurns!.red, 1); assert.equal(skipped.state.heroRuntime!.red!.will, 2);
  assert.equal(skipped.state.effectsByPieceId!.enemy.barrier!.enemyTurnsRemaining, 2);
  assert.deepEqual(applyHeroAbility(skipped.state, skipped.secret, command).state, skipped.state);
});

test("GAP-H16-04 shared successful count scales one activation fee; ordinary allied capture never opens brawl", () => {
  const a = brawl(16); a.state.heroRuntime!.red!.chargeCount = 2;
  const r = start(a); assert.equal(r.state.heroRuntime!.red!.will, 2); assert.equal(r.state.heroRuntime!.red!.chargeCount, 3);
  assert.equal(r.secret.history![0].state.heroRuntime!.red!.chargeCount, 2);
  const b = brawl(), normal = applyAuthoritativeMove(b.state, b.secret, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "ordinary"));
  assert.equal(normal.state.heroRuntime!.red!.will, 8); assert.equal(normal.state.pendingHeroChild, undefined); assert.equal(normal.state.formalTurns!.red, 1);
});

test("GAP-H16-05 first dark actor revealing enemy closes chain without granting a second main", () => {
  const a = brawl(); a.state.pieces = a.state.pieces.filter(p => p.id !== "actor"); a.state.pieces.push(covered("actor", 0, 9)); a.secret.identities.actor = { color: "black", type: "rook" };
  const r = start(a); assert.equal(r.state.pieces.find(p => p.id === "actor")!.color, "black"); assert.equal(r.state.pendingHeroChild, undefined);
  assert.equal(r.state.formalTurns!.red, 1); assert.equal(r.state.turn, "black"); assert.equal(r.state.heroRuntime!.red!.will, 2);
});

test("GAP-H21-01 one scale stops combined attack and dragon claw; origin landing trap kills returning attacker only", () => {
  const a = pair("hunter", [revealed("actor", "red", "rook", 0, 7), revealed("target", "black", "pawn", 0, 6)]);
  a.state.effectsByPieceId!.actor = { dragonClaw: true }; a.state.effectsByPieceId!.target = { dragonScale: 1 };
  a.secret.traps = [{ id: "return", owner: "black", position: { x: 0, y: 7 }, opponentTurnsRemaining: 3 }];
  const r = applyAuthoritativeMove(a.state, a.secret, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "scaled"));
  assert.deepEqual(r.state.pieces.find(p => p.id === "target"), revealed("target", "black", "pawn", 0, 6));
  assert.equal(r.state.effectsByPieceId!.target.dragonScale, undefined); assert.equal(r.state.pieces.some(p => p.id === "actor"), false);
  assert.deepEqual(r.state.captured.map(p => [p.id, p.cause]), [["actor", "trap_ambush"]]); assert.equal(r.state.formalTurns!.red, 1);
});

test("GAP-H21-02 strong assassination returns to origin, spends opportunity and cannot bypass scale", () => {
  const a = pair("rogue", [revealed("actor", "red", "rook", 0, 7), revealed("target", "black", "pawn", 0, 6)]);
  a.state.assassination!.red.activePieceId = "actor";
  a.state.effectsByPieceId!.actor = { stealth: { owner: "red", remainingOwnerTurns: 2, strongStrikeAvailable: true, source: "hero" } };
  a.state.effectsByPieceId!.target = { dragonScale: 1, intangible: true, barrier: { owner: "black", enemyTurnsRemaining: 3 } };
  const command = { ...move({ x: 0, y: 7 }, { x: 0, y: 6 }, "scaled-strike"), kind: "assassination" as const, useStrongStrike: true };
  const r = applyAuthoritativeAssassination(a.state, a.secret, command);
  assert.equal(r.state.pieces.find(p => p.id === "actor")!.y, 7); assert(r.state.pieces.some(p => p.id === "target")); assert.equal(r.state.captured.length, 0);
  assert.equal(r.state.effectsByPieceId!.actor?.stealth, undefined); assert.equal(r.state.effectsByPieceId!.target.dragonScale, undefined); assert(r.state.effectsByPieceId!.target.barrier);
  assert.equal(r.state.formalTurns!.red, 1); assert.equal(r.state.lastMove!.landed, false); assert.deepEqual(applyAuthoritativeAssassination(r.state, r.secret, command).state, r.state);
});

test("GAP-H21-03 blocked landing consumes ground scale then suffocates flyer instead of keeping air retry", () => {
  const a = pair("sky_admiral", [{ ...revealed("air", "red", "horse", 0, 6), layer: "air" }, revealed("target", "black", "pawn", 0, 6)]);
  a.state.effectsByPieceId!.air = { flight: { source: "sky_admiral", owner: "red", remainingOwnerTurns: 1 } };
  a.state.effectsByPieceId!.target = { dragonScale: 1 };
  const r = applyHeroAbility(a.state, a.secret, skill(a.state, "landing", { pieceId: "air" }));
  assert(r.state.pieces.some(p => p.id === "target")); assert.equal(r.state.effectsByPieceId!.target.dragonScale, undefined); assert.equal(r.state.pieces.some(p => p.id === "air"), false);
  assert.deepEqual(r.state.captured.map(p => [p.id, p.cause]), [["air", "suffocation"]]); assert.equal(r.state.formalTurns!.red, 1);
});

test("GAP-H21-04 protected checker cannot be virtually removed to legalize a bouncing attack", () => {
  const a = pair("hunter", [revealed("actor", "red", "rook", 0, 7), revealed("checker", "black", "rook", 3, 7)]);
  a.state.effectsByPieceId!.checker = { dragonScale: 1 }; const before = structuredClone(a);
  assert.throws(() => applyAuthoritativeMove(a.state, a.secret, move({ x: 0, y: 7 }, { x: 3, y: 7 }, "fake-rescue")), e => e.code === "SELF_CHECK"); assert.deepEqual(a, before);
});

test("GAP-H21-05 blocked crush batch never reads dark true identity and scale does not block flame range death", () => {
  const a = pair("hunter", [covered("dark", 0, 6)]); a.state.effectsByPieceId!.dark = { dragonScale: 1 };
  const batch = destroyPieceBatch(a.state, a.secret, "scaled-batch", "source:crush", [{ pieceId: "dark", by: "red", cause: "crush" }]);
  assert.deepEqual(batch.destroyedIds, []); assert(a.state.pieces.some(p => p.id === "dark")); assert.equal(a.secret.identities.dark, undefined);
  const b = pair("warlock", [revealed("center", "red", "horse", 0, 6), revealed("target", "black", "rook", 1, 6)]); b.state.effectsByPieceId!.target = { dragonScale: 1 };
  const r = applyHeroAbility(b.state, b.secret, skill(b.state, "burning_flame", { pieceId: "center" })); assert(r.state.captured.some(p => p.id === "target"));
});
