# H10 first preparation: bounded ordinary research

2026-11-13. Engine parent `71145df45ad17215a3731e53150b6728e079e375` (PR22). This is an isolated draft, not a merge, release, APK, or product-mode opening. PR24 result-ledger and hero-pilot work are separate branches.

The owner selected option 1 in mainline: first uniformly sample three distinct eligible stable piece bodies without replacement; implement only an ordinary H02 old-assassination / H10 / M04 opening with at least three candidates and timely selection. The exact confirmation was published at handoff `e7a581d1208479e5ab48d67dd96a77bc969cc0a5`, `worklines/main/confirmations/H10_FIRST_UNIFORM_THREE_20261113.json`. The original ordinary prefix is copied byte-for-byte, including its historical NOT EXECUTED status; it is not silently upgraded.

## Implemented scope

- Internal source-bound `STD-H10-PREPARATION` capability, issued from exact prefix and confirmation hashes; fixed room, stable actors, ordinary mode, rogue/front + wind/front + war_chariot. No wire/client option can grant it. It uses the existing trusted synchronous harness model, not a security boundary against arbitrary in-process code.
- Actual room create/join, pre-RPS complete packages, real RPS red/black assignment and final hero-intro completion now create the offer. Candidates use the same eligible revealed own-body constraints in this fixed ordinary opening, excluding general/decoy/stealth; sorted stable IDs are sampled through three shrinking pools. Default room RNG already uses rejection sampling. There are 15 eligible bodies here, so bounds are 15,14,13.
- The owner submits one actual offered ID. First shadow sets server-only host, uses=1, activation formal turn=0, readyOnTurn=8, preserving the existing successful shadow counter semantics. The public general remains the decoy, and no move, revision, formal turn or clock advances.
- The room choice call closes preparation immediately and clears the offer. `playerRoomView` includes temporary `ownWindPreparation` only for its owner, then removes it and omits hostId from this scoped owner projection. This adds no persistent host locator. Generic old Wind behavior outside the scoped branch remains unchanged. Actual frontend controls/rendering and wire command schema are not implemented or tested.
- Short/empty pools, timeout/decline, same-stage candidate changes and unrelated lifecycle are coverage stops, not adopted gameplay failure policies. Formal move/skill/clock and transport/exit/rematch entry are excluded from this preparation capability. Source preparation is not R1-R5 research permission.

## Evidence and reproduction

`node --test --test-reporter=tap tests/standard-h10-preparation.test.ts tests/standard-np32-research.test.ts tests/remote-room.test.ts tests/hero-forms.test.ts tests/bluetooth-host-room.test.ts`

Node v24.22.1: **102 passed, 0 failed**: 14 new H10 cases, 39 existing NP32 cases, 49 existing room/form/Bluetooth host cases. Final raw output is TESTS.tap. This is the relevant subset, not all repository tests/builds, independent QA, devices, or Android/wire acceptance. Two first-run new test assertions expected the wrong existing rejection code; adjusted to the actual `MODE_ADAPTATION_PENDING`/`NOT_PLAYER` boundaries, without changing production rejection behavior.

`node scripts/research/standard-h10-preparation.ts review/standard-h10-preparation/ACTUAL_T0.json`

ACTUAL_T0.json records a real setup and entropy draws. Only M04 selection is fixed to the approved research background. H10 candidates are actually drawn with unbiased Node crypto; the driver accepts no injected board, host, RNG tape or caller room. C0/C1 are two real choices from that same offer through the room API; public/opponent T0 projections match. They are **not** the original prefix's A/B path-host worlds. The original three-body example is not forced. No eight-ply prefix or R5 was executed, and no production frequency estimate is claimed. The exhaustive five-body sampler test proves the finite sampling kernel under uniform bounded draws, not full game balance.

Negative probes that deliberately change a candidate coordinate are labelled synthetic and used only to test the coverage stop, never as natural game reachability evidence. Room methods copy before applying random preparation, so failed random draws leave the supplied authority unchanged. The tests cover current-room duplicate/illegal choice stops; no network request ledger or transport retransmission guarantee is added.

## Remaining mainline work

The standard line can now review and run this T0-only source/evidence package on its own isolated test branch. G1 and the preparation part of G4 have concrete implementation evidence. G2 has confirmed >=3 sampling implementation evidence; shortage and failure policies remain open. G3 has three server projections and clearing evidence, while actual UI/client delivery remains open. Full G4 forward-prefix qualification, G5 true-royal legality/closed R5 atomic settlement, original A/B reachability and independent acceptance remain open. H02 shadow-step, whole Wind V3.1, scoring ledger, NET, and product `featuresReady=false` boundaries are unchanged.

No generic royal-safety or terminal-order fix is included. The older mainline `MAIN-BLUETOOTH-UNKNOWN-RESULT-RECONCILIATION-20261030` work remains queued independently.
