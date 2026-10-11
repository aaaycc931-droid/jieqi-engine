import { createHmac } from "node:crypto";
import type { RandomInt } from "../../src/types.ts";

/** Bounded rejection sampling; streams keyed by semantic committed occurrences. */
export class SemanticRandom {
  #key: string;
  #occurrences = new Map<string, number>();
  readonly audit: any[] = [];
  constructor(authoritySeed: string) { if (!authoritySeed) throw new Error("Missing authority seed"); this.#key = authoritySeed; }
  transaction(domain: string) {
    const occurrence = this.#occurrences.get(domain) ?? 0;
    const draws: any[] = [];
    const next: RandomInt = max => {
      if (closed) throw new Error("RNG transaction already committed");
      if (!Number.isSafeInteger(max) || max < 1 || max > 0x100000000) throw new RangeError("Invalid RNG bound");
      const index = draws.length, limit = Math.floor(0x100000000 / max) * max;
      let value: number, retry = 0;
      do { value = createHmac("sha256", this.#key).update(JSON.stringify([domain, occurrence, index, retry++])).digest().readUInt32BE(0); } while (value >= limit);
      const bounded = value % max; draws.push({ domain, occurrence, draw_index: index, max_exclusive: max, value: bounded }); return bounded;
    };
    let closed = false;
    return { next, draws, commit: () => {
      if (closed || (this.#occurrences.get(domain) ?? 0) !== occurrence) throw new Error("RNG transaction already committed or stale");
      closed = true; this.#occurrences.set(domain, occurrence + 1); this.audit.push(...structuredClone(draws));
    } };
  }
}
