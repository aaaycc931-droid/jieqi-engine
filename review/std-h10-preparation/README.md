# Ordinary branch: independent bounded PR25 T0 review

Date: 2026-11-13 (Asia/Shanghai). Fixed engine input: 4ae702ea33bfaf728cc7ea78f092975bdc68b342, PR25 open/draft at review. Handoff/task input: a29d40304d97c3bb98fcfed8894ea44a83c47b5f, MAIN-STD-H10-T0-IMPLEMENTATION-REVIEW-20261113. This task explicitly permits the 14 new T0 tests, driver and own research negatives. No production source changes.

## Actual execution

Node v24.22.1. Commands executed once each:

```sh
node --test --test-reporter=tap tests/standard-h10-preparation.test.ts > review/std-h10-preparation/BASE14.tap
node scripts/research/standard-h10-preparation.ts review/std-h10-preparation/ACTUAL_T0.json
node --test --test-reporter=tap tests/research/std-h10-preparation-review.test.ts > review/std-h10-preparation/REVIEW3.tap
```

14 existing H10 tests passed; 3 additional branch checks passed; 0 failures/skips. One standalone driver completed. This is this branch's independent execution, not independent human QA or formal mode acceptance. The upstream 102-test report was read but its other 88 cases were not rerun.

The new checks add: late second/third draw errors (range and thrown error) leave the supplied authority unchanged and permit actual clean retry; altering detached owner projections cannot rewrite an offer, and all three original choices close and clear projections; a separately issued capability with identical room/player strings cannot consume another capability's registered authority. Fault-injected entropy is a negative control, not natural sampling evidence. Alternative choices consume the same original immutable API return as separate research branches, not a wire replay/dedup guarantee.

## Actual driver result

Three entropy bounds 15/14/13, indices 2/2/12. Offer: covered-02 at (2,0), covered-03 at (3,0), covered-14 at (8,3). C0 chooses covered-02 and C1 covered-03. These are real generated stable engine IDs, not the old illustrative black_pawn_0 etc. No host/board/offer was installed by the reviewer. All pieces are face-up despite the legacy covered-* ID names.

Both successful choices have uses=1, activatedOnTurn=0, readyOnTurn=8, revision=0, no formal turn lifecycle or clock, and the same public board as preparation. Offer state is cleared; scoped owner view omits hostId. Public/opponent projections of these two choices match. This is server JSON only; actual UI, transport delivery and same-device switching remain untested. C0/C1 do not stand for the original A/B path-host worlds.

## Source review and limits

Read all five changed/new production-source diffs, the full 72-line wind-preparation implementation, upstream tests/driver, README/MANIFEST, relevant stored ACTUAL_T0 fields, TAP totals, and the mainline first-sampling confirmation. All 12 upstream manifest entries match their hashes; both fixture texts exactly equal their handoff sources. Existing raw 102-case timing output was not an independent rerun. No product readiness or Bluetooth gate changed.

G1: actual room preparation success independently reproduced; local product/BT not covered. G2: confirmed uniform-without-replacement >=3 kernel and stable-body binding covered; missing/short pools, timeout/decline and candidate change remain coverage stops, not product policy. G3: scoped server projection and clearing reproduced; real client/UI still open. G4: T0 capability enforced in covered room APIs; forward formal actions not admitted. The trusted in-process capability is not a security sandbox against arbitrary code or reflection. G5, 8-ply prefix, R5, true-royal legality and terminal risks R1/R2 were not executed or closed.

No new defect observed in this bounded review. New source evidence or a new task is needed before further qualification work. No broad rerun, game merge, deployment, APK, scoring thaw or NET work. Engine evidence stays on the dedicated ordinary review branch; the ordinary handoff records this result without filling mainline receipt fields.
