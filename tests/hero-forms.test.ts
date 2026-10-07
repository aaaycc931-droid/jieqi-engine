import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, applyHeroAbility, beginFormalTurn, createHeroSelections, formalTurnDurationMs, generateGhosts, getHeroPackage, getLegalMoves, HERO_CATALOG, HERO_IDS, heroSkillLabel, initializeFeatureGameState, initializeFeatureSecret, princeProtects, publicStateSnapshot, requireModeFeatureAdaptation, selectedHeroId, validateHeroForms } from "../src/index.ts";
import { BluetoothHostRoom, BLUETOOTH_HOST_PLAYER as host, BLUETOOTH_GUEST_PLAYER as guest } from "../src/bluetooth-host-room.ts";
import { createBluetoothSnapshot, encodeBluetoothEnvelope, parseBluetoothEnvelope } from "../src/bluetooth-protocol.ts";
import type { GameState, HeroForm, HeroSelections } from "../src/types.ts";
import { gameState, move, revealed, secretState } from "./helpers.ts";
const code = (expected: string) => (err: unknown) => (err as { code: string }).code === expected;
const choice = (heroId: "prince" | "nozdormu" | "deathwing", form: HeroForm = "front") => ({ heroId, form, packageId: `${heroId}:${form}:v1` });
const fresh = () => gameState([revealed("mover", "red", "rook", 0, 7), revealed("reply", "black", "pawn", 4, 3)]);
const skill = (state: GameState, ability: "rewind" | "destruction", actionId = ability) => ({ kind: "hero_ability" as const, ability, actionId, expectedRevision: state.revision });
function rewindReady() {
  const state = initializeFeatureGameState(fresh(), { red: "nozdormu", black: "deathwing" });
  state.turnStartedAt = 0; state.turnDeadlineAt = 60_000;
  const secret = secretState(); initializeFeatureSecret(state, secret);
  const first = applyAuthoritativeMove(state, secret, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "red", 0), false, 1_000);
  const second = applyAuthoritativeMove(first.state, first.secret, move({ x: 4, y: 3 }, { x: 4, y: 4 }, "black", 1), false, 62_000);
  second.state.turnStartedAt = 63_000; second.state.turnDeadlineAt = 123_000;
  return { before: structuredClone({ state, secret }), ...second };
}
function preparedRoom() {
  let now = 1_000;
  const room = new BluetoothHostRoom({ roomId: "hero-form-contract", admissionSecret: "test-admission", now: () => now, randomInt: () => 0, mode: { heroesEnabled: true, mutationsEnabled: false } });
  room.handle(host, { kind: "hero", hero: "wind" }); room.handle(guest, { kind: "hero", hero: "hunter" });
  room.handle(host, { kind: "rps", choice: "rock", round: 1 }); room.handle(guest, { kind: "rps", choice: "scissors", round: 1 });
  room.handle(host, { kind: "hero_intro_complete" }); room.handle(guest, { kind: "hero_intro_complete" });
  room.handle(guest, { kind: "trap_draft", positions: [{ x: 1, y: 2 }, { x: 2, y: 2 }] });
  room.handle(host, { kind: "preparation_ready" }); room.handle(guest, { kind: "preparation_ready" });
  return { room, setNow: (n: number) => { now = n; } };
}

test("R4-FORM-01 twelve existing front packages retain complete catalog and exact naming", () => {
  for (const hero of HERO_IDS) {
    const pkg = getHeroPackage(hero);
    assert.equal(pkg.form, "front"); assert.equal(pkg.heroId, hero);
    assert.deepEqual(pkg.skillLabels, HERO_CATALOG[hero].skills.map(s => `${HERO_CATALOG[hero].name}｜【${s.name}】`));
    const state = initializeFeatureGameState(fresh(), { red: hero });
    assert.equal(selectedHeroId(state, "red"), hero);
    assert.deepEqual(state.featureRules!.heroSelections, createHeroSelections({ red: hero }));
  }
  assert.match(HERO_CATALOG.wind.skills[0].description, /五个己方正式回合/);
});
test("R4-FORM-02 inner naming is grammar only and never registers an unavailable package", () => {
  assert.equal(heroSkillLabel("风", "影", "inner"), "里·风｜【里·影】");
  for (const hero of HERO_IDS) assert.throws(() => getHeroPackage(hero, "inner"), code("HERO_FORM_UNAVAILABLE"));
});
test("R4-FORM-03 inner opening is rejected atomically without touching public or secret state", () => {
  const state = fresh(), before = structuredClone(state);
  assert.throws(() => initializeFeatureGameState(state, { red: "prince" }, "shadow_dance", { red: "inner" }), code("HERO_FORM_UNAVAILABLE"));
  assert.deepEqual(state, before);
  state.featureRules = { heroSelections: { red: choice("prince", "inner") } };
  const secret = secretState(), snapshot = structuredClone({ state, secret });
  assert.throws(() => initializeFeatureSecret(state, secret), code("HERO_FORM_UNAVAILABLE"));
  assert.deepEqual({ state, secret }, snapshot);
});
test("R4-FORM-04 unknown form, two forms, unknown hero and a form without hero fail closed", () => {
  for (const form of ["both", ["front", "inner"], null]) assert.throws(() => createHeroSelections({ red: "prince" }, { red: form as HeroForm }), code("INVALID_HERO_SELECTION"));
  assert.throws(() => createHeroSelections(undefined, { black: "front" }), code("INVALID_HERO_SELECTION"));
  assert.throws(() => createHeroSelections({ red: "untransferred" } as never), code("INVALID_HERO_SELECTION"));
  assert.throws(() => createHeroSelections({ red: null } as never), code("INVALID_HERO_SELECTION"));
});
test("R4-FORM-05 partial hero opening fixes only the chosen side and independently owns the lock", () => {
  const heroes = { red: "prince" as const };
  const state = initializeFeatureGameState(fresh(), heroes, undefined, { red: "front" });
  heroes.red = "deathwing" as never;
  const secret = secretState(); initializeFeatureSecret(state, secret);
  assert.equal(selectedHeroId(state, "red"), "prince"); assert.equal(selectedHeroId(state, "black"), undefined);
  assert.deepEqual(secret.heroFormLock, state.heroFormLock);
  assert.notEqual(secret.heroFormLock, state.heroFormLock);
  assert.notEqual(state.heroFormLock, state.featureRules!.heroSelections);
});
test("R4-FORM-06 legacy front snapshots migrate at public projection and authoritative move without input mutation", () => {
  const state = fresh(); state.featureRules = { heroes: { red: "nozdormu" } };
  const before = structuredClone(state), secret = secretState();
  const snapshot = publicStateSnapshot(state);
  assert.deepEqual(snapshot.heroFormLock, createHeroSelections({ red: "nozdormu" }));
  assert.deepEqual(state, before);
  const result = applyAuthoritativeMove(state, secret, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "legacy", 0));
  assert.deepEqual(result.secret.heroFormLock, snapshot.heroFormLock);
  assert.deepEqual(result.secret.history![0].state.heroFormLock, snapshot.heroFormLock);
  assert.deepEqual(state, before); assert.equal(secret.heroFormLock, undefined);
});
test("R4-FORM-07 canonical-only selection resolves the whole front package for passives and skills", () => {
  const state = fresh(); state.featureRules = { heroSelections: { red: choice("deathwing") } };
  assert.equal(selectedHeroId(state, "red"), "deathwing");
  const result = applyHeroAbility(state, secretState(), skill(state, "destruction"), 1_000, () => 1);
  assert.equal(result.state.heroRuntime!.red!.used, true);
  assert.equal(result.state.featureRules!.heroes!.red, "deathwing");
  const prince = fresh(); prince.featureRules = { heroSelections: { red: choice("prince") } };
  assert.equal(princeProtects(prince, "red"), true);
});
test("R4-FORM-08 alias mismatch, wrong package ID and malformed multi-package snapshot are rejected", () => {
  const state = fresh();
  for (const selections of [{ red: { ...choice("prince"), packageId: "prince:inner:v1" } }, { red: [choice("prince"), choice("prince", "inner")] }, { red: { ...choice("prince"), extra: "merge" } }, { red: { ...choice("prince"), form: undefined } }]) {
    state.featureRules = { heroSelections: selections as HeroSelections };
    assert.throws(() => validateHeroForms(state), code("INVALID_HERO_SELECTION"));
  }
  state.featureRules = { heroes: { red: "deathwing" }, heroSelections: { red: choice("prince") } };
  assert.throws(() => validateHeroForms(state), code("INVALID_HERO_SELECTION"));
});
test("R4-FORM-09 public per-game lock forbids switching, removal or adding another hero", () => {
  const base = initializeFeatureGameState(fresh(), { red: "prince" });
  for (const heroes of [{ red: "deathwing" }, {}, { red: "prince", black: "deathwing" }]) {
    const state = structuredClone(base); state.featureRules = { heroes: heroes as never };
    assert.throws(() => getLegalMoves(state, "mover"), code("HERO_FORM_LOCKED"));
  }
});
test("R4-FORM-10 authoritative independent lock rejects even a consistent replacement of all public package fields", () => {
  const state = initializeFeatureGameState(fresh(), { red: "prince" }); const secret = secretState(); initializeFeatureSecret(state, secret);
  state.featureRules = { heroes: { red: "deathwing" }, heroSelections: { red: choice("deathwing") } };
  state.heroFormLock = createHeroSelections({ red: "deathwing" });
  const before = structuredClone({ state, secret });
  assert.throws(() => applyHeroAbility(state, secret, skill(state, "destruction")), code("HERO_FORM_LOCKED"));
  assert.throws(() => applyAuthoritativeMove(state, secret, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "changed", 0)), code("HERO_FORM_LOCKED"));
  assert.deepEqual({ state, secret }, before);
});
test("R4-FORM-11 inner snapshot never falls back to front passive, clock, target, death or active skill", () => {
  const state = fresh(); state.featureRules = { heroes: { red: "prince" }, heroSelections: { red: choice("prince", "inner") } };
  for (const run of [() => princeProtects(state, "red"), () => getLegalMoves(state, "mover"), () => formalTurnDurationMs(state, "red"), () => generateGhosts(state), () => publicStateSnapshot(state), () => beginFormalTurn(state, secretState()), () => applyHeroAbility(state, secretState(), skill(state, "destruction"))]) {
    assert.throws(run, code("HERO_FORM_UNAVAILABLE"));
  }
});
test("R4-FORM-12 reinitialization cannot reset skills or switch before or after the first action", () => {
  const state = initializeFeatureGameState(fresh(), { red: "deathwing" });
  assert.throws(() => initializeFeatureGameState(state, { red: "prince" }), code("HERO_FORM_LOCKED"));
  const result = applyHeroAbility(state, secretState(), skill(state, "destruction"), 1_000, () => 1);
  const before = structuredClone(result.state);
  assert.throws(() => initializeFeatureGameState(result.state, { red: "deathwing" }), code("HERO_FORM_LOCKED"));
  assert.deepEqual(result.state, before); assert.equal(result.state.heroRuntime!.red!.used, true);
});
test("R4-FORM-13 actual rewind restores history while keeping the entire selected form fixed", () => {
  const ready = rewindReady();
  assert.deepEqual(ready.secret.history![0].secret.heroFormLock, ready.before.secret.heroFormLock);
  const result = applyHeroAbility(ready.state, ready.secret, skill(ready.state, "rewind"), 64_000);
  assert.deepEqual(result.state.heroFormLock, ready.before.state.heroFormLock);
  assert.deepEqual(result.secret.heroFormLock, ready.before.secret.heroFormLock);
  assert.deepEqual(result.state.featureRules!.heroSelections, ready.before.state.featureRules!.heroSelections);
  assert.equal(result.secret.rewindUsed!.red, true);
});
test("R4-FORM-14 a tampered historical package cannot replace the current authoritative game lock", () => {
  const ready = rewindReady(), history = ready.secret.history![0];
  history.state.featureRules = { heroes: { red: "nozdormu", black: "prince" } };
  history.state.heroFormLock = createHeroSelections(history.state.featureRules.heroes);
  history.secret.heroFormLock = structuredClone(history.state.heroFormLock);
  const before = structuredClone(ready);
  assert.throws(() => applyHeroAbility(ready.state, ready.secret, skill(ready.state, "rewind"), 64_000), code("HERO_FORM_LOCKED"));
  assert.deepEqual(ready, before);
});
test("R4-FORM-15 mutation-only and no-hero old snapshots normalize without inventing a hero", () => {
  const state = fresh(); state.featureRules = { mutation: "shadow_dance" };
  const secret = secretState(); initializeFeatureSecret(state, secret);
  assert.deepEqual(state.heroFormLock, {}); assert.deepEqual(secret.heroFormLock, {});
  assert.equal(selectedHeroId(state, "red"), undefined);
  assert.throws(() => requireModeFeatureAdaptation("xiangqi", { heroSelections: { red: choice("prince") } }), code("MODE_ADAPTATION_PENDING"));
});
test("R4-FORM-16 duplicate packets preserve the lock and cannot bypass authoritative mismatch checks", () => {
  const state = initializeFeatureGameState(fresh(), { red: "deathwing" });
  const result = applyHeroAbility(state, secretState(), skill(state, "destruction"), 1_000, () => 1);
  const duplicate = applyHeroAbility(result.state, result.secret, skill(state, "destruction"));
  assert.equal(duplicate.duplicate, true); assert.deepEqual(duplicate.state, result.state);
  result.state.featureRules = { heroes: { red: "prince" } };
  assert.throws(() => applyHeroAbility(result.state, result.secret, skill(state, "destruction")), code("HERO_FORM_LOCKED"));
});
test("R4-FORM-17 actual Bluetooth setup, encoded owner views and reconnect retain public form metadata", () => {
  const { room, setNow } = preparedRoom(); const before = room.views();
  assert.equal(before.publicRoom.phase, "playing");
  assert.deepEqual(before.publicRoom.features!.heroSelections, createHeroSelections({ red: "wind", black: "hunter" }));
  for (const view of [before.host, before.guest]) {
    const encoded = JSON.stringify(parseBluetoothEnvelope(encodeBluetoothEnvelope(createBluetoothSnapshot("form", view))).payload);
    assert.deepEqual(JSON.parse(encoded).state.heroFormLock, before.publicRoom.state!.heroFormLock);
    for (const key of ["identities", "history", "trueGenerals"]) assert.equal(encoded.includes(`"${key}"`), false);
  }
  setNow(2_000); room.disconnect(guest); setNow(5_000); const after = room.reconnect(guest);
  assert.deepEqual(after.publicRoom.state!.heroFormLock, before.publicRoom.state!.heroFormLock);
  assert.deepEqual(after.publicRoom.features!.heroSelections, before.publicRoom.features!.heroSelections);
});
test("R4-FORM-18 rematch creates a new game with fresh selections without unlocking the previous game", () => {
  const { room } = preparedRoom(); const previous = room.views();
  room.handle(host, { kind: "resign", expectedRevision: 0, actionId: "form-resign" });
  room.handle(host, { kind: "rematch_request", actionId: "form-rematch" }); room.handle(guest, { kind: "rematch_response", accept: true });
  room.handle(host, { kind: "hero", hero: "deathwing" }); room.handle(guest, { kind: "hero", hero: "prince" });
  room.handle(host, { kind: "rps", choice: "rock", round: 1 }); room.handle(guest, { kind: "rps", choice: "scissors", round: 1 });
  const next = room.views();
  assert.deepEqual(next.publicRoom.state!.heroFormLock, createHeroSelections({ red: "deathwing", black: "prince" }));
  assert.deepEqual(previous.publicRoom.state!.heroFormLock, createHeroSelections({ red: "wind", black: "hunter" }));
  assert.equal(next.publicRoom.state!.revision, 0);
});
