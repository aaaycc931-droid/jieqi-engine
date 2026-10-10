import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sha256 } from "./research-log.ts";

const output = resolve(process.argv[2] ?? "review/scoring/2026-10-10");
const directory = join(output, "validation");
mkdirSync(directory, { recursive: true });
const related = ["tests/design-gap-runtime.test.ts", "tests/action-turn-contracts.test.ts", "tests/time-line-contracts.test.ts", "tests/game-modes.test.ts", "tests/hero-forms.test.ts", "tests/remote-room.test.ts", "tests/bluetooth-private-contracts.test.ts", "tests/mutation-rarity.test.ts"];
const definitions = [
  { id: "scoring_mechanism", args: ["--test", "--test-reporter=tap", "tests/scoring-mechanism.test.ts"], evidence: "scoring-mechanism.tap" },
  { id: "related_regression", args: ["--test", "--test-reporter=tap", ...related], evidence: "related-regression.tap" },
  { id: "build_web", args: ["scripts/build-web.ts"], evidence: "build-web.log" },
];
const results: Record<string, unknown> = {};
let failed = false;
for (const definition of definitions) {
  const result = spawnSync(process.execPath, definition.args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(directory, definition.evidence), text);
  const summary = text.match(/# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)/);
  results[definition.id] = { command: `node ${definition.args.join(" ")}`, exit_code: result.status, evidence_path: `validation/${definition.evidence}`, sha256: sha256(text), node_version: process.version, ...(summary ? { tests: Number(summary[1]), passed: Number(summary[2]), failed: Number(summary[3]) } : {}), ...(result.error ? { error: String(result.error) } : {}) };
  console.log(`${definition.id}: ${result.status === 0 ? "PASS" : "FAIL"}${summary ? ` (${summary[2]}/${summary[1]})` : ""}`);
  if (result.status !== 0) failed = true;
}
writeFileSync(join(directory, "results.json"), JSON.stringify(results, null, 2) + "\n");
if (failed) process.exitCode = 1;
else {
  const accepted = spawnSync(process.execPath, ["scripts/scoring/run-acceptance.ts", output], { stdio: "inherit" });
  process.exitCode = accepted.status ?? 1;
}
