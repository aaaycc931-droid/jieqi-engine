import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createInitialGame, initializeFeatureGameState, initializeFeatureSecret, getLegalMoves, getController,
  getRelayPairs, applyHeroAbility, applyAuthoritativeMove, applyAutomaticExecution, isGeneralInCheck,
  startFormalClock, publicStateSnapshot, applyResignation } from "../../src/index.ts";
import type { GameState, Side } from "../../src/types.ts";

// A deliberately weak, PUBLIC-ONLY deterministic policy. No evaluations read secret.
// Same seeds preserve initial hidden layout; no-skill control still takes every turn.
const value = { general: 0, rook: 9, cannon: 4.5, horse: 4, elephant: 2, advisor: 2, pawn: 1, storm_elemental: 2 };
function rng(seed: number) { let n = seed >>> 0; return (max: number) => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return Math.floor(n / 4294967296 * max); }; }
// Action-keyed tie breaks preserve the ordinary policy when extra skill candidates
// are listed but not selected. Candidate enumeration cannot consume its randomness.
function jitter(seed: number, ply: number, key: string) {
  return createHash("sha256").update(`${seed}:${ply}:${key}`).digest().readUInt16BE(0) / 327680;
}
function material(state: GameState, side: Side) { return state.pieces.reduce((n, p) => n + (p.faceDown ? 0 : (p.color === side ? 1 : -1) * value[p.type]), 0); }
function publicThreatValue(state: GameState, id: string, side: Side) {
  return getLegalMoves(state, id, side).reduce((score, to) => {
    const target = state.pieces.find(p => p.x === to.x && p.y === to.y && !p.layer);
    return Math.max(score, target ? target.faceDown ? 1 : value[target.type] : 0);
  }, 0);
}
function run(seed: number, pilotSide: Side, allowedRange: number) {
  const randomInt = rng(seed), initial = createInitialGame(randomInt);
  let state = initializeFeatureGameState(initial.state, allowedRange ? { [pilotSide]: "siheng" } : {}, "iron_wall", undefined, undefined, true);
  let secret = initial.secret; initializeFeatureSecret(state, secret, randomInt);
  const initialPublic = publicStateSnapshot(state);
  const trace: unknown[] = [], stages: unknown[] = [], failures: unknown[] = [];
  let used = 0;
  for (let ply = 0; ply < 180 && state.status !== "finished"; ply++) {
    if (state.status === "execution") {
      const r = applyAutomaticExecution(state, secret, `execute:${ply}`); state = r.state; secret = r.secret;
      trace.push({ ply, kind: "automatic_execution", status: state.status, winner: state.winner, reason: state.reason }); continue;
    }
    startFormalClock(state, 1000 + ply * 1000, secret, randomInt);
    const side = state.turn;
    const candidates: Array<{ score: number; kind: "move" | "swap"; pieceId: string; partnerId?: string; from?: { x: number; y: number }; to?: { x: number; y: number } }> = [];
    for (const p of state.pieces) {
      if (getController(p) !== side || p.layer) continue;
      for (const to of getLegalMoves(state, p.id, side)) {
        const target = state.pieces.find(q => !q.layer && q.x === to.x && q.y === to.y);
        // Captures first, expose covered pieces next, then gradual centralization.
        let checkBonus = 0;
        if (!p.faceDown) {
          const probe = structuredClone(state);
          probe.pieces = probe.pieces.filter(q => q.id === p.id || !target || q.id !== target.id);
          Object.assign(probe.pieces.find(q => q.id === p.id)!, to);
          if (isGeneralInCheck(probe, side === "red" ? "black" : "red")) checkBonus = 2;
        }
        const score = checkBonus + (target ? target.faceDown ? 2.2 : value[target.type] * 1.8 : 0) +
          (p.faceDown ? 1.8 : 0) + (4 - Math.abs(to.x - 4)) * .06 +
          (side === "red" ? p.y - to.y : to.y - p.y) * .04 + jitter(seed, ply, `move:${p.id}:${to.x}:${to.y}`);
        candidates.push({ kind: "move", pieceId: p.id, from: { x: p.x, y: p.y }, to, score });
      }
    }
    let pairs = side === pilotSide && allowedRange ? getRelayPairs(state) : [];
    pairs = pairs.filter(([a, b]) => { const p = state.pieces.find(p => p.id === a)!, q = state.pieces.find(p => p.id === b)!; return Math.abs(p.x-q.x)+Math.abs(p.y-q.y) <= allowedRange; });
    if (side === pilotSide && ([0, 12, 30, 60, 100].includes(ply) || pairs.length && !used)) stages.push({ ply, pieces: state.pieces.length, revealed: state.pieces.filter(p => !p.faceDown).length, pairs: pairs.length, checked: isGeneralInCheck(state, side) });
    for (const [a, b] of pairs) {
      const projection = structuredClone(state), p = projection.pieces.find(p => p.id === a)!, q = projection.pieces.find(p => p.id === b)!;
      const pos = { x: p.x, y: p.y }; p.x = q.x; p.y = q.y; q.x = pos.x; q.y = pos.y;
      const before = Math.max(publicThreatValue(state, a, side), publicThreatValue(state, b, side));
      const after = Math.max(publicThreatValue(projection, a, side), publicThreatValue(projection, b, side));
      const checking = isGeneralInCheck(projection, side === "red" ? "black" : "red");
      candidates.push({ kind: "swap", pieceId: a, partnerId: b, score: (after - before) * .6 + (checking ? 3 : 0) + .25 + jitter(seed, ply, `swap:${a}:${b}`) });
    }
    candidates.sort((a, b) => b.score - a.score);
    let accepted = false;
    for (const action of candidates) {
      const command = { ...action, expectedRevision: state.revision, actionId: `play:${ply}` };
      try {
        const r = action.kind === "swap"
          ? applyHeroAbility(state, secret, { kind: "hero_ability", ability: "relay_swap", pieceId: action.pieceId, partnerId: action.partnerId, expectedRevision: state.revision, actionId: command.actionId }, 1000 + ply * 1000, randomInt)
          : applyAuthoritativeMove(state, secret, { from: action.from!, to: action.to!, pieceId: action.pieceId, expectedRevision: state.revision, actionId: command.actionId }, false, 1000 + ply * 1000, undefined, randomInt);
        if (r.state.status === "playing" && !r.state.forcedDefense && !r.state.pendingHeroChild && r.state.turn === side) throw new Error("Runner invariant: ordinary main failed to hand off");
        if (action.kind === "swap") used++;
        state = r.state; secret = r.secret;
        trace.push({ ply, side, ...command, score: undefined, resultingStatus: state.status, checkedNext: state.status === "playing" ? isGeneralInCheck(state, state.turn) : undefined, captured: state.captured.length, uses: state.heroRuntime?.[pilotSide]?.relayUses ?? 0 });
        accepted = true; break;
      } catch (e) { failures.push({ ply, kind: action.kind, error: e instanceof Error ? e.message : String(e) }); }
    }
    if (!accepted) { failures.push({ ply, error: "No accepted public-policy candidate; not adjudicated as a draw" }); break; }
  }
  const capped = state.status !== "finished";
  // Demonstration has an explicit voluntary resignation, never an invented draw.
  // This is policy behavior, not a balance outcome or natural mate assertion.
  if (state.status === "playing") {
    const resigning: Side = material(state, "red") < 0 ? "red" : "black";
    const r = applyResignation(state, secret, resigning, state.revision, "policy-stop-resign"); state = r.state; secret = r.secret;
    trace.push({ kind: "voluntary_resignation", side: resigning, reason: "180-ply demonstration budget; lower public material side voluntarily resigns (tie black)", resultingStatus: state.status });
  }
  return { seed, pilotSide, allowedRange, initialPublic, trace, stages, failures, summary: {
    acceptedActions: trace.length, skillUses: used, status: state.status, winner: state.winner ?? null, reason: state.reason ?? null,
    publicMaterialDelta: material(state, pilotSide), finalPieces: state.pieces.length,
    finalPublicSHA256: createHash("sha256").update(JSON.stringify(publicStateSnapshot(state))).digest("hex"),
    cappedBeforeResignation: capped,
  } };
}

const results = [];
for (const seed of [7, 19, 43]) for (const side of ["red", "black"] as const) for (const range of [0, 2, 4]) {
  const result = run(seed, side, range); results.push(result);
  console.log(JSON.stringify({ seed, side, range, ...result.summary, failures: result.failures.length }));
}
mkdirSync("review/hero-pilot", { recursive: true });
// Keep one full natural-ending game with a skill, and reproducible compact action
// sequences for every other run. No evidence depends on a discarded final state.
const complete = results.find(r => r.allowedRange === 4 && r.summary.skillUses > 0 && !r.summary.cappedBeforeResignation);
if (!complete) throw new Error("No complete natural-ending game demonstrating the skill");
const compact = results.map(r => ({ seed: r.seed, pilotSide: r.pilotSide, allowedRange: r.allowedRange, summary: r.summary, stages: r.stages, failures: r.failures,
  actions: r.trace.map((a: any) => a.kind === "move" ? ["m", a.pieceId, a.to.x, a.to.y] : a.kind === "swap" ? ["s", a.pieceId, a.partnerId] : [a.kind, a.side ?? null]) }));
writeFileSync("review/hero-pilot/PLAYOUTS.json", JSON.stringify({ scope: "local engineering experiment, weak public policy; not human play or calibrated win rate", mutation: "iron_wall", nearParameter: "range2 is a legal subset policy under final range4 authority", actionEncoding: "m=ordinary move pieceId,x,y; s=relay pieceId,partnerId; automatic_execution or voluntary_resignation as named. Seed and script reproduce initial hidden layout, revisions, action IDs and time.", results: compact, completeGame: complete }, null, 2) + "\n");
