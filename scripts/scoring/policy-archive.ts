import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
export function digest(bytes: string | Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
export function verifyPolicyArchive(directory: string) {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  if (Object.keys(manifest.files ?? {}).sort().join(",") !== ["authoritative.jsonl", "actor_A_private.jsonl", "actor_B_private.jsonl", "rule_random.jsonl"].sort().join(",")) throw new Error("Incomplete policy archive");
  for (const [name, metadata] of Object.entries(manifest.files) as [string, any][]) {
    if (!/^(authoritative|actor_A_private|actor_B_private|rule_random)\.jsonl$/.test(name)) throw new Error("Invalid policy archive path");
    const bytes = readFileSync(join(directory, name));
    if (digest(bytes) !== metadata.sha256 || bytes.length !== metadata.bytes) throw new Error("Policy archive checksum mismatch");
    if (bytes.toString().trimEnd().split("\n").filter(Boolean).length !== metadata.rows) throw new Error("Policy archive row count mismatch");
  }
  return manifest;
}
