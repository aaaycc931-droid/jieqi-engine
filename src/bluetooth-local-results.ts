/** Local-only composition of C4 request retention, C5 native generations and
 * PR26 host results. No wire messages, guest receipt authority or replay API.
 * Contexts must come from the local native bridge, never a peer payload.
 */
import { BLUETOOTH_GUEST_PLAYER, type BluetoothHostRoom, type BluetoothRoomViews } from './bluetooth-host-room.ts';
import { parseBluetoothEnvelope } from './bluetooth-protocol.ts';
import type { HostResultScope, HostResultAnswer, TrackedHostAction } from './host-result-ledger.ts';

export interface LocalResultContext { instance: string; generation: string; sequence: string; role: 'NONE' | 'HOST' | 'GUEST' }
export interface LocalRetention { maxRecords?: number; maxBytes?: number }
export type LocalRequestToken = Readonly<object>;
type WriteStatus = 'not_sent' | 'written' | 'unknown';
const size = (raw: string) => new TextEncoder().encode(raw).length;
const decimal = (s: unknown): s is string => typeof s === 'string' && /^(0|[1-9][0-9]{0,99})$/.test(s);
const compare = (a: string, b: string) => a.length !== b.length ? a.length - b.length : a === b ? 0 : a < b ? -1 : 1;

function own(value: unknown, name: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const d = Object.getOwnPropertyDescriptor(value, name);
  return d && 'value' in d && d.enumerable ? d.value : undefined;
}
function context(value: unknown): LocalResultContext | undefined {
  try {
    const c = { instance: own(value,'instance'), generation: own(value,'generation'), sequence: own(value,'sequence'), role: own(value,'role') };
    if (c && typeof c.instance === 'string' && c.instance.length > 0 && c.instance.length <= 128 &&
        decimal(c.generation) && decimal(c.sequence) && typeof c.role === 'string' && ['NONE','HOST','GUEST'].includes(c.role))
      return { instance: c.instance, generation: c.generation, sequence: c.sequence, role: c.role as LocalResultContext['role'] };
  } catch { /* Invalid native capability never grants continuity. */ }
  return undefined;
}
function same(a: LocalResultContext, b: LocalResultContext): boolean {
  return a.instance === b.instance && a.generation === b.generation && a.role === b.role;
}
function actionEnvelope(raw: string) {
  const e = parseBluetoothEnvelope(raw);
  if (e.type !== 'action' || typeof e.id !== 'string' || !e.id.trim() || !e.payload ||
      typeof e.payload !== 'object' || Array.isArray(e.payload)) throw new TypeError('Identified action envelope required');
  return e;
}
class Retained<T extends { raw: string }> {
  readonly records = new Map<LocalRequestToken, T>();
  readonly maxRecords: number;
  readonly maxBytes: number;
  bytes = 0;
  constructor(options: LocalRetention) {
    this.maxRecords = options.maxRecords ?? 256;
    this.maxBytes = options.maxBytes ?? 1024 * 1024;
    if (![this.maxRecords, this.maxBytes].every(n => Number.isSafeInteger(n) && n > 0)) throw new TypeError('Positive retention limits required');
  }
  add(record: T): LocalRequestToken {
    const token = Object.freeze({});
    if (size(record.raw) > this.maxBytes) return token;
    this.records.set(token, record); this.bytes += size(record.raw);
    while (this.records.size > this.maxRecords || this.bytes > this.maxBytes) {
      const first = this.records.keys().next().value!;
      this.bytes -= size(this.records.get(first)!.raw); this.records.delete(first);
    }
    return token;
  }
}

interface PendingRecord { raw: string; id: string; context?: LocalResultContext; local: WriteStatus; retired: boolean; settled: boolean; conflict: boolean }

/** Caller invokes remember at the actual send boundary, before the native call.
 * A local write result cannot settle the game outcome. There is deliberately no
 * accept-peer-answer method, and no automatic send/retry behavior.
 */
export class LocalPendingActions {
  readonly #store: Retained<PendingRecord>;
  #closed = false;
  constructor(options: LocalRetention = {}) { this.#store = new Retained(options); }
  remember(raw: string, selectedContext: unknown): LocalRequestToken {
    if (this.#closed) throw new TypeError('Pending owner retired');
    const e = actionEnvelope(raw), c = context(selectedContext);
    return this.#store.add({ raw, id: e.id!, context: c?.role === 'GUEST' ? c : undefined,
      local: 'unknown', retired: false, settled: false, conflict: false });
  }
  noteScopedWrite(token: LocalRequestToken, nativeResult: unknown, currentContext: unknown): void {
    const r = this.#store.records.get(token); if (!r || r.retired || r.conflict) return;
    const current = context(currentContext);
    if (!r.context || !current || !same(r.context, current)) { r.retired = true; return; }
    let local: WriteStatus = 'unknown';
    try {
      const status = own(nativeResult,'status'), attemptedValue = own(nativeResult,'attemptedContext'), attempted = context(attemptedValue);
      if (status === 'not_sent' && attemptedValue === null) local = 'not_sent';
      else if (status === 'written' && attempted && same(r.context, attempted)) local = 'written';
    } catch { /* Unknown includes malformed/legacy/missing native evidence. */ }
    if (r.settled && local !== r.local) { r.conflict = true; r.local = 'unknown'; return; }
    r.local = local; r.settled = true;
  }
  invalidate(): void { for (const r of this.#store.records.values()) r.retired = true; }
  retire(): void { this.#closed = true; this.invalidate(); }
  tokens(): readonly LocalRequestToken[] { return [...this.#store.records.keys()]; }
  original(token: LocalRequestToken): string | undefined { return this.#store.records.get(token)?.raw; }
  inspect(token: LocalRequestToken) {
    const r = this.#store.records.get(token);
    return r ? { retained: true, transportId: r.id, local: r.local, outcome: 'unknown' as const,
      historical: r.retired, conflict: r.conflict } : { retained: false, local: 'unknown' as const, outcome: 'unknown' as const };
  }
}

interface HostRecord { raw: string; id: string; internalId: string; action: TrackedHostAction; context: LocalResultContext }
const ownedHosts = new WeakSet<BluetoothHostRoom>();
export type LocalHostDelivery =
  | { handled: false; reason: 'stale' | 'uncovered' | 'invalid' }
  | { handled: true; token: LocalRequestToken; views?: BluetoothRoomViews; failed: boolean; error?: unknown };

/** One companion per original host owner. Startup watermark and receive sequence
 * prevent reusing an old local event, even after raw-record eviction. They do NOT
 * deduplicate a peer resending the same wire ID as a new event.
 * Unsupported actions remain the caller's existing legacy dispatch responsibility.
 */
export class LocalHostResults {
  readonly #host: BluetoothHostRoom;
  readonly #scope: HostResultScope;
  readonly #initial: LocalResultContext;
  readonly #readCurrent: () => unknown;
  readonly #store: Retained<HostRecord>;
  #watermark: string;
  #retired = false;
  #busy = false;
  constructor(host: BluetoothHostRoom, readCurrent: () => unknown, options: LocalRetention & { startContext?: unknown } = {}) {
    const c = context(readCurrent()), scope = host.resultScope();
    if (!c || c.role !== 'HOST' || !scope || !host.resultTrackingActive()) throw new TypeError('Active tracked host and native host context required');
    const start = options.startContext === undefined ? c : context(options.startContext);
    if (!start || !same(c,start) || compare(start.sequence,c.sequence) > 0) throw new TypeError('Admitted local startup context required');
    if (ownedHosts.has(host)) throw new TypeError('Original host already has a local result companion');
    this.#store = new Retained(options); this.#host = host; this.#scope = scope;
    this.#initial = c; this.#watermark = start.sequence; this.#readCurrent = readCurrent;
    ownedHosts.add(host);
  }
  private current(): LocalResultContext | undefined {
    let c: LocalResultContext | undefined;
    try { c = context(this.#readCurrent()); } catch { /* Fail closed. */ }
    if (!c || !same(this.#initial, c) || !this.#host.resultTrackingActive() || compare(c.sequence, this.#watermark) < 0) this.#retired = true;
    return this.#retired ? undefined : c;
  }
  retire(): void { this.#retired = true; }
  active(): boolean { return this.current() !== undefined; }
  tokens(): readonly LocalRequestToken[] { return [...this.#store.records.keys()]; }
  consume(raw: string, nativeEventContext: unknown): LocalHostDelivery {
    if (this.#busy) return { handled: false, reason: 'stale' };
    const current = this.current(), event = context(nativeEventContext);
    if (!current || !event || !same(this.#initial, event) || event.sequence === '0' ||
        compare(event.sequence, this.#watermark) <= 0 || compare(event.sequence, current.sequence) > 0)
      return { handled: false, reason: 'stale' };
    this.#watermark = event.sequence; // Consumed invalid/uncovered events cannot re-enter later.
    let e: ReturnType<typeof actionEnvelope>;
    try { e = actionEnvelope(raw); } catch { return { handled: false, reason: 'invalid' }; }
    const action = e.payload as TrackedHostAction;
    if (action.kind !== 'hero' && action.kind !== 'resign') return { handled: false, reason: 'uncovered' };
    const internalId = JSON.stringify(['local-native-event', event.instance, event.generation, event.sequence]);
    const token = this.#store.add({ raw, id: e.id!, internalId, action, context: event });
    this.#busy = true;
    try {
      // The current physical guest is fixed by this local entry, not an actor in raw JSON.
      const views = this.#host.handleTracked(BLUETOOTH_GUEST_PLAYER, internalId, action);
      return { handled: true, token, views, failed: false };
    } catch (error) { return { handled: true, token, failed: true, error }; }
    finally { this.#busy = false; this.current(); }
  }
  original(token: LocalRequestToken): string | undefined { return this.#store.records.get(token)?.raw; }
  inspect(token: LocalRequestToken): { retained: boolean; historical: boolean; answer: HostResultAnswer } {
    this.current();
    const r = this.#store.records.get(token);
    if (!r) return { retained: false, historical: this.#retired, answer: { query: 'valid', outcome: 'unknown' } };
    // Always query the original in-memory owner. No views, clock, RNG, wire, or dispatch.
    return { retained: true, historical: this.#retired,
      answer: this.#host.queryResult(BLUETOOTH_GUEST_PLAYER, { scope: this.#scope, transportId: r.internalId, action: r.action }) };
  }
}
