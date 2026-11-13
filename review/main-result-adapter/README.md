# Optional result recording in the real Bluetooth host

2026-11-13, Asia/Shanghai. Production source baseline is PR22 `71145df45ad17215a3731e53150b6728e079e375`. PR24 `f30f1f5541fd84ebbf6aa298a4bcc3e446adeb80` supplied the reviewed semantics; its later F1 correction at `6ba35636ecf5c69203225149a7b746893299b39b` is compatible as this draft's publication parent because that correction does not change production `src`. These local files do not replace or re-publish PR24's research files.

## Implemented

`BluetoothHostRoom` now has an optional `resultTracking` constructor option, `handleTracked(actor, transportId, action)`, `queryResult(actor, query)` and a copying `resultScope()` accessor. Tracking is disabled by default. No application, native bridge, wire parser or UI caller is connected to these methods in this draft.

The **actual host's single owner** holds `{ room, results }`. Legacy and tracked commands share its real dispatch function. The first tracked family is hero selection and resign, including existing phase/revision refusal and ID-only duplicate distinctions. Before dispatch, actual host time settlement is still separate. After dispatch, the new immutable record snapshot is allocated and then published with the returned authority using one synchronous owner assignment, before output advances/projects. Later output/clock failure cannot rewrite a saved accepted result as rejected. This is an in-process ordering property, not crash durability or a distributed transaction.

The host retains its real **two clock reads**, including a potentially later time for output. This corrects a limitation of using the independent PR24 research owner as the only host integration evidence. Queries use neither clock nor RNG, projection, game dispatch, nor authority mutation. They return only valid/invalid and accepted/rejected/unknown with an optional reviewed rule code; never the saved raw content, secret room or private board.

The full JSON action value is detached and bound canonically, with array order and extra fields preserved; non-data/lossy/accessor shapes are refused. Actor, original transport attempt ID, immutable authority ID, room ID and match epoch are bound separately. The HC r59 F1 finding was applied directly: all three scope fields must be own enumerable data properties containing nonempty strings. Missing/undefined/null/wrong-type/inherited/accessor scope data is rejected, not compared as undefined equality. Inputs to the query are structurally checked before scope comparison.

The tracked API requires fresh internal attempt IDs. A retained reused ID is refused before clock or execution. This is not a production retransmission/dedup policy: the caller must guarantee never reusing IDs in an authority/match, including after FIFO eviction; no automatic action replay exists. Unknown or missing records stay unknown. Limits default to 256 records and 1 MiB of binding bytes with FIFO eviction, not a precise heap bound or persistent database. Queries do not renew retention. Records larger than the configured retention budget can be absent even when the underlying action committed.

Successful rematch acceptance, disconnect and reconnect **retire further tracked dispatch** for that owner. Legacy gameplay remains available. Original retained records remain queryable locally by their original actor and exact original scope, solely as historical facts. This does not authenticate a reconnecting peer or grant a new match the old identity. No API reactivates tracking: a separately authenticated new owner/scope is required by a future caller integration. A new owner has no old records even if caller labels happen to be the same.

## Validation actually run

Node v24.22.1:

```
node --test --test-reporter=tap tests/host-result-adapter.test.ts tests/bluetooth-host-room.test.ts
```

**34 passed, 0 failed**: 26 new adapter cases plus 8 unchanged host cases. TESTS.tap is the final raw output. Initial execution passed 32 cases but lacked the dedicated advance-reentry guard probe. Mainline review identified that new optional tracking could call the first advance before the mutation guard; this was corrected and two targeted cases added. The first review suggestion assumed the old advance read time once. Direct re-reading of fixed PR22 blob `80659ebf86c6bfbe678f67cd7aff9f01a8fa151c` showed the old advance already advances twice; that suggestion was corrected before delivery. Final code preserves both old clock reads and wraps the entire advance operation in the guard. No claim of an old single-read behavior is made. Existing host tests cover normal RPS, play, hero/traps, forfeit, rematch and chat. New tests use the real host's natural setup and command dispatch, with explicit labels on fault injection/reflection-only negative probes.

Covered: pre-dispatch deadline/RNG failure; exact hero acceptance vs later rejection; real RPS→resign→finished; stale revision; earlier move's ID cannot authenticate a resign; postcommit output exception; query isolation; scope/actor/content/ID mismatch; missing-scope F1 and accessor guards; retention/eviction; lifecycle retirement; legacy/tracked output equality; differing second output clock; original double-advance timing with tracking enabled/disabled; reentrant advance refusal before any clock read or authority mutation. The room inspection in tests is a local research observation of the actual owner, never a product projection or room injection.

BASELINE.json verifies 36 baseline production/package blobs: 35 unchanged and exactly `src/bluetooth-host-room.ts` intentionally changed; `src/host-result-ledger.ts` is new. Original PR24's “all production files unchanged” source test was deliberately not reused after this intentional source change. No broad original suite, full web build, APK, devices, Android/JNI/radio, NET, mode acceptance or independent QA was run.

## Remaining boundaries

- Default application still calls untracked `handle`; production Web/native/wire integration and any protocol negotiation are unfinished.
- Local labels and actor parameters are supplied by a trusted internal caller. They are not credentials, session authentication or permission to query another player. A future wire adapter must authenticate before calling `queryResult` and must never expose it as a public trust-free endpoint.
- C4's pending-request memory and trusted native attach/generation continuity are not imported or implemented here; work proceeds separately.
- Only hero/resign have reviewed disposition mapping. Forfeit, preparation, moves, skills, and other kinds still use legacy code without fabricated tracked receipts.
- No new gameplay, mode opening, scoring rule, NET resume, merge, deployment or APK approval follows from this draft.

Only the listed changed/new files should be published; do not copy the local baseline tree over other branches. Publish as an isolated draft on the latest intended PR24 parent, preserve PR25/H10 and workline branches, and read back the exact increment.
