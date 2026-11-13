# Message alias admission repair and browser verification boundary

The final Web listener accepted both `type: "message"` and `event: "message"`,
but only the former passed through `admitLocalBluetoothEvent`. The event-only
alias could therefore dispatch a missing, stale, wrong-role or duplicate native
event. A stale event-only pong could also release the guest's pending action.
The production change adds the already-supported alias to the same admission
predicate. No wire field, game rule, result authority or retry policy changes.

## Source and authorization

- Parent: PR29, `38d40fc2494ce5464af8f91405249f8511524bbf`, branch
  `codex/main-local-result-session-20261113`; parent remains untouched.
- Mainline continuation claim: handoff `0c7d108dd74f06acdae9b8ab4ff7fe140ced67df`.
  The user's project instructions appoint this successor after the previous
  closeout; the user requested the next step. Existing bounded shared engineering,
  independent draft and repository maintenance authority is inherited.
- Scope arose during the authorized real-browser verification preparation.
  The current Java bridge emits `type: "message"`, not the alternate `event`
  field. The defect is proven at the Web listener's accepted alternate input;
  no real Android producer or radio incident using that alias was observed.

## Actual checks

| Check | Result and interpretation |
| --- | --- |
| PR29 source recovery | 47 source/build/test files matched their Git blob SHA before changes |
| Corrected new regression fixture against unchanged PR29 | 12 tests: 3 pass, 9 fail for the intended admission/duplicate/pending assertions |
| Fixed code, focused run | 66 pass, 0 fail; superseded for final reporting by the overlapping combined run |
| Final affected Node/VM regression | 104 pass, 0 fail, including 12 new cases and 92 existing cases |
| Web code build | Passed using the repository's Node TypeScript strip build; binary artwork was not restored in this environment |
| Real browser | Blocked before page execution; no browser scenario is claimed passed |

The 104 checks execute the actual source-extracted final listener, sending and
view functions with real room/result classes. DOM renderers and the native bridge
are explicit recording substitutes. The existing C5 suite consumes its saved
native fixture; it does not rerun Java or Android. This is not independent QA,
full suite acceptance, full type checking, Android/JNI/radio or original 56/64.
The pre-existing 22 historical native-evidence binding failures recorded by PR29
remain unchanged and were not relabelled or rerun here.

The initial new test file accidentally imported the older helper that does not
accept scoped bridge extras. That fixture was corrected before the valid parent
comparison. `INITIAL_WRONG_HELPER.tap` preserves that invalid diagnostic run;
only `PARENT_ALIAS.tap` is the valid parent control. Both happened to report nine
failures, but their conditions differ. The final test uses `ch-generation-channel`.

## Browser environment and next step

The first local Chromium attempt aborted before a page was created with
`socket() failed: Operation not permitted (1)` in `process_singleton_posix.cc`.
The provided cloud browser could not connect to the running local HTTP service:
`net::ERR_CONNECTION_REFUSED`. These are execution/network limitations, not
evidence that the user withheld authorization or that the application failed.
The user subsequently explicitly approved the required socket creation and cloud
browser connection. This permission is retained; the available environment exposes
no interface to apply the required runtime/network capability changes. No repeated
identical launch, security-control modification, external tunnel or deployment was
attempted. See `BROWSER_ENVIRONMENT.json`.

`scripts/research/browser-entry-smoke.mjs` is a prepared, syntax-checked entry
diagnostic for an environment with Chromium and Playwright. Its final form has not
been executed here; it is not the complete five-scenario browser harness.

```sh
node --test --test-reporter=tap tests/bluetooth-event-alias.test.ts tests/bluetooth-local-results.test.ts tests/host-result-adapter.test.ts tests/research/ch-generation-web.test.ts tests/bluetooth-receipt-correlation.test.ts
node scripts/build-web.ts
node scripts/research/browser-entry-smoke.mjs
```

Once a supported browser environment can run this branch, complete the retained
real-Web checks: module load, exact pre-send request retention, disconnect history,
queued messages after CONNECTED, and default-disabled host result tracking. Use an
explicit local native-bridge substitute. Include both accepted callback aliases
in the stale/duplicate checks. No user reauthorization of the same socket/connection
scope is required; an actual capability change must be verified before retrying.

## Protection and review limits

Only one production line changes. The optional host tracker remains disabled by
default; the two unready modes remain closed. NET, scoring and original ledgers
retain their existing restrictions. No merge, deployment, APK, new mode or game
rule is included. PR29, other worklines, assets and the independent UI branch are
preserved through base-tree reuse. The remaining lifecycle/browser uncertainties
are explicitly open; the repair does not authenticate arbitrary page JavaScript.
Parent failures and fixed results falsify the narrow missing-admission hypothesis,
but the test design is by the same agent and does not prove complete coverage.
