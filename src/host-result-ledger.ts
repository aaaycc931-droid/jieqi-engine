/** Optional internal host outcome records. No wire API or authentication policy.
 * Caller supplies already-authenticated actors and a unique authority/match scope.
 */
import { RuleError } from "./errors.ts";
import type { RemoteRoom } from "./remote-room.ts";
import type { BluetoothRoomAction } from "./bluetooth-host-room.ts";

export type TrackedHostAction = Extract<BluetoothRoomAction, { kind: "hero" | "resign" }>;
export interface HostResultScope { authorityId: string; roomId: string; matchEpoch: string }
export interface HostResultOptions { authorityId: string; matchEpoch: string; maxRecords?: number; maxBindingBytes?: number }
export interface HostResultQuery { scope: HostResultScope; transportId: string; action: unknown }
export type HostResultAnswer = { query: "invalid" } | { query: "valid"; outcome: "accepted" | "rejected" | "unknown"; ruleCode?: string };
export interface PreparedHostAttempt { readonly key: string; readonly binding: string; readonly action: TrackedHostAction; readonly actor: string }
interface ResultEntry { binding: string; bytes: number; answer: HostResultAnswer }
const unknown = (): HostResultAnswer => ({ query: "valid", outcome: "unknown" });
const bytes = (s: string) => new TextEncoder().encode(s).length;
const keyFor = (actor: string, id: string) => JSON.stringify([actor, id]);
const ruleRejections = new Set(["INVALID_PHASE", "INVALID_HERO", "HERO_ALREADY_LOCKED", "STALE_REVISION", "GAME_FINISHED"]);

function nonemptyOwnData(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d && "value" in d && d.enumerable && typeof d.value === "string" && d.value.trim() ? d.value : undefined;
}
function validScope(value: unknown): value is HostResultScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && ["authorityId", "roomId", "matchEpoch"].every(key => nonemptyOwnData(value, key) !== undefined);
}
export function hostResultScope(roomId: string, options: HostResultOptions): HostResultScope {
  const authorityId = nonemptyOwnData(options, "authorityId"), matchEpoch = nonemptyOwnData(options, "matchEpoch");
  if (authorityId === undefined || matchEpoch === undefined) throw new TypeError("Own nonempty authorityId and matchEpoch required");
  return { authorityId, roomId, matchEpoch };
}

export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  function encode(v: unknown, depth: number): string {
    if (depth > 64) throw new TypeError('JSON nesting limit');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object' || v === null || seen.has(v)) throw new TypeError('Expected acyclic JSON data');
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw new TypeError('Expected plain JSON object');
    if (Object.getOwnPropertySymbols(v).length) throw new TypeError('JSON symbol key');
    seen.add(v);
    let result: string;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) throw new TypeError('Sparse or extended JSON array');
      result = '[' + Array.from({ length: v.length }, (_, i) => encode(data(v, String(i)), depth + 1)).join(',') + ']';
    } else {
      if (Object.getOwnPropertyNames(v).length !== Object.keys(v).length) throw new TypeError('Hidden JSON property');
      result = '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + encode(data(v, k), depth + 1)).join(',') + '}';
    }
    seen.delete(v); return result;
  }
  function data(v: object, key: string): unknown {
    const d = Object.getOwnPropertyDescriptor(v, key);
    if (!d || !('value' in d)) throw new TypeError('JSON accessor or missing property');
    return d.value;
  }
  return encode(value, 0);
}


/** Immutable ledger snapshots. The host publishes one {room, results} reference.
 * Retention is FIFO, 256 records / 1 MiB binding bytes by default, not heap size.
 */
export class HostResultLedger {
  readonly #scope: Readonly<HostResultScope>;
  readonly #actors: ReadonlySet<string>;
  readonly #records: ReadonlyMap<string, ResultEntry>;
  readonly #bindingBytes: number;
  readonly #maxRecords: number;
  readonly #maxBindingBytes: number;
  readonly #active: boolean;

  constructor(scope: HostResultScope, actors: readonly string[], options: HostResultOptions, previous?: HostResultLedger,
    records: ReadonlyMap<string, ResultEntry> = new Map(), bindingBytes = 0, active = true) {
    if (previous) {
      this.#scope = previous.#scope; this.#actors = previous.#actors;
      this.#maxRecords = previous.#maxRecords; this.#maxBindingBytes = previous.#maxBindingBytes;
    } else {
      if (!validScope(scope) || actors.length !== 2 || new Set(actors).size !== 2 || actors.some(actor => typeof actor !== "string" || !actor.trim()))
        throw new TypeError("Exact host authority, match and two actors required");
      this.#scope = Object.freeze({ ...scope }); this.#actors = new Set(actors);
      this.#maxRecords = options.maxRecords ?? 256; this.#maxBindingBytes = options.maxBindingBytes ?? 1024 * 1024;
      if (![this.#maxRecords, this.#maxBindingBytes].every(n => Number.isSafeInteger(n) && n > 0)) throw new TypeError("Positive cache limits required");
    }
    this.#records = records; this.#bindingBytes = bindingBytes; this.#active = active;
  }

  scope(): HostResultScope { return { ...this.#scope }; }
  active(): boolean { return this.#active; }
  retire(): HostResultLedger {
    return this.#active ? new HostResultLedger(this.#scope, [], this.#scope, this, this.#records, this.#bindingBytes, false) : this;
  }

  prepare(actor: string, transportId: string, input: unknown): PreparedHostAttempt {
    if (!this.#active) throw new TypeError("Tracked host lifecycle closed; new authenticated owner required");
    if (!this.#actors.has(actor) || typeof transportId !== "string" || !transportId.trim()) throw new TypeError("Invalid tracked actor or attempt ID");
    const binding = canonicalJson(input);
    if (bytes(binding) > 48 * 1024) throw new TypeError("Action exceeds binding limit");
    const action = JSON.parse(binding) as TrackedHostAction;
    if (!action || !["hero", "resign"].includes(action.kind)) throw new TypeError("Tracked action not covered");
    const key = keyFor(actor, transportId);
    if (this.#records.has(key)) throw new TypeError("Fresh internal attempt ID required; this is not a replay API");
    return { key, binding, action, actor };
  }

  append(attempt: PreparedHostAttempt, answer: HostResultAnswer): HostResultLedger {
    const records = new Map(this.#records), size = bytes(attempt.binding);
    let bindingBytes = this.#bindingBytes;
    if (size <= this.#maxBindingBytes) {
      records.set(attempt.key, { binding: attempt.binding, bytes: size, answer: { ...answer } }); bindingBytes += size;
      while (records.size > this.#maxRecords || bindingBytes > this.#maxBindingBytes) {
        const oldest = records.keys().next().value!;
        bindingBytes -= records.get(oldest)!.bytes; records.delete(oldest);
      }
    }
    return new HostResultLedger(this.#scope, [], this.#scope, this, records, bindingBytes, this.#active);
  }

  /** Historical in-memory results remain readable after retirement ONLY through
   * the original local owner/scope. This does not authenticate a reconnected peer. */
  query(callerActor: string, rawQuery: unknown): HostResultAnswer {
    if (!this.#actors.has(callerActor)) return { query: "invalid" };
    let q: HostResultQuery, binding: string;
    try {
      q = JSON.parse(canonicalJson(rawQuery));
      if (!q || !validScope(q.scope) || typeof q.transportId !== "string" || !q.transportId.trim()) return { query: "invalid" };
      binding = canonicalJson(q.action);
    } catch { return { query: "invalid" }; }
    if (bytes(binding) > 48 * 1024) return { query: "invalid" };
    if (q.scope.authorityId !== this.#scope.authorityId || q.scope.roomId !== this.#scope.roomId || q.scope.matchEpoch !== this.#scope.matchEpoch) return unknown();
    const record = this.#records.get(keyFor(callerActor, q.transportId));
    if (!record) return unknown();
    if (binding !== record.binding) return { query: "invalid" };
    return { ...record.answer };
  }
}

/** Only reviewed pre-commit rule refusals are classified, not arbitrary exceptions. */
export function trackedRuleFailure(error: unknown): HostResultAnswer {
  return error instanceof RuleError && ruleRejections.has(error.code)
    ? { query: "valid", outcome: "rejected", ruleCode: error.code } : unknown();
}
export function trackedActionResult(before: RemoteRoom, after: RemoteRoom, attempt: PreparedHostAttempt, now: number, duplicate?: boolean): HostResultAnswer {
  const action = attempt.action;
  if (action.kind === "hero") {
    const selection = before.features?.heroSelection;
    const fresh = before.phase === "hero_selection" && selection && now < selection.deadlineAt &&
      !selection.confirmed[attempt.actor] && !before.featureSecret?.heroSelection?.choices[attempt.actor];
    if (fresh && after.features?.heroSelection?.confirmed[attempt.actor] === true &&
      after.featureSecret?.heroSelection?.choices[attempt.actor] === action.hero) return { query: "valid", outcome: "accepted" };
  } else {
    const fresh = before.phase === "playing" && before.game?.state.status === "playing" &&
      before.game.secret.processedActions[action.actionId] === undefined;
    if (fresh && !duplicate && after.phase === "finished" && after.game?.state.reason === "resign" &&
      after.game.state.revision === before.game!.state.revision + 1) return { query: "valid", outcome: "accepted" };
  }
  return unknown(); // ID-only duplicate or no reviewed disposition proves no acceptance.
}
