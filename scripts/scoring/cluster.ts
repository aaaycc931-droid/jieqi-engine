import { createHash } from "node:crypto";
import { PolicySession, type WorldMask, type RpsStratum } from "./policy-session.ts";

/** Authority metadata only. No cluster IDs, hashes, roots or splits in PolicyInput. */
export class ClusterRegistry {
  #ids = new Map<string, string>();
  #roots = new Map<string, string>();
  register(id: string, ruleSeed: string, policySeed: string, split: "train" | "validation" | "test") {
    if (!id || !ruleSeed || !policySeed || !["train", "validation", "test"].includes(split)) throw new Error("Invalid cluster definition");
    const key = createHash("sha256").update(JSON.stringify([ruleSeed, policySeed])).digest("hex");
    // Any shared root is a related replay, not a new independent observation.
    const ruleKey = createHash("sha256").update(ruleSeed).digest("hex");
    const policyKey = createHash("sha256").update(policySeed).digest("hex");
    if (this.#ids.has(id) || [key, ruleKey, policyKey].some(k => this.#roots.has(k))) throw new Error("Cluster/replay already registered; cannot count it twice or split it");
    this.#ids.set(id, split); for (const root of [key, ruleKey, policyKey]) this.#roots.set(root, id);
    return Object.freeze({ cluster_id: id, split, seed_fingerprint: key, independent_empirical_n: null });
  }
}

export function createDiagnosticCluster(registry: ClusterRegistry, options: { clusterId: string; ruleSeed: string; policySeed: string; split: "train" | "validation" | "test" }) {
  const metadata = registry.register(options.clusterId, options.ruleSeed, options.policySeed, options.split);
  const sessions = [];
  for (const mask of ["00", "10", "01", "11"] as WorldMask[]) for (const stratum of ["A_initial_red", "A_initial_black"] as RpsStratum[]) {
    sessions.push({ mask, stratum, session: new PolicySession({ mask, stratum, ruleSeed: options.ruleSeed, policySeed: options.policySeed }) });
  }
  return { metadata, sessions, related_world_stratum_trajectories: 8, is_empirical_population_sample: false };
}
