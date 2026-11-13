# Local request / native generation / host result composition

This draft preserves the exact guest request before the native write and connects
the optional PR26 result owner to the final Web message consumer. An uncertain
native write can coexist with a real accepted result in the host's local owner;
the guest still reports an unknown game outcome. No result wire is introduced.

## Sources and isolation

- Parent: PR28 `58cc324ddc616d14234d0a8b1ad34696393fb280`, including C5
  `4bd8bf4ca79d4a1743d431a55fae2f43e6c37e3c` and its explicit-null fix.
- From PR26 `e88a5a6bce6732a29e887b10636c827cd3f2eab5`: reuse
  `src/host-result-ledger.ts` and `tests/host-result-adapter.test.ts` byte for byte;
  reuse its `src/bluetooth-host-room.ts` with one added read-only
  `resultTrackingActive()` method. Other src dependencies are identical between
  the two source trees. This is an isolated development composition, not a PR
  merge, replacement of engine main, or adoption of other branch work.
- Handoff continuation source `06dedf4798e6150bcd7c57b0831ff7c332af91d7`;
  this successor's active claim `32b071e67d0eef50ec011b96189095c2925c5ed4`.

## Exact boundaries

| Path | Implemented behavior | Still excluded |
|---|---|---|
| Guest send | Exact v2 action string and ID retained before native write; original selected local context captured; scoped status recorded only against that context | No accepted/rejected guest result, no retry, no persistence after page/owner loss |
| Pending memory | Per-session FIFO, 256 requests / 1 MiB raw UTF-8 by default; disconnect marks old records historical, fresh entries can continue | Eviction never reconstructs outcomes from snapshots; byte budget is raw bytes, not total heap |
| Host consume | Existing final C5 event admission followed by optional local companion; hero and resign use real `handleTracked` with a native-event attempt key | Other actions use existing legacy dispatcher; this is not general action-result coverage |
| Identity | Original host object + its result scope + fixed current physical guest + native instance/generation/role/sequence | Peer payload cannot select actor; local labels do not authenticate a reconnecting peer or agree on a shared match epoch |
| Lifecycle | CONNECTED event sequence is the floor so queued later messages survive; duplicate/old events are rejected; disconnect/reconnect/rematch or capability loss retires tracking | No cross-runtime atomicity after the final synchronous native read; a mid-call change makes resulting local evidence historical |
| Query | Original local owner only; no game clock, RNG, views or dispatch; local history remains labelled historical | No query or result message is transmitted; guest cannot call its remote host through this API |
| Default | Guest memory is attached to actual Web sending; ordinary host constructor still omits resultTracking | Optional host tracking requires explicit internal configuration; no new product mode, NET or feature gate is opened |

Wire IDs are stored along with exact raw input. Internal host attempt IDs use the
local native event identity, not the peer's claimed ID. A second arrival carrying
the same wire ID is a separate event, subject to existing engine rules; it is not
silently accepted as a retransmission. The companion can be attached once per
original host object. A new owner cannot read an old opaque token.

Retired optional tracking does not stop normal legacy gameplay. The Web caller
continues to rely on C5's native event gate before legacy dispatch. A later
CONNECTED, snapshot, error or pong does not turn retained unknown into accepted.
The local raw accessors are internal diagnostics; no private raw/board is returned
by `inspect()` and no raw log is published by the application.

## Verification

`TESTS.tap`: **137 passed, 0 failed**, including **28 new local composition
tests** and 109 existing affected checks. The suites overlap earlier phase runs;
do not add historical counts. New cases execute actual Web send/final-listener
functions, real BluetoothHostRoom/ledger and C5 native result shapes in a VM.
The existing six explicit-null checks run their documented JVM model, not Android.

Two deliberate source mutants were detected by focused tests: removing generation
binding, and promoting native written to game acceptance. The initial generation
mutant unexpectedly passed because the test also rolled sequence back; the test
was corrected to keep sequence forward for generation/instance/role cases. The
final two controls fail for the intended assertions. Production was never mutated.
See `FAULT_CONTROLS.json` and `scripts/research/local-result-fault-controls.py`.

One early new-test run was 22/23: the malformed-context fixture attempted to turn
an absent sequence into BigInt before calling production. The fixture now calls
the actual consumer directly. No production behavior was changed for that failure.

An expanded run was **130 passed / 22 failed** (`EXPANDED_INITIAL.tap`). All 22
failures are the historical native-source identity guard in
`tests/native-send-accounting.test.ts` (21) and module initialization of
`tests/research/ch-lifecycle-pending.test.ts` (1). A clean detached PR28 parent
reproduced **the same 22 failures and same hash pair** in
`BASELINE_STALE_EVIDENCE.tap`: current Java hash `4e52e33d...` versus saved old
evidence `53f5d62d...`. Those saved October artifacts predate C5; they were not
rewritten or relabelled as fresh runs. This draft does not claim a clean full suite.
The final applicable suite adds protocol/private-contract checks and passes 137.

The Web build and `git diff --check` pass. Build uses the repository's Node strip
transpiler; it is not a complete TypeScript type check. `MANIFEST.json` binds the
changed files, reused sources and test artifacts. No original native16/C1–C4 full
replay, full56/64, browser, JNI, radio, device, independent QA, merge, deployment or
APK was performed. The default-disabled host is not a released feature.

## Reproduce and next

```sh
node --test --test-reporter=tap tests/bluetooth-local-results.test.ts tests/host-result-adapter.test.ts tests/bluetooth-host-room.test.ts tests/research/ch-generation-web.test.ts tests/research/ch-generation-null-context.test.ts tests/bluetooth-receipt-correlation.test.ts tests/bluetooth-disconnect.test.ts tests/committed-output-channel.test.ts tests/bluetooth-private-contracts.test.ts tests/bluetooth-protocol.test.ts
python3 scripts/research/local-result-fault-controls.py
node scripts/build-web.ts
```

Next: run the new Web integration in a real browser against explicit local bridge
substitutes, checking module load, captured requests and lifecycle behavior. Device
and independent review remain separate. A future guest-authoritative result channel
needs a concrete identity/lifecycle/wire contract; this draft does not infer one or
enable automatic replay. Historical native evidence may be refreshed only against
its actual source and with explicit separation from the frozen October records.
