/**
 * EXP-HERO-002 bounded local evidence. This is not the frozen scoring system.
 * Selection reads GameState only. SecretState is supplied only to the authority
 * after an action has been selected, never to the policy or speculative trials.
 * Synthetic tactical positions are labeled; seeded games start from all 32 men.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInitialGame } from "../../src/setup.ts";
import { initializeFeatureGameState, applyAuthoritativeMove, applyAutomaticExecution, applyResignation } from "../../src/game.ts";
import { applyHeroAbility } from "../../src/hero-actions.ts";
import { getCenYingPullOptions } from "../../src/hero-cen-ying.ts";
import { getLegalMoves, isGeneralInCheck, canRevealedPieceAttack } from "../../src/rules.ts";
import { getController, otherSide } from "../../src/slots.ts";
import { isGround } from "../../src/spaces.ts";
import type { GameState, PublicPiece, Position, SecretState, Side } from "../../src/types.ts";

const OUT = "review/hero-pilot-02/balance-results.json";
const RUN_COMMAND = "node scripts/review/hero-pilot-02-balance.ts";
const hash = (x: unknown) => createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");
const clone = <T>(x: T): T => structuredClone(x);
const values: Record<string, number> = { general: 0, pawn: 1, advisor: 2, elephant: 2, horse: 3, cannon: 3, rook: 9, storm_elemental: 2 };
function rng(seed: number) { let n = seed >>> 0; return (max: number) => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n % max; }; }
function at(p: Position, q: Position) { return p.x === q.x && p.y === q.y; }
function transform(p: Position, side: Side) { return side === "red" ? { x: p.x, y: p.y } : { x: 8 - p.x, y: 9 - p.y }; }
function body(id: string, color: Side, type: string, x: number, y: number): PublicPiece { return { id, color, type, x, y, faceDown: false } as PublicPiece; }
type Context = { state: GameState; secret: SecretState; actions: any[] };

function makeFixture(kind: "tactic" | "empty_tempo" | "cannon_safety", heroSide: Side): Context {
  let pieces: PublicPiece[];
  if (kind === "tactic") {
    pieces = [body("own-general", "red", "general", 3, 9), body("other-general", "black", "general", 4, 0),
      body("anchor", "red", "pawn", 1, 3), body("own-rook", "red", "rook", 4, 6),
      body("upper-leg", "red", "pawn", 3, 2), body("lower-leg", "black", "pawn", 3, 4),
      body("own-elephant", "red", "elephant", 1, 5), body("target", "black", "horse", 4, 3), body("other-rook", "black", "rook", 8, 3)];
  } else if (kind === "empty_tempo") {
    pieces = [body("own-general", "red", "general", 3, 9), body("other-general", "black", "general", 5, 0),
      body("anchor", "red", "pawn", 2, 3), body("target", "black", "rook", 5, 3)];
  } else {
    pieces = [body("own-general", "red", "general", 4, 9), body("other-general", "black", "general", 5, 0),
      body("anchor", "red", "pawn", 1, 6), body("own-screen", "red", "pawn", 4, 5),
      body("target", "black", "horse", 4, 6), body("other-cannon", "black", "cannon", 4, 2)];
  }
  if (heroSide === "black") pieces = pieces.map(p => ({ ...p, ...transform(p, heroSide), color: otherSide((p as any).color) }));
  const state = initializeFeatureGameState({ status: "playing", turn: heroSide, revision: 0, pieces, captured: [] }, { [heroSide]: "cen_ying" });
  return { state, secret: { identities: {}, processedActions: {} }, actions: [] };
}

function summary(state: GameState) {
  return { revision: state.revision, turn: state.turn, status: state.status, winner: state.winner, reason: state.reason,
    formalTurns: state.formalTurns, pulls: Object.fromEntries((["red", "black"] as const).map(side => [side, state.heroRuntime?.[side]?.tetherPullUses ?? 0])),
    captured: state.captured.map(p => ({ id: p.id, type: p.type, color: p.color, cause: p.cause })), publicStateSha256: hash(state) };
}
function record(ctx: Context, command: any, result: any, note?: string) {
  const before = summary(ctx.state);
  ctx.state = result.state; ctx.secret = result.secret;
  ctx.actions.push({ command, note, before, after: summary(ctx.state), lastMove: ctx.state.lastMove });
  assert.equal(result.duplicate, false);
}
function pull(ctx: Context, id: string) {
  const command = { kind: "hero_ability" as const, ability: "tether_pull" as const, anchorPieceId: "anchor", pieceId: "target", expectedRevision: ctx.state.revision, actionId: id };
  record(ctx, command, applyHeroAbility(ctx.state, ctx.secret, command, 1000 + ctx.state.revision * 1000, () => 0));
}
function moveId(ctx: Context, pieceId: string, pos: Position, id: string) {
  const piece = ctx.state.pieces.find(p => p.id === pieceId)!;
  assert.ok(piece, `${id} piece exists`);
  assert.ok(getLegalMoves(ctx.state, pieceId).some(to => at(to, pos)), `${id} is publicly legal`);
  const command = { pieceId, from: { x: piece.x, y: piece.y }, to: pos, expectedRevision: ctx.state.revision, actionId: id };
  record(ctx, command, applyAuthoritativeMove(ctx.state, ctx.secret, command, false, 1000 + ctx.state.revision * 1000));
}
function material(state: GameState, side: Side) {
  return state.pieces.reduce((n, p) => p.faceDown ? n : n + (p.color === side ? 1 : -1) * (values[p.type] ?? 0), 0);
}

function fixtures() {
  const evidence: any[] = [];
  for (const side of ["red", "black"] as const) {
    const ctx = makeFixture("tactic", side), start = clone(ctx.state), initialValue = material(start, side);
    assert.equal(isGeneralInCheck(ctx.state, side), false);
    pull(ctx, `${side}-tactic-pull`);
    assert.equal(isGeneralInCheck(ctx.state, otherSide(side)), true);
    assert.equal(getLegalMoves(ctx.state, "target").length, 0, "pulled horse cannot answer the discovered check");
    const replies = ctx.state.pieces.filter(p => getController(p) === otherSide(side)).flatMap(p => getLegalMoves(ctx.state, p.id).map(to => ({ pieceId: p.id, to })));
    assert.equal(replies.length, 3, "two king escapes and one rook interposition");
    const allFirstReplies = replies.map((reply, index) => {
      const branch: Context = { state: clone(ctx.state), secret: clone(ctx.secret), actions: [] };
      moveId(branch, reply.pieceId, reply.to, `${side}-all-replies-${index}`);
      const elephantTo = transform({ x: 3, y: 3 }, side);
      const cheapCaptureLegal = getLegalMoves(branch.state, "own-elephant").some(to => at(to, elephantTo));
      assert.equal(cheapCaptureLegal, true, "every legal first reply still permits the elephant to capture the pulled horse");
      moveId(branch, "own-elephant", elephantTo, `${side}-all-replies-${index}-elephant`);
      const recaptures = branch.state.pieces.filter(p => getController(p) === otherSide(side)).flatMap(p =>
        getLegalMoves(branch.state, p.id).filter(to => at(to, elephantTo)).map(to => ({ pieceId: p.id, to })));
      const recaptureBranches = recaptures.map((response, secondIndex) => {
        const continued: Context = { state: clone(branch.state), secret: clone(branch.secret), actions: [] };
        moveId(continued, response.pieceId, response.to, `${side}-all-replies-${index}-recapture-${secondIndex}`);
        return { response, actions: continued.actions, materialDelta: material(continued.state, side) - initialValue, final: summary(continued.state) };
      });
      return { reply, cheapCaptureLegal, actions: branch.actions, afterCaptureMaterialDelta: material(branch.state, side) - initialValue, recaptureBranches,
        scope: "All legal first replies to this synthetic check were enumerated; only immediate recaptures were extended, not the full game tree." };
    });
    moveId(ctx, "other-general", transform({ x: 5, y: 0 }, side), `${side}-king-answer`);
    moveId(ctx, "own-elephant", transform({ x: 3, y: 3 }, side), `${side}-elephant-takes-horse`);
    moveId(ctx, "other-rook", transform({ x: 3, y: 3 }, side), `${side}-active-rook-recapture`);
    assert.equal(material(ctx.state, side) - initialValue, 1, "horse for elephant in this named line");

    const direct = makeFixture("tactic", side);
    moveId(direct, "own-rook", transform({ x: 4, y: 3 }, side), `${side}-ordinary-rook-takes-horse`);
    moveId(direct, "other-rook", transform({ x: 4, y: 3 }, side), `${side}-ordinary-rook-recapture`);
    assert.equal(material(direct.state, side) - initialValue, -6, "direct rook capture loses the rook for a horse");
    const quiet = makeFixture("tactic", side);
    moveId(quiet, "anchor", transform({ x: 2, y: 3 }, side), `${side}-ordinary-anchor-development`);
    moveId(quiet, "other-general", transform({ x: 5, y: 0 }, side), `${side}-ordinary-unpin`);
    assert.equal(quiet.state.captured.length, 0);
    evidence.push({ id: `tactic_${side}`, synthetic: true, naturalOpeningReachabilityProven: false, start, replies, allFirstReplies,
      withSkill: { actions: ctx.actions, materialDelta: 1, final: summary(ctx.state) },
      ordinaryDirectCapture: { actions: direct.actions, materialDelta: -6, final: summary(direct.state) },
      ordinaryQuietAlternative: { actions: quiet.actions, materialDelta: 0, final: summary(quiet.state) },
      scope: "Named legal continuations, not a minimax or universal dominance proof; the opponent uses real replies and recaptures. Values 9/3/2/1 are an explanatory material proxy, not official hero scores." });

    const undo = makeFixture("empty_tempo", side), undoStart = clone(undo.state);
    pull(undo, `${side}-reversible-pull`);
    moveId(undo, "target", transform({ x: 5, y: 3 }, side), `${side}-opponent-returns`);
    assert.deepEqual(undo.state.pieces, undoStart.pieces);
    assert.equal(undo.state.heroRuntime?.[side]?.tetherPullUses, 1);
    const punish = makeFixture("empty_tempo", side);
    pull(punish, `${side}-bad-anchor-pull`);
    moveId(punish, "target", transform({ x: 2, y: 3 }, side), `${side}-opponent-captures-anchor`);
    assert.equal(punish.state.pieces.some(p => p.id === "anchor"), false);
    evidence.push({ id: `counterplay_${side}`, synthetic: true, start: undoStart,
      returnToOriginal: { actions: undo.actions, final: summary(undo.state) },
      captureAnchor: { actions: punish.actions, final: summary(punish.state) },
      conclusion: "An unprepared pull can spend a charge with no position gain, or expose and lose the anchor." });

    const safety = makeFixture("cannon_safety", side), before = clone({ state: safety.state, secret: safety.secret });
    assert.equal(isGeneralInCheck(safety.state, side), false);
    assert.equal(getCenYingPullOptions(safety.state, side).some(o => o.anchorPieceId === "anchor" && o.pieceId === "target"), false);
    let rejected: any;
    try { pull(safety, `${side}-unsafe-cannon-screen`); } catch (error: any) { rejected = { name: error.name, code: error.code, message: error.message }; }
    assert.ok(rejected);
    assert.deepEqual({ state: safety.state, secret: safety.secret }, before);
    evidence.push({ id: `cannon_screen_safety_${side}`, synthetic: true, start: before.state, rejected, unchanged: true,
      conclusion: "Pulling one of two cannon screens would expose the acting king; rejected before resource or turn consumption." });
  }
  return evidence;
}

type PolicyAction = { kind: "move"; pieceId: string; from: Position; to: Position } | { kind: "pull"; anchorPieceId: string; pieceId: string; from: Position; to: Position };
/** Public heuristic projection only; does not reveal covered identities. */
function project(state: GameState, action: PolicyAction): GameState {
  if (action.kind === "pull") return { ...state, pieces: state.pieces.map(p => p.id === action.pieceId ? { ...p, ...action.to } : p) };
  const target = state.pieces.find(p => isGround(p) && at(p, action.to));
  if (target && (state.effectsByPieceId?.[target.id]?.barrier || state.effectsByPieceId?.[target.id]?.dragonScale)) return state;
  return { ...state, pieces: state.pieces.filter(p => p.id !== target?.id).map(p => p.id === action.pieceId ? { ...p, ...action.to } : p) };
}
function threatened(state: GameState, piece: PublicPiece, side: Side) {
  return state.pieces.some(p => !p.faceDown && p.color === side && p.id !== piece.id && canRevealedPieceAttack(state, p, piece));
}
function publicEvaluation(state: GameState, side: Side) {
  let result = material(state, side) * 100;
  for (const p of state.pieces) {
    if (p.faceDown || p.type === "general") continue;
    const value = values[p.type] ?? 1;
    if (threatened(state, p, otherSide(p.color))) result += (p.color === side ? -1 : 1) * value * (threatened(state, p, p.color) ? 9 : 23);
  }
  if (isGeneralInCheck(state, otherSide(side))) result += 65;
  return result;
}
/** Policy receives no SecretState or hidden assignment; all alternatives are public. */
function chooseAction(state: GameState, heroSide: Side, enableSkill: boolean, random: (max: number) => number): PolicyAction | undefined {
  const candidates: PolicyAction[] = state.pieces.filter(p => getController(p) === state.turn).flatMap(p => getLegalMoves(state, p.id).map(to => ({ kind: "move" as const, pieceId: p.id, from: { x: p.x, y: p.y }, to })));
  if (enableSkill && state.turn === heroSide) candidates.push(...getCenYingPullOptions(state, heroSide).map(o => ({ kind: "pull" as const, ...o })));
  let best = -Infinity, choices: PolicyAction[] = [];
  for (const action of candidates) {
    const mover = state.pieces.find(p => p.id === action.pieceId)!;
    let score = publicEvaluation(project(state, action), state.turn);
    if (action.kind === "move" && mover.faceDown) score += 28;
    if (action.kind === "pull") score -= 6; // charge and one whole turn have opportunity cost
    if (action.kind === "move" && !mover.faceDown && mover.type === "pawn") score += Math.max(0, (state.turn === "red" ? action.from.y - action.to.y : action.to.y - action.from.y)) * 2;
    if (score > best + 0.00001) { best = score; choices = [action]; }
    else if (Math.abs(score - best) < 0.00001) choices.push(action);
  }
  return choices.length ? choices[random(choices.length)] : undefined;
}

function rollout(seed: number, heroSide: Side, enableSkill: boolean, budget = 140, exerciseSkill = false) {
  const dealt = createInitialGame(rng(seed));
  const initialSecretSha256 = hash(dealt.secret.identities);
  const ctx: Context = { state: initializeFeatureGameState(dealt.state, { [heroSide]: "cen_ying", [otherSide(heroSide)]: "warrior" }), secret: dealt.secret, actions: [] };
  const start = clone(ctx.state), policyRng = rng(seed ^ 0x9e3779b9), id = `${seed}-${heroSide}-${enableSkill ? "enabled" : "disabled"}${exerciseSkill ? "-exercise" : ""}`;
  let candidateTurns = 0, firstCandidatePly: number | null = null, ordinaryActions = 0, skillActions = 0, budgetResignation = false;
  for (let ply = 0; ply < budget && ctx.state.status !== "finished"; ply++) {
    if (ctx.state.status === "execution") {
      record(ctx, { kind: "automatic_execution", actionId: `${id}-execution-${ply}` }, applyAutomaticExecution(ctx.state, ctx.secret, `${id}-execution-${ply}`));
      continue;
    }
    if (ctx.state.turn === heroSide && getCenYingPullOptions(ctx.state, heroSide).length) { candidateTurns++; firstCandidatePly ??= ply; }
    const available = exerciseSkill && ctx.state.turn === heroSide ? getCenYingPullOptions(ctx.state, heroSide) : [];
    const action: PolicyAction | undefined = available.length
      ? { kind: "pull", ...available[policyRng(available.length)] }
      : chooseAction(ctx.state, heroSide, enableSkill, policyRng);
    assert.ok(action, `public ordinary-or-skill policy has an action in playing state at ${id}/${ply}`);
    const actionId = `${id}-${ply}`;
    if (action.kind === "pull") {
      const command = { kind: "hero_ability" as const, ability: "tether_pull" as const, anchorPieceId: action.anchorPieceId, pieceId: action.pieceId, expectedRevision: ctx.state.revision, actionId };
      record(ctx, command, applyHeroAbility(ctx.state, ctx.secret, command, 1000 + ply * 1000)); skillActions++;
    } else {
      const command = { pieceId: action.pieceId, from: action.from, to: action.to, expectedRevision: ctx.state.revision, actionId };
      record(ctx, command, applyAuthoritativeMove(ctx.state, ctx.secret, command, false, 1000 + ply * 1000)); ordinaryActions++;
    }
  }
  if (ctx.state.status === "execution") record(ctx, { kind: "automatic_execution", actionId: `${id}-last-execution` }, applyAutomaticExecution(ctx.state, ctx.secret, `${id}-last-execution`));
  if (ctx.state.status === "playing") {
    budgetResignation = true;
    const command = { kind: "budget_resignation", side: ctx.state.turn, expectedRevision: ctx.state.revision, actionId: `${id}-budget-resignation` };
    record(ctx, command, applyResignation(ctx.state, ctx.secret, ctx.state.turn, ctx.state.revision, command.actionId), "Explicit script-budget resignation, not a natural win/loss or evidence of strength.");
  }
  assert.equal(ctx.state.status, "finished");
  assert.ok(skillActions <= 2);
  return { id, seed, heroSide, enableSkill, budget, exerciseSkill, purpose: exerciseSkill ? "Deliberately choose a legal pull when available to exercise the complete runtime; not a strength comparison" : "Matched public one-ply policy observation; no forced skill use", start, initialSecretSha256, candidateTurns, firstCandidatePly, ordinaryActions, skillActions,
    completionKind: budgetResignation ? "budget_resignation" : "natural_terminal", final: summary(ctx.state), actions: ctx.actions };
}

mkdirSync("review/hero-pilot-02", { recursive: true });
const sourcePaths = ["scripts/review/hero-pilot-02-balance.ts", "src/hero-cen-ying.ts", "src/hero-actions.ts", "src/hero-forms.ts", "src/heroes.ts", "src/types.ts", "src/game.ts", "src/rules.ts", "src/settlement.ts", "src/turns.ts"];
const result: any = { schema: "lezi.hero_pilot_02.balance_evidence.v1", command: RUN_COMMAND, executedAt: new Date().toISOString(),
  sourceSha256: Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(path, "utf8"))])),
  policy: { name: "public_one_ply_material_threat_heuristic", secretsUsedForChoice: false, trialAuthorityExecutionForChoice: false,
    values, valueMeaning: "Explanatory ordinary piece heuristic only; no official scoring method or frozen ledger operation.",
    opponent: "warrior passive hero; same public ordinary-action policy", skillDisabledArm: "same hero and initial deal, only tether actions excluded; ordinary actions remain available", maxPlies: 140,
    limitations: ["Weak one-ply policy, not a human or strong chess engine", "Tactical fixtures are synthetic, not proven reachable through a natural opening", "Seeded arms diverge after different actions; not a causal estimate of universal hero strength", "Covered-piece futures use no secret identity; heuristic errors are expected", "No all-mutation, Android, network, global balance or independent QA claim"] } };
try {
  result.fixtures = fixtures();
  result.rollouts = [];
  result.skillExercises = [];
  if (!process.argv.includes("--fixtures-only")) {
    for (const seed of [93, 95, 97, 98]) for (const side of ["red", "black"] as const) for (const enabled of [false, true]) {
      const row = rollout(seed, side, enabled); result.rollouts.push(row);
      console.log(JSON.stringify({ id: row.id, ordinary: row.ordinaryActions, skills: row.skillActions, terminal: row.completionKind, winner: row.final.winner, reason: row.final.reason }));
    }
    for (let i = 0; i < result.rollouts.length; i += 2) assert.equal(result.rollouts[i].initialSecretSha256, result.rollouts[i + 1].initialSecretSha256);
    for (const seed of [93, 97]) for (const side of ["red", "black"] as const) {
      const row = rollout(seed, side, true, 140, true); result.skillExercises.push(row);
      console.log(JSON.stringify({ id: row.id, ordinary: row.ordinaryActions, skills: row.skillActions, terminal: row.completionKind, winner: row.final.winner, reason: row.final.reason }));
    }
    assert.ok(result.skillExercises.some((r: any) => r.skillActions > 0 && r.completionKind === "natural_terminal"), "at least one complete natural game exercises the new skill");
  }
  const all = [...result.rollouts, ...result.skillExercises];
  result.summary = { fixtureGroups: result.fixtures.length, pairedSeedColorConditions: result.rollouts.length / 2, pairedPolicyRollouts: result.rollouts.length,
    deliberateSkillExercises: result.skillExercises.length, completeRollouts: all.length,
    naturalTerminals: all.filter((r: any) => r.completionKind === "natural_terminal").length,
    budgetResignations: all.filter((r: any) => r.completionKind === "budget_resignation").length,
    pairedPolicySkillUses: result.rollouts.reduce((n: number, r: any) => n + r.skillActions, 0),
    totalActualSkillUses: all.reduce((n: number, r: any) => n + r.skillActions, 0),
    completedGamesWithActualSkill: all.filter((r: any) => r.skillActions > 0).length,
    runtimeFailures: 0, globalBalanceProven: false, humanPlaytest: false, formalScoringRun: false };
  result.status = "PASS_BOUNDED_LOCAL_EVIDENCE";
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result.summary, null, 2));
} catch (error: any) {
  result.status = "FAILED"; result.failure = { name: error.name, code: error.code, message: error.message, stack: error.stack };
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  throw error;
}
