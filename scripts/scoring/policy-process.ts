import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isApprovedPolicyInput, type PolicyInput } from "./policy-observation.ts";

const worker = fileURLToPath(new URL("./policy-worker.ts", import.meta.url));
/** Only the fixed P0 program is supported; this is not an arbitrary plugin sandbox. */
export function decideIsolated(input: Readonly<PolicyInput>, memory: unknown, randomBytes: readonly number[]) {
  if (!isApprovedPolicyInput(input)) throw new Error("blocked_unqualified_policy_input");
  const request = JSON.stringify({ input, memory, randomBytes });
  if (Buffer.byteLength(request) > input.decision_budget.maxInputBytes) throw new Error("blocked_policy_input_budget");
  const child = spawnSync(process.execPath, ["--permission", `--allow-fs-read=${worker}`, "--no-addons", "--disable-proto=throw", "--disallow-code-generation-from-strings", worker], {
    input: request, encoding: "utf8", env: {}, cwd: fileURLToPath(new URL("./", import.meta.url)),
    timeout: input.decision_budget.workerTimeoutMs, maxBuffer: input.decision_budget.maxInputBytes,
  });
  if (child.error || child.status !== 0) throw new Error("invalid_policy_execution");
  const decision = JSON.parse(child.stdout);
  if (!input.command_catalog.some(intent => JSON.stringify(intent) === JSON.stringify(decision.intent))) throw new Error("invalid_policy_intent");
  return decision;
}
