import { execFileSync } from "node:child_process";
import { mkdirSync, chmodSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ClusterRegistry, createDiagnosticCluster } from "./cluster.ts";

const output = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "lezi-policy-qualification-"));
if (output === "/" || output === process.cwd()) throw new Error("Choose a private evidence directory");
mkdirSync(output, { recursive: true, mode: 0o700 }); chmodSync(output, 0o700);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
const cluster = createDiagnosticCluster(new ClusterRegistry(), { clusterId: "P0-diagnostic-cluster-001", ruleSeed: "P0-fixed-diagnostic-rule-v1", policySeed: "P0-independent-fixed-policy-v1", split: "test" });
const conditions = [];
for (const { mask, stratum, session } of cluster.sessions) {
  const classification = session.runP0(8);
  const archive = session.save(join(output, `${mask}-${stratum}`), sourceCommit);
  conditions.push({ mask, stratum, classification, archive_files: archive.files, authority_attempts: session.journal.filter(r => r.kind === "attempt").length,
    committed: session.journal.filter(r => r.kind === "attempt" && r.outcome === "committed").length,
    rejected: session.journal.filter(r => r.kind === "attempt" && r.outcome === "rejected").length });
}
const summary = { schema: "lezi.policy_diagnostic_run.v0.1", interface_version: "original_jieqi_P0_v0.1", source_commit: sourceCommit, source_dirty: sourceDirty,
  study: "EP-HH-01", mode: "original_jieqi", background: "jian_xie", scope: "P0_prefix_flow_diagnostic_not_strength",
  diagnostic_clusters: 1, related_condition_trajectories: 8, decisions_cap_each: 8, conditions,
  fixed_seeds_are_diagnostic_not_population_sampling: true, independent_empirical_n: null, empirical_runs: 0,
  policy_strength_qualified: false, P1_qualified: false, full_match_validation_complete: false,
  new_modes_qualified: [], q: null, H: null, I: null, B: null, J: null, formal_scoring_status: "frozen", empirical_parameters_approved: false };
writeFileSync(join(output, "P0_FLOW_RESULTS.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ output, related_conditions: conditions.length, classification_counts: Object.fromEntries(["censored", "legal_terminal", "blocked", "invalid_execution"].map(k => [k, conditions.filter(c => c.classification.status === k).length])), empirical_runs: 0, formal_scoring_status: "frozen" }));
