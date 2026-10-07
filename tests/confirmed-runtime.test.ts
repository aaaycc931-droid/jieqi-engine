import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeAssassination, applyAuthoritativeMove, applyHeroAbility, applyAutomaticExecution, getFlowDanceMoves, submitRemoteMove, closeDirectDeaths, destroyPiece, drawRuntimeMutation, beginFormalTurn, finishFormalTurn, formalTurnDurationMs, generateGhosts, initializeFeatureGameState, initializeFeatureSecret, landFlyingPiece, markRevealed, publicRemoteRoom, playerRoomView, queueLanding, resolveWindReturn, settleLandings, submitRemoteHeroAbility, validatePublicMove, isGeneralInCheck, advanceRemoteRoomTime } from "../src/index.ts";
import type { GameState, HeroAbilityCommand, HeroId, RemoteRoom, SecretState } from "../src/index.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";

const ability = (ability: HeroAbilityCommand["ability"], state: GameState, rest: Partial<HeroAbilityCommand> = {}) => ({ kind: "hero_ability" as const, ability, actionId: `skill:${ability}:${state.revision}`, expectedRevision: state.revision, ...rest });
const stateFor = (hero: HeroId, pieces: GameState["pieces"] = []) => initializeFeatureGameState(gameState(pieces), { red: hero, black: "hunter" });

test("RULE-9A delayed strong strike may backstab a true general after an entire enemy turn", () => {
  let s = stateFor("rogue", [revealed("striker", "red", "rook", 0, 7), revealed("enemy-pawn", "black", "pawn", 1, 2)]);
  let k = secretState();
  let r = applyAuthoritativeAssassination(s, k, { ...move({ x: 0, y: 7 }, { x: 5, y: 7 }, "activate"), kind: "assassination", source: "hero", useStrongStrike: false });
  r = applyAuthoritativeMove(r.state, r.secret, move({ x: 1, y: 2 }, { x: 1, y: 3 }, "enemy-full", 1));
  r = applyAuthoritativeAssassination(r.state, r.secret, { ...move({ x: 5, y: 7 }, { x: 5, y: 0 }, "strike", 2), kind: "assassination", useStrongStrike: true });
  assert.equal(r.state.status, "finished"); assert.equal(r.state.reason, "ambush"); assert.equal(r.state.winner, "red");
});

test("RULE-9 enemy-turn strong strike armor interception stays at origin and gives no extra response", () => {
  const s = initializeFeatureGameState(gameState([revealed("striker", "red", "rook", 5, 7)]), { red: "rogue", black: "warrior" });
  s.assassination!.red.activePieceId = "striker";
  s.effectsByPieceId = { striker: { stealth: { owner: "red", source: "hero", remainingOwnerTurns: 1, strongStrikeAvailable: true } } };
  const r = applyAuthoritativeAssassination(s, secretState(), { ...move({ x: 5, y: 7 }, { x: 5, y: 0 }, "armor"), kind: "assassination", useStrongStrike: true });
  assert.equal(r.state.pieces.find(p => p.id === "striker")?.y, 7);
  assert.equal(r.state.warrior!.black.ironArmorAvailable, false);
  assert.equal(r.state.forcedDefense, undefined); assert.equal(r.state.turn, "black");
});

test("RULE-10 late control trap blocks next controller formal turn but not other pieces", () => {
  const s = stateFor("hunter", [revealed("rook", "red", "rook", 0, 7), revealed("pawn", "red", "pawn", 2, 6)]), k = secretState();
  k.traps = [{ id: "late", owner: "black", position: { x: 0, y: 6 }, opponentTurnsRemaining: 3 }];
  const r = applyAuthoritativeMove(s, k, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "late"));
  assert.ok(r.state.pieces.some(p => p.id === "rook"));
  r.state.turn = "red";
  assert.equal(validatePublicMove(r.state, { from: { x: 0, y: 6 }, to: { x: 0, y: 5 } }).code, "CONTROL_TRAP");
  assert.equal(validatePublicMove(r.state, { from: { x: 2, y: 6 }, to: { x: 2, y: 5 } }).ok, true);
});

for (const remaining of [12, 4, 3, 1]) test(`RULE-10 hunter trap lifetime boundary ${remaining}`, () => {
  const s = stateFor("hunter", [revealed("p", "red", "pawn", 0, 6)]), k = secretState();
  k.traps = [{ id: "t", owner: "black", position: { x: 0, y: 5 }, opponentTurnsRemaining: remaining }];
  const r = applyAuthoritativeMove(s, k, move({ x: 0, y: 6 }, { x: 0, y: 5 }, "land"));
  assert.equal(r.state.pieces.some(p => p.id === "p"), remaining <= 3);
});

test("RULE-10 trap cannot probe friendly covered identity before control transfer", () => {
  const s = stateFor("hunter", [covered("p", 0, 6)]), k = secretState({ p: { color: "black", type: "rook" } });
  k.traps = [{ id: "t", owner: "red", position: { x: 0, y: 5 }, opponentTurnsRemaining: 12 }];
  const r = applyAuthoritativeMove(s, k, move({ x: 0, y: 6 }, { x: 0, y: 5 }, "turncoat"));
  assert.equal(r.secret.traps?.length, 1); assert.ok(r.state.pieces.some(p => p.id === "p"));
});

test("RULE-11 ghost is a non-unit, infects intangible ground pieces, third opportunity kills", () => {
  const s = stateFor("death_knight", [revealed("sacrifice", "red", "pawn", 0, 6), revealed("enemy", "black", "rook", 0, 5)]), k = secretState();
  initializeFeatureSecret(s, k); destroyPiece(s, k, "sacrifice", "black", "attack"); generateGhosts(s);
  const enemy = s.pieces.find(p => p.id === "enemy")!; enemy.y = 6;
  s.effectsByPieceId = { enemy: { intangible: true } };
  finishFormalTurn(s, k, "red", () => 99);
  assert.equal(s.effectsByPieceId.enemy.infection?.stacks, 1);
  finishFormalTurn(s, k, "red", () => 99); assert.equal(s.effectsByPieceId.enemy.infection?.stacks, 2);
  finishFormalTurn(s, k, "red", () => 99);
  assert.equal(s.pieces.some(p => p.id === "enemy"), false); assert.equal(s.ghosts.length, 0);
  assert.equal(s.captured.find(p => p.id === "enemy")?.cause, "infection");
});

test("RULE-11 entering a late ghost has too few opportunities for lethal infection", () => {
  const s = stateFor("death_knight", [revealed("enemy", "black", "pawn", 0, 4)]), k = secretState();
  s.ghosts = [{ owner: "red", position: { x: 0, y: 4 }, remaining: 1 }];
  finishFormalTurn(s, k, "red");
  assert.ok(s.pieces.some(p => p.id === "enemy")); assert.equal(s.effectsByPieceId?.enemy?.infection, undefined);
});

test("RULE-11 moving between active ghosts preserves infection without an immediate stack", () => {
  const s = stateFor("death_knight", [revealed("enemy", "black", "pawn", 0, 4)]), k = secretState();
  s.ghosts = [{ owner: "red", position: { x: 0, y: 4 }, remaining: 3 }, { owner: "red", position: { x: 0, y: 5 }, remaining: 3 }];
  s.effectsByPieceId = { enemy: { infection: { owner: "red", stacks: 2 } } };
  s.pieces.find(p => p.id === "enemy")!.y = 5;
  queueLanding(s, s.pieces.find(p => p.id === "enemy")!, "black", "relocation"); settleLandings(s, k);
  assert.equal(s.effectsByPieceId.enemy.infection?.stacks, 2);
});

test("RULE-5 failed flight landing on crush immune victim suffocates; victim is unchanged", () => {
  const p = { ...revealed("flyer", "red", "horse", 0, 5), layer: "air" as const };
  const s = stateFor("hunter", [p, revealed("immune", "black", "pawn", 0, 5)]), k = secretState();
  s.effectsByPieceId = { immune: { immuneCrush: true }, flyer: { intangible: true, flight: { remainingOwnerTurns: 1 } } };
  initializeFeatureSecret(s, k); landFlyingPiece(s, k, "flyer");
  assert.ok(s.pieces.some(p => p.id === "immune")); assert.equal(s.pieces.some(p => p.id === "flyer"), false);
  assert.equal(s.captured.find(p => p.id === "flyer")?.cause, "suffocation");
});

test("HERO deathwing random draws are independent, reveal dead covered identity and preserve generals", () => {
  const s = stateFor("deathwing", [covered("covered", 0, 6), revealed("keep", "black", "pawn", 0, 3)]), k = secretState({ covered: { color: "red", type: "horse" } });
  const draws = [0, 1];
  const r = applyHeroAbility(s, k, ability("destruction", s), 100, () => draws.shift()!);
  assert.equal(r.state.captured.find(p => p.id === "covered")?.type, "horse");
  assert.ok(r.state.pieces.some(p => p.id === "keep"));
  assert.equal(r.state.pieces.filter(p => !p.faceDown && p.type === "general").length, 2);
  assert.equal(r.state.turn, "black"); assert.equal(r.state.heroRuntime.red.used, true);
});

test("HERO zealot fourth invocation ends turn; execution then prefers home half and can randomly hit intangible", () => {
  const s = stateFor("devout_zealot", [revealed("home", "black", "pawn", 0, 6), revealed("away", "black", "rook", 0, 2)]), k = secretState();
  s.heroRuntime.red.invokeCount = 3;
  const invoked = applyHeroAbility(s, k, ability("invoke", s), 100);
  assert.equal(invoked.state.turn, "black"); assert.equal(invoked.state.heroRuntime.red.invokeCount, 4);
  invoked.state.turn = "red"; invoked.state.effectsByPieceId = { home: { intangible: true } };
  const r = applyHeroAbility(invoked.state, invoked.secret, ability("unspeakable", invoked.state), 101, () => 0);
  assert.equal(r.state.pieces.some(p => p.id === "home"), false); assert.ok(r.state.pieces.some(p => p.id === "away"));
});

test("HERO prince permits empty movement in domain but denies attacking from or into it", () => {
  const s = initializeFeatureGameState(gameState([revealed("enemy", "black", "rook", 0, 4), revealed("target", "red", "pawn", 0, 6)], { turn: "black" }), { red: "prince" });
  assert.equal(validatePublicMove(s, { from: { x: 0, y: 4 }, to: { x: 0, y: 5 } }).ok, true);
  assert.equal(validatePublicMove(s, { from: { x: 0, y: 4 }, to: { x: 0, y: 6 } }).code, "CAREFREE");
  s.formalTurns = { red: 9, black: 9 };
  assert.equal(validatePublicMove(s, { from: { x: 0, y: 4 }, to: { x: 0, y: 6 } }).ok, true);
});

test("HERO thief redistributes seconds and same hero mirror conserves sixty seconds", () => {
  const s = stateFor("murozond_minion"); assert.equal(formalTurnDurationMs(s, "red"), 75_000); assert.equal(formalTurnDurationMs(s, "black"), 45_000);
  const mirror = initializeFeatureGameState(gameState(), { red: "murozond_minion", black: "murozond_minion" });
  assert.equal(formalTurnDurationMs(mirror, "red"), 60_000); assert.equal(formalTurnDurationMs(mirror, "black"), 60_000);
});

test("HERO full rewind restores piece death/reveal and both skill resources, keeps used metadata and revision monotonic", () => {
  const s = stateFor("nozdormu", [revealed("mover", "red", "rook", 0, 7), revealed("victim", "black", "pawn", 0, 6), revealed("reply", "black", "pawn", 2, 2)]), k = secretState();
  s.turnStartedAt = 0; s.turnDeadlineAt = 60_000;
  const first = applyAuthoritativeMove(s, k, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "capture"), false, 50);
  const reply = applyAuthoritativeMove(first.state, first.secret, move({ x: 2, y: 2 }, { x: 2, y: 3 }, "reply", 1), false, 90);
  reply.state.turnStartedAt = 100;
  const r = applyHeroAbility(reply.state, reply.secret, ability("rewind", reply.state), 101);
  assert.ok(r.state.pieces.some(p => p.id === "victim")); assert.equal(r.state.captured.length, 0);
  assert.equal(r.secret.rewindUsed.red, true); assert.equal(r.state.revision, 3); assert.equal(r.secret.replay.pieceId, "mover");
  assert.throws(() => applyAuthoritativeMove(r.state, r.secret, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "forbidden", 3)), /回溯重走/);
});

test("HERO shadow activation leaves every public field unchanged; enemy view cannot reveal uses or host", () => {
  const s = stateFor("wind", [revealed("host", "red", "rook", 0, 7)]), k = secretState();
  s.automaticEvents = [{ kind: "existing_public_event" }]; initializeFeatureSecret(s, k);
  const r = applyHeroAbility(s, k, ability("shadow", s, { pieceId: "host" }), 100);
  assert.deepEqual(r.state, s); assert.equal(r.secret.wind.red.hostId, "host"); assert.equal(r.secret.wind.red.uses, 1);
  const room = { roomId: "x", seats: { host: { playerId: "alice", connectedAt: 0, lastSeenAt: 0 }, guest: { playerId: "bob", connectedAt: 0, lastSeenAt: 0 } }, mode: { heroesEnabled: true, mutationsEnabled: false }, phase: "playing", updatedAt: 100, inviteTokenHash: "irrelevant", game: { players: { red: "alice", black: "bob" }, state: s, secret: k }, features: { heroes: { red: "wind", black: "hunter" } }, featureSecret: { traps: [] } } as RemoteRoom;
  const after = submitRemoteHeroAbility(room, "alice", ability("shadow", s, { pieceId: "host" }), 200).room;
  assert.deepEqual(publicRemoteRoom(after), publicRemoteRoom(room));
  assert.equal(playerRoomView(after, "bob").ownHeroSecrets.wind, undefined);
  assert.equal(playerRoomView(after, "alice").ownHeroSecrets.wind.hostId, "host");
});

test("HERO shadow cooldown excludes activation and all five following owner turns", () => {
  const s = stateFor("wind", [revealed("host", "red", "rook", 0, 7), revealed("second", "red", "horse", 1, 7)]), k = secretState();
  const first = applyHeroAbility(s, k, ability("shadow", s, { pieceId: "host" }));
  for (let turn = 1; turn <= 5; turn++) {
    first.state.formalTurns.red = turn;
    assert.throws(() => applyHeroAbility(first.state, first.secret, ability("shadow", first.state, { pieceId: "second", actionId: `again:${turn}` })), /冷却/);
  }
  first.state.formalTurns.red = 6;
  const second = applyHeroAbility(first.state, first.secret, ability("shadow", first.state, { pieceId: "second", actionId: "ready" }));
  assert.equal(second.secret.wind.red.uses, 2);
});

test("CHAOS dead covered piece reveals kind without publishing secret faction", () => {
  const s = initializeFeatureGameState(gameState([covered("hidden", 0, 6)]), { red: "hunter" }, "chaos"), k = secretState({ hidden: { color: "black", type: "horse" } });
  destroyPiece(s, k, "hidden", "black", "destruction");
  const d = s.captured[0]; assert.equal(d.type, "horse"); assert.equal(d.secretColorWithheld, true); assert.equal(d.color, "red");
});

test("DESTINY shown dead warrior revival and frozen blocked-anchor eligibility; cleanup and dragon reload still occur", () => {
  const s = initializeFeatureGameState(gameState([covered("w", 0, 6), covered("d", 0, 3)]), { red: "nozdormu", black: "murozond" }, "end_time"), k = secretState({ w: { color: "red", type: "pawn" }, d: { color: "black", type: "pawn" } });
  initializeFeatureSecret(s, k); destroyPiece(s, k, "w", "black", "attack");
  s.warps = [{ x: 0, y: 6 }];
  s.pieces = s.pieces.map(p => p.id === "d" ? revealed("d", "black", "pawn", 0, 3) : p); delete k.identities.d; markRevealed(s, k, "d"); s.effectsByPieceId.d.ammunition = 0;
  const first = applyHeroAbility(s, k, ability("hourglass", s));
  assert.equal(first.state.pieces.some(p => p.id === "w"), false); assert.equal(first.state.warps.length, 0); assert.equal(first.state.effectsByPieceId.d.ammunition, 1);
  const second = applyHeroAbility(first.state, first.secret, ability("hourglass", first.state));
  assert.ok(second.state.pieces.some(p => p.id === "w" && !p.faceDown)); assert.equal(second.state.captured.some(p => p.id === "w"), false); assert.equal(second.state.hourglasses, 3);
});

test("DESTINY bomb attacks one square at range3, ends no formal action, and global once-per-turn applies", () => {
  const s = initializeFeatureGameState(gameState([revealed("d", "black", "pawn", 0, 3), revealed("w", "red", "pawn", 0, 6)], { turn: "black" }), { red: "nozdormu", black: "murozond" }, "end_time"), k = secretState();
  initializeFeatureSecret(s, k); markRevealed(s, k, "d");
  const r = applyHeroAbility(s, k, ability("bomb", s, { pieceId: "d", to: { x: 0, y: 6 } }));
  assert.equal(r.state.turn, "black"); assert.equal(r.state.effectsByPieceId.w.timeCollapse.expiresAtOwnerTurnEnd, 1);
  r.state.effectsByPieceId.d.ammunition = 1;
  assert.throws(() => applyHeroAbility(r.state, r.secret, ability("bomb", r.state, { pieceId: "d", to: { x: 1, y: 5 } })), /最多投放/);
});

test("ATOMIC both generals destroyed in one committed set yields draw and preserves causes", () => {
  const s = stateFor("hunter"), k = secretState(); initializeFeatureSecret(s, k);
  destroyPiece(s, k, "red-general", "black", "infection"); destroyPiece(s, k, "black-general", "red", "time_collapse");
  closeDirectDeaths(s, k, "red"); assert.equal(s.drawReason, "mutual_destruction"); assert.equal(s.winner, undefined);
  assert.deepEqual(s.captured.map(p => p.cause), ["infection", "time_collapse"]);
});

test("HERO timeline twist moves only the prior enemy ordinary mover, keeps earlier victims dead", () => {
  const s = initializeFeatureGameState(gameState([revealed("enemy", "red", "rook", 0, 7), revealed("victim", "black", "pawn", 0, 6)]), { red: "hunter", black: "murozond" });
  const moved = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }, "ordinary"));
  const r = applyHeroAbility(moved.state, moved.secret, ability("timeline_twist", moved.state, { to: { x: 0, y: 8 } }));
  assert.equal(r.state.pieces.find(p => p.id === "enemy")?.y, 8);
  assert.equal(r.state.pieces.some(p => p.id === "victim"), false);
  assert.equal(r.state.turn, "red"); assert.equal(r.state.formalTurns.black, 1);
});

test("HERO timeline twist refuses a prior skill-tier action", () => {
  const s = initializeFeatureGameState(gameState([revealed("enemy", "red", "rook", 0, 7)]), { red: "rogue", black: "murozond" });
  const moved = applyAuthoritativeAssassination(s, secretState(), { ...move({ x: 0, y: 7 }, { x: 0, y: 6 }, "skill"), kind: "assassination", source: "hero", useStrongStrike: false });
  assert.throws(() => applyHeroAbility(moved.state, moved.secret, ability("timeline_twist", moved.state, { to: { x: 0, y: 8 } })), /俗手/);
});

test("HERO rain unlocks after fifteen completed pairs, not fifteen single turns", () => {
  const s = stateFor("qin_long"), k = secretState();
  s.formalTurns = { red: 14, black: 14 }; finishFormalTurn(s, k, "black", () => 0);
  s.turn = "red"; beginFormalTurn(s, k, () => 0);
  assert.equal(s.heroRuntime.red.rainActive, undefined);
  delete s.turnLifecycle;
  s.formalTurns = { red: 15, black: 14 }; finishFormalTurn(s, k, "black", () => 0);
  assert.equal(s.heroRuntime.red.rainActive, undefined);
  s.turn = "red"; beginFormalTurn(s, k, () => 0);
  assert.equal(s.heroRuntime.red.rainActive, true);
});

test("HERO revealed hidden true general dies by ordinary piece eligibility, never rescues by flow", () => {
  const s = stateFor("wind", [revealed("host", "red", "rook", 0, 7)]), k = secretState();
  const shadow = applyHeroAbility(s, k, ability("shadow", s, { pieceId: "host" }));
  destroyPiece(shadow.state, shadow.secret, "host", "black", "attack");
  assert.equal(closeDirectDeaths(shadow.state, shadow.secret, "black"), true);
  assert.equal(shadow.state.winner, "black"); assert.equal(shadow.state.captured[0].type, "general");
});

test("HERO non-execution decoy death returns true general, clears host states and grants no dance", () => {
  const s = stateFor("wind", [revealed("host", "red", "rook", 0, 7)]), k = secretState();
  const shadow = applyHeroAbility(s, k, ability("shadow", s, { pieceId: "host" }));
  shadow.state.effectsByPieceId.host = { intangible: true, barrier: { owner: "red", enemyTurnsRemaining: 3 } };
  destroyPiece(shadow.state, shadow.secret, "red-general", "black", "crush");
  assert.equal(resolveWindReturn(shadow.state, shadow.secret), true);
  const host = shadow.state.pieces.find(p => p.id === "host");
  assert.equal(host.type, "general"); assert.equal(host.x, 3); assert.equal(host.y, 9);
  assert.equal(shadow.state.effectsByPieceId.host, undefined); assert.equal(shadow.state.flowDance, undefined);
  assert.equal(closeDirectDeaths(shadow.state, shadow.secret, "black"), false);
});

test("HERO decoy and hidden true general dying in same atomic chain does not flow", () => {
  const s = stateFor("wind", [revealed("host", "red", "rook", 0, 7)]), k = secretState();
  const r = applyHeroAbility(s, k, ability("shadow", s, { pieceId: "host" }));
  destroyPiece(r.state, r.secret, "red-general", "black", "crush"); destroyPiece(r.state, r.secret, "host", "black", "attack");
  assert.equal(resolveWindReturn(r.state, r.secret), false); closeDirectDeaths(r.state, r.secret, "black");
  assert.equal(r.state.winner, "black");
});

test("HERO checkmate execution returns attacker then offers palace-only flow dance without formal ticks", () => {
  const s = stateFor("wind", [revealed("host", "red", "rook", 0, 7), revealed("executor", "black", "rook", 3, 5)]), k = secretState();
  const r = applyHeroAbility(s, k, ability("shadow", s, { pieceId: "host" }));
  r.state.status = "execution"; r.state.winner = "black"; r.state.reason = "checkmate"; r.state.turn = "black";
  const executed = applyAutomaticExecution(r.state, r.secret, "execute");
  assert.equal(executed.state.status, "playing"); assert.equal(executed.state.pieces.find(p => p.id === "executor")?.y, 5);
  assert.equal(executed.state.flowDance.pieceId, "host");
  const danced = applyAuthoritativeMove(executed.state, executed.secret, move({ x: 3, y: 9 }, { x: 4, y: 9 }, "dance", executed.state.revision));
  assert.equal(danced.state.flowDance, undefined); assert.equal(danced.state.turn, "red"); assert.equal(danced.state.formalTurns.red, 0);
});

test("DESTINY is reachable only inside legendary pool with matching time-hero bond", () => {
  const choices = [6, 2];
  assert.equal(drawRuntimeMutation(() => choices.shift()!, { red: "nozdormu", black: "murozond" }), "end_time");
  assert.equal(drawRuntimeMutation(() => 6, { red: "hunter", black: "murozond" }), "chaos");
});

test("RULES ground intangible rook still gives ordinary check, air rook does not", () => {
  const s = stateFor("hunter", [revealed("rook", "red", "rook", 5, 7)]);
  s.effectsByPieceId.rook = { intangible: true };
  assert.equal(isGeneralInCheck(s, "black"), true);
  s.pieces.find(p => p.id === "rook").layer = "air"; assert.equal(isGeneralInCheck(s, "black"), false);
});

test("CLOCK network formal turn expiry gives timeout and stays stable on later observations", () => {
  const s = stateFor("murozond_minion"), k = secretState();
  s.turnStartedAt = 0; s.turnDeadlineAt = 75_000;
  const room = { roomId: "x", seats: { host: { playerId: "alice", connectedAt: 0, lastSeenAt: 0 }, guest: { playerId: "bob", connectedAt: 0, lastSeenAt: 0 } }, mode: { heroesEnabled: true, mutationsEnabled: false }, phase: "playing", updatedAt: 0, inviteTokenHash: "irrelevant", game: { players: { red: "alice", black: "bob" }, state: s, secret: k } } as RemoteRoom;
  const before = advanceRemoteRoomTime(room, undefined, 74_999); assert.equal(before.phase, "playing");
  const after = advanceRemoteRoomTime(before, undefined, 75_000); assert.equal(after.phase, "finished"); assert.equal(after.game.state.reason, "timeout");
  assert.equal(advanceRemoteRoomTime(after, undefined, 80_000).game.state.revision, after.game.state.revision);
});

test("FLIGHT air layer can move above a ground piece without capturing it; air destination occupancy is enforced", () => {
  const s = stateFor("hunter", [{ ...revealed("flyer", "red", "rook", 0, 7), layer: "air" }, revealed("ground", "black", "pawn", 0, 6)]), k = secretState();
  const r = applyAuthoritativeMove(s, k, { ...move({ x: 0, y: 7 }, { x: 0, y: 6 }, "air"), pieceId: "flyer" });
  assert.equal(r.state.pieces.filter(p => p.x === 0 && p.y === 6).length, 2); assert.equal(r.state.captured.length, 0);
  r.state.turn = "red";
  r.state.pieces.push({ ...revealed("another-air", "red", "horse", 0, 5), layer: "air" });
  assert.equal(validatePublicMove(r.state, { from: { x: 0, y: 6 }, to: { x: 0, y: 5 }, pieceId: "flyer" }).code, "ILLEGAL_TARGET");
});

test("RAIN legal check wins at atomic closure without ticking unrelated ghosts or formal turns", () => {
  const s = stateFor("qin_long", [revealed("rook", "red", "rook", 0, 7)]), k = secretState();
  s.heroRuntime.red.rainActive = true;
  s.ghosts = [{ owner: "red", position: { x: 8, y: 8 }, remaining: 3 }];
  const r = applyAuthoritativeMove(s, k, move({ x: 0, y: 7 }, { x: 5, y: 7 }, "rain"));
  assert.equal(r.state.status, "finished"); assert.equal(r.state.reason, "rain_night"); assert.equal(r.state.formalTurns.red, 0); assert.equal(r.state.ghosts[0].remaining, 3);
});


test("WIND war chariot endpoint occupancy suffocates the returning true general and commits the attack", () => {
  const s = stateFor("wind", [revealed("host", "red", "rook", 0, 7), revealed("attacker", "black", "rook", 3, 5), revealed("screen", "black", "pawn", 3, 7)]), k = secretState();
  const r = applyHeroAbility(s, k, ability("shadow", s, { pieceId: "host" }));
  r.state.turn = "black"; r.state.featureRules.mutation = "war_chariot";
  const before = structuredClone(r);
  const result = applyAuthoritativeMove(r.state, r.secret, move({x:3,y:5}, {x:3,y:9}, "occupied-return"));
  assert.equal(result.state.status, "finished"); assert.equal(result.state.winner, "black"); assert.equal(result.state.reason, "suffocation");
  assert.equal(result.state.pieces.find(p => p.id === "attacker")?.y, 9);
  assert.equal(result.state.pieces.some(p => p.id === "host"), false);
  assert.equal(result.state.captured.find(p => p.id === "host")?.type, "general");
  assert.equal(result.state.captured.find(p => p.id === "host")?.cause, "suffocation");
  assert.equal(result.state.flowDance, undefined);
  assert.deepEqual(r, before);
});

test("FLOW first step markers allow intermediate check; stale commands cannot alter a special dance", () => {
  const s = stateFor("wind", [revealed("rook", "black", "rook", 4, 5)]), k = secretState();
  s.flowDance = {side:"red", pieceId:"red-general", steps:0, resumeTurn:"red"};
  assert.ok(getFlowDanceMoves(s, "red-general").some(p => p.x === 4 && p.y === 9));
  s.flowDance.steps = 1;
  assert.equal(getFlowDanceMoves(s, "red-general").some(p => p.x === 4 && p.y === 9), false);
  assert.throws(() => applyAuthoritativeMove(s, k, move({x:3,y:9},{x:3,y:8},"stale-flow",42)), e => e.code === "STALE_REVISION");
  assert.equal(s.revision, 0);
});

test("CLOCK a move received at the exact deadline settles timeout instead of renewing the turn", () => {
  const s = stateFor("hunter", [revealed("pawn", "red", "pawn", 0, 6)]), k = secretState();
  s.turnStartedAt=0; s.turnDeadlineAt=60_000;
  const room = {roomId:"late", phase:"playing", updatedAt:0, game:{players:{red:"alice", black:"bob"}, state:s, secret:k}} as RemoteRoom;
  const r = submitRemoteMove(room, "alice", move({x:0,y:6},{x:0,y:5},"late"), 60_000);
  assert.equal(r.room.phase,"finished"); assert.equal(r.room.game.state.reason,"timeout");
  assert.equal(r.room.game.state.pieces.find(p=>p.id==="pawn").y,6);
  assert.equal(r.room.game.secret.processedActions.late,undefined);
});


test("WIND flight landing crushes decoy then suffocates returning true general without bouncing the flyer", () => {
  const s = stateFor("wind", [revealed("host", "red", "rook", 0, 7), {...revealed("flyer", "black", "rook", 3, 9), layer:"air"}]), k = secretState();
  const r = applyHeroAbility(s, k, ability("shadow", s, {pieceId:"host"}));
  r.state.effectsByPieceId.host = {immuneCrush:true, intangible:true, barrier:{owner:"red",enemyTurnsRemaining:3}};
  landFlyingPiece(r.state, r.secret, "flyer");
  assert.equal(r.state.status,"finished"); assert.equal(r.state.winner,"black"); assert.equal(r.state.reason,"suffocation");
  const flyer=r.state.pieces.find(p=>p.id==="flyer"); assert.equal(flyer.layer,undefined); assert.deepEqual({x:flyer.x,y:flyer.y},{x:3,y:9});
  const dead=r.state.captured.find(p=>p.id==="host"); assert.equal(dead.type,"general"); assert.equal(dead.cause,"suffocation"); assert.deepEqual(dead.position,{x:3,y:9});
  assert.equal(r.state.pieces.some(p=>p.x===0 && p.y===7),false);
  assert.equal(r.state.flowDance,undefined); assert.equal(r.state.effectsByPieceId.host,undefined);
});

for (const color of ["red","black"] as const) test(`WIND ${color} ground occupancy stays in place while returning general suffocates`, () => {
  const s=stateFor("wind",[revealed("host","red","rook",0,7)]), k=secretState();
  const r=applyHeroAbility(s,k,ability("shadow",s,{pieceId:"host"}));
  destroyPiece(r.state,r.secret,"red-general","black","crush");
  r.state.pieces.push(revealed("occupant",color,"pawn",3,9));
  resolveWindReturn(r.state,r.secret); closeDirectDeaths(r.state,r.secret,"black");
  assert.equal(r.state.winner,"black"); assert.equal(r.state.reason,"suffocation");
  assert.ok(r.state.pieces.some(p=>p.id==="occupant"));
  assert.equal(r.state.pieces.filter(p=>p.layer!=="air"&&p.x===3&&p.y===9).length,1);
});

test("WIND covered ground occupant is retained without exposing its identity", () => {
  const s=stateFor("wind",[revealed("host","red","rook",0,7)]), k=secretState();
  const r=applyHeroAbility(s,k,ability("shadow",s,{pieceId:"host"}));
  destroyPiece(r.state,r.secret,"red-general","black","crush");
  r.state.pieces.push(covered("occupant",3,9)); r.secret.identities.occupant={color:"black",type:"cannon"};
  resolveWindReturn(r.state,r.secret); closeDirectDeaths(r.state,r.secret,"black");
  assert.equal(r.state.reason,"suffocation");
  assert.deepEqual(r.state.pieces.find(p=>p.id==="occupant"),covered("occupant",3,9));
  assert.deepEqual(r.secret.identities.occupant,{color:"black",type:"cannon"});
  assert.equal(r.state.captured.some(p=>p.id==="occupant"),false);
});

test("WIND air-only occupancy does not block ground return or cause suffocation", () => {
  const s=stateFor("wind",[revealed("host","red","rook",0,7), {...revealed("flyer","black","rook",3,9),layer:"air"}]), k=secretState();
  const r=applyHeroAbility(s,k,ability("shadow",s,{pieceId:"host"}));
  destroyPiece(r.state,r.secret,"red-general","black","crush");
  resolveWindReturn(r.state,r.secret);
  assert.equal(closeDirectDeaths(r.state,r.secret,"black"),false);
  assert.equal(r.state.pieces.find(p=>p.id==="host").type,"general");
  assert.equal(r.state.pieces.filter(p=>p.x===3&&p.y===9).length,2);
  assert.equal(r.state.pieces.filter(p=>p.x===3&&p.y===9&&p.layer!=="air").length,1);
});
