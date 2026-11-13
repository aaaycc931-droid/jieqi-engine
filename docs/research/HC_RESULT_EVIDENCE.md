# HC authority-result evidence, 2026-11-13

Task: `MAIN-HC-AUTHORITY-RESULT-EVIDENCE-20261113`, issued at handoff commit `d5d05f92df1be0b3fef43b22245c0a0c5cc25fbf`. Research branch: `codex/hc-result-evidence-20261113`. Fixed production source: PR22 `71145df45ad17215a3731e53150b6728e079e375` (open draft, not merged at intake).

Run from repository root with Node >=24:

```sh
node scripts/research/hc-result-evidence.ts
```

Final result: **13 cases passed, 0 failed**. This is seven H1 cases, five H2 cases, and one supporting H3 rematch case, not thirteen original game specifications. See [machine-readable evidence](../../review/hc-result-evidence/RESULTS_20261113.json), [run corrections](../../review/hc-result-evidence/RUN_LOG_20261113.md), and [scope manifest](../../review/hc-result-evidence/SCOPE_20261113.json).

## Observed boundaries

| Cases | Actual result | Consequence |
|---|---|---|
| H1 direct hero selection, deadline -1 / at / +1 | Before expiry selects the submitted hunter with no RNG; at/after expiry returns normally, selects warrior through two fixed-RNG calls and advances to RPS | Return is not an explicit original-command disposition |
| H1 host hero selection, deadline -1 / at / +1 | Host pre-advance commits random timeout selection; original call then throws `INVALID_PHASE` at/after deadline. Fixed-zero RNG chooses the requested hunter anyway | Even identical final choice does not prove the submitted choice was accepted; direct function and caller semantics differ |
| H1 first/already-ready preparation | First call locks two existing trap layers, second call returns identical public/host/guest projections, no extra RNG, revision remains zero | No-ID idempotent no-op is observable, but existing API supplies no original request association or duplicate disposition |
| H2 resignation then same ID | Legal RPS → playing → resignation commits finished/revision 1/system message. Repeating the exact command throws `INVALID_PHASE`; committed state remains unchanged | New rejection cannot negate old commit. This is resignation, not a capture-terminal prefix |
| H2 forfeit countercontrol | Finished same-ID forfeit returns duplicate, including a different actor at the raw function boundary; host hides the duplicate bit | Do not apply resignation's phase behavior to all terminal actions, or treat ID-only duplicate as actor-bound evidence |
| H2 Web positive control | Actual Web receive → actual host handle → snapshot; authority finished/revision 1 | Baseline for fault controls |
| H2 injected post-commit views exception | Actual Web catch emits same-transport-ID `error` with “房主拒绝了此操作。” then finished snapshot; authority is already committed | Error envelope is not necessarily an original rule rejection |
| H2 injected snapshot serialization exception | Committed authority remains finished/revision 1; Web shows synchronization failure and no frame reaches the recording native endpoint | Synchronization failure is separate from original result |
| H3 legal rematch | Same roomId, new hero-selection phase, old forfeit outcome absent | Room identity alone cannot distinguish matches |

## Method and source limits

Fixtures derive from existing `tests/bluetooth-host-room.test.ts` BTHOST-03/04/06/07, `tests/remote-room.test.ts` MODE-05 and forfeit duplicate, and `tests/hero-forms.test.ts` R4-FORM-18 resignation caller. New probes use production constructors/setup/actions without injecting game secrets, bypassing phase gates, or changing allowed modes. Synthetic own-choice results are recorded only for these public fixtures; no owner-only authority package was read or published.

The Web cases reuse `scripts/research/bluetooth-receipt-channel.ts`, which extracts actual complete Web functions, substitutes DOM renderers/native endpoints, and invokes a real `BluetoothHostRoom`. The one-shot `views` override throws after the production handle has assigned its action result; it does not test a naturally failing production projector. The serialization override attaches a throwing `toJSON` only to the newly returned guest projection on the publication call; it does not change authority. Both are explicitly test-only fault boundaries, restored in `finally`. The uninjected control follows the same caller chain. No device delivery, native queues, DOM completeness or reconnect timing is claimed.

The driver records exact submitted action, actor, deterministic clock values, phase/revision, permitted public message/event counts, RNG deltas, error and native-attempt types. Null counters mean no game state, not zero observed game events. Private RNG boards/history are not dumped. Initial driver mistakes and their correction are retained in the run log; no production changes were made to obtain passing tests.

## H3 contract implications

A (negotiated v2 hello) and B (negotiated v3 messages) both need original actor/request/payload/authority/match identity plus an action-specific disposition committed before projections. Neither can infer that information from return, current views, new errors, or the old ID-only tables. Preparation no-ops and timeout substitutions need explicit classification or remain unknown; no new game error code is proposed here. Forfeit and resignation need separate branches. A post-commit exception must never overwrite a proven accepted record with rejected.

The existing chaos lifecycle report remains source evidence: single I/O serialization is not global serialization; complete JSON without newline may be returned at EOF; callback-generation correlation is unproven. This run does not execute C1–C3 or certify native transport. Both protocols retain unknown without actual identity/record evidence. A's old-bridge reuse and B's dual-native version support remain candidate-specific concerns, not decisions made by these tests.

No production `src/`, `web/`, `android/` or package file changed. No protocol implementation, result ledger, mode admission, scoring, NET, merge, deployment or APK. No broad rerun of old 935 checks or original 110/56 matrices. Original 56/64 acceptance and half-chaos actual client delivery remain unverified. The delegated offline queue is complete; further meaningful result reconciliation needs a concrete adopted design/implementation, and native scheduling needs its own permitted evidence.
