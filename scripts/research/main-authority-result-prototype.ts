/** Offline design prototype, pinned to PR22. Not imported by the app or bridge.
 * The caller owns authenticated actor/scope assignment. This is NOT a wire API,
 * cross-reconnect authentication, or a production result service.
 */
import { RuleError } from '../../src/errors.ts';
import { normalizeGameMode } from '../../src/modes.ts';
import {
  advanceRemoteRoomTime, playerRoomView, publicRemoteRoom,
  submitRemoteHeroSelection, surrenderRemoteRoom,
  type RemoteRoom,
} from '../../src/remote-room.ts';
import type { BluetoothRoomAction, BluetoothRoomViews } from '../../src/bluetooth-host-room.ts';
import type { RandomInt } from '../../src/types.ts';

export type CoveredAction = Extract<BluetoothRoomAction, { kind: 'hero' | 'resign' }>;
export interface ResultScope { authorityId: string; roomId: string; matchEpoch: string }
export interface Attempt { actor: string; transportId: string; action: CoveredAction }
export interface ResultQuery { scope: ResultScope; transportId: string; action: unknown }
export type Answer = { query: 'invalid' } | {
  query: 'valid'; outcome: 'accepted' | 'rejected' | 'unknown'; ruleCode?: string;
};
interface RecordEntry { binding: string; bytes: number; answer: Answer }
interface OwnedState { room: RemoteRoom; records: Map<string, RecordEntry>; bindingBytes: number }

// Exact JSON value binding: sorted object keys, preserved array order/null/extra
// fields. No application defaults or ignored-field normalization. Non-JSON data
// is rejected instead of being silently dropped by JSON.stringify.
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

const ruleRejections = new Set(['INVALID_PHASE', 'INVALID_HERO', 'HERO_ALREADY_LOCKED', 'STALE_REVISION', 'GAME_FINISHED']);
const unknown = (): Answer => ({ query: 'valid', outcome: 'unknown' });
const keyFor = (actor: string, id: string) => JSON.stringify([actor, id]);
const bytes = (s: string) => new TextEncoder().encode(s).length;

// ResultScope is a runtime boundary as well as a TypeScript shape. Never let
// absent identifiers compare equal through undefined, or evaluate accessors.
function validScope(scope: unknown): scope is ResultScope {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return false;
  const names = ['authorityId', 'roomId', 'matchEpoch'];
  if (Reflect.ownKeys(scope).length !== names.length) return false;
  return names.every(key => {
    const d = Object.getOwnPropertyDescriptor(scope, key);
    return !!d && d.enumerable && 'value' in d && typeof d.value === 'string' && !!d.value.trim();
  });
}

export class OfflineAuthorityResultPrototype {
  readonly #scope: Readonly<ResultScope>;
  readonly #actors: ReadonlySet<string>;
  readonly #random?: RandomInt;
  readonly #maxRecords: number;
  readonly #maxBindingBytes: number;
  readonly #project: (room: RemoteRoom) => unknown;
  #state: OwnedState;
  #busy = false;

  constructor(options: {
    scope: ResultScope; room: RemoteRoom; randomInt?: RandomInt;
    maxRecords?: number; maxBindingBytes?: number;
    /** Fault injection only; never evidence that production naturally throws. */
    projectionForTest?: (room: RemoteRoom) => unknown;
  }) {
    if (normalizeGameMode(options.room.mode.baseMode) !== 'jieqi' || !validScope(options.scope) || options.scope.roomId !== options.room.roomId)
      throw new TypeError('Exact jieqi scope required');
    const guest = options.room.seats.guest?.playerId;
    if (!guest || guest === options.room.seats.host.playerId) throw new TypeError('Two distinct bound players required');
    this.#actors = new Set([options.room.seats.host.playerId, guest]);
    this.#scope = Object.freeze({ ...options.scope }); this.#random = options.randomInt;
    this.#maxRecords = options.maxRecords ?? 256;
    this.#maxBindingBytes = options.maxBindingBytes ?? 1024 * 1024;
    if (![this.#maxRecords, this.#maxBindingBytes].every(n => Number.isSafeInteger(n) && n > 0)) throw new TypeError('Positive cache limits required');
    this.#state = { room: structuredClone(options.room), records: new Map(), bindingBytes: 0 };
    this.#project = options.projectionForTest ?? (room => ({
      publicRoom: publicRemoteRoom(room),
      host: playerRoomView(room, room.seats.host.playerId),
      guest: playerRoomView(room, room.seats.guest!.playerId),
    } satisfies BluetoothRoomViews));
  }

  /** Offline evidence only. Never broadcast this private authority copy. */
  inspectForResearch(): RemoteRoom { return structuredClone(this.#state.room); }

  // No clock, RNG, projection, engine dispatch, or state assignment in queries.
  query(callerActor: string, q: ResultQuery): Answer {
    if (!this.#actors.has(callerActor)) return { query: 'invalid' };
    const scope = q && typeof q === 'object' ? Object.getOwnPropertyDescriptor(q, 'scope') : undefined;
    if (!scope || !('value' in scope) || !validScope(scope.value)) return { query: 'invalid' };
    if (scope.value.authorityId !== this.#scope.authorityId || scope.value.roomId !== this.#scope.roomId ||
        scope.value.matchEpoch !== this.#scope.matchEpoch) return unknown();
    if (typeof q.transportId !== 'string' || !q.transportId.trim()) return { query: 'invalid' };
    let binding: string;
    try { binding = canonicalJson(q.action); } catch { return { query: 'invalid' }; }
    if (bytes(binding) > 48 * 1024) return { query: 'invalid' };
    const record = this.#state.records.get(keyFor(callerActor, q.transportId));
    if (!record) return unknown();
    if (binding !== record.binding) return { query: 'invalid' };
    return { ...record.answer };
  }

  /** Each research attempt has a fresh ID. Reuse is a harness error, NOT a
   * proposed production dedup/conflict policy. This method does not replay.
   */
  handle(input: Attempt, now: number): unknown {
    if (this.#busy) throw new TypeError('No reentrant research dispatch');
    if (!this.#actors.has(input.actor) || typeof input.transportId !== 'string' || !input.transportId.trim() || !Number.isFinite(now))
      throw new TypeError('Invalid research attempt');
    const binding = canonicalJson(input.action);
    if (bytes(binding) > 48 * 1024) throw new TypeError('Action exceeds binding limit');
    // Bind and execute the same detached value even if the caller later mutates its object.
    const action = JSON.parse(binding) as CoveredAction;
    if (!['hero', 'resign'].includes(action.kind)) throw new TypeError('Action not covered by this prototype');
    const key = keyFor(input.actor, input.transportId);
    if (this.#state.records.has(key)) throw new TypeError('Fresh research transport ID required');
    this.#busy = true;
    try {
      // PR22 host advances time before dispatch. A failure here has no action
      // disposition; absence remains unknown rather than becoming rejection.
      this.#state = { ...this.#state, room: advanceRemoteRoomTime(this.#state.room, this.#random, now) };
      const before = this.#state.room;
      let next = before, answer = unknown(), failure: unknown, failed = false;
      try {
        if (action.kind === 'hero') {
          // This exact pinned success branch excludes expiry/no-op/disabled sources.
          const selection = before.features?.heroSelection;
          const fresh = before.phase === 'hero_selection' && selection && now < selection.deadlineAt &&
            !selection.confirmed[input.actor] && !before.featureSecret?.heroSelection?.choices[input.actor];
          next = submitRemoteHeroSelection(before, input.actor, action.hero, this.#random, now,
            { form: action.form, variant: action.variant });
          if (fresh && next.features?.heroSelection?.confirmed[input.actor] === true &&
              next.featureSecret?.heroSelection?.choices[input.actor] === action.hero)
            answer = { query: 'valid', outcome: 'accepted' };
        } else {
          const fresh = before.phase === 'playing' && before.game?.state.status === 'playing' &&
            before.game.secret.processedActions[action.actionId] === undefined;
          const result = surrenderRemoteRoom(before, input.actor, action.expectedRevision, action.actionId, now);
          next = result.room;
          if (fresh && !result.duplicate && next.phase === 'finished' && next.game?.state.reason === 'resign' &&
              next.game.state.revision === before.game!.state.revision + 1)
            answer = { query: 'valid', outcome: 'accepted' };
          // ID-only duplicate has no actor/content proof: deliberately unknown.
        }
      } catch (error) {
        failed = true; failure = error;
        // Only reviewed pre-commit rule guards. Unknown errors stay unknown.
        if (error instanceof RuleError && ruleRejections.has(error.code))
          answer = { query: 'valid', outcome: 'rejected', ruleCode: error.code };
      }
      this.#commit(next, key, binding, answer);
      if (failed) throw failure;
      // Mirrors host views' second advance, after the action record is committed.
      // Any projection/time-output failure cannot rewrite the old action result.
      this.#state = { ...this.#state, room: advanceRemoteRoomTime(this.#state.room, this.#random, now) };
      return this.#project(structuredClone(this.#state.room));
    } finally { this.#busy = false; }
  }

  #commit(room: RemoteRoom, key: string, binding: string, answer: Answer): void {
    const records = new Map(this.#state.records), size = bytes(binding);
    let bindingBytes = this.#state.bindingBytes;
    if (size <= this.#maxBindingBytes) {
      records.set(key, { binding, bytes: size, answer: { ...answer } }); bindingBytes += size;
      while (records.size > this.#maxRecords || bindingBytes > this.#maxBindingBytes) {
        const oldest = records.keys().next().value!;
        bindingBytes -= records.get(oldest)!.bytes; records.delete(oldest);
      }
    }
    // One synchronous owner publication, before projection. No durability/crash
    // guarantee; if allocation fails before publication no new room is published.
    this.#state = { room, records, bindingBytes };
  }
}
