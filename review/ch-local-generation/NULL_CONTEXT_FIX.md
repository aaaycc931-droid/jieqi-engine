# C5-F1: preserve explicit null in native not_sent results

2026-11-13, Asia/Shanghai. Main-owned child of
`4bd8bf4ca79d4a1743d431a55fae2f43e6c37e3c`, branch
`codex/main-c5-null-context-fix-20261113`. The original C5 branch and all earlier
C1-C5 evidence remain intact. This fixes a concrete intake finding, not a new
protocol, result acknowledgement, or mode approval.

## Defect and minimal repair

`GameWebBridge.scopedResult` used Java `null` for an absent attempted context.
Android's [`JSONObject.put(String,Object)` documentation](https://developer.android.com/reference/org/json/JSONObject#put(java.lang.String,%20java.lang.Object))
specifies key removal for Java null; `JSONObject.NULL` preserves a JSON-null
entry. The old production response was therefore `{"status":"not_sent"}`.
The existing Web consumer only recognizes not_sent when `attemptedContext` is
explicitly null, so it classified that response as unknown and retained pending.
No false acceptance or automatic retransmission was observed.

The production change is one expression: use `JSONObject.NULL` in the absent
context branch. `web/app.ts`, native session ownership, wire v2, gameplay and
host result adapters are unchanged. A malformed arbitrary bridge response still
remains unknown; the Web validation has not been weakened.

The inherited JVM shim had retained Java null in its map, and the existing Web
test supplied explicit JSON null independently. C5 now overrides only the
required JSONObject put-null/sentinel serialization semantics locally. The old
PR22/C1-C4 shim file is unchanged, and the override remains a narrow test model.

## Actual validation

`scripts/research/ch-generation-null-context.py` compiles the unchanged session
and actual bridge sources against the corrected C5 model. Real bridge responses
for wrong instance, wrong generation, invalid JSON, and disconnected sending
all add zero output bytes. A valid write supplies a positive control. The new
Web tests consume those actual response strings through the production Web
functions; they do not separately manufacture the fixed response JSON.

| Check | Observed result |
|---|---|
| Parent bridge with corrected JSON model | All four zero-write responses omit attemptedContext; written remains written |
| Fixed bridge into actual Web functions | All four explicit-null not_sent responses clear pending; one scoped call each, zero legacy fallback/retry/ping |
| Fixed written response control | Existing one-action plus one-ping behavior remains; pending waits, unknown is false |
| New targeted tests | 6 passed |
| Existing affected Web consumer tests | 19 passed, including unknown/late result, no fallback, lifecycle and legacy paths |
| Combined | 25 passed, 0 failed; raw output in `NULL_CONTEXT_TESTS.tap` |

Commands, Node v24.22.1:

```sh
python3 scripts/research/ch-generation-null-context.py --bridge-ref 4bd8bf4ca79d4a1743d431a55fae2f43e6c37e3c
node --test --test-reporter=tap tests/research/ch-generation-null-context.test.ts tests/research/ch-generation-web.test.ts
git diff --check
```

Parent negative control and fixed regression both use the corrected JSON model.
The parent four omissions were observed and asserted separately; the new tests
require explicit-null responses and would reject those parent bytes. An earlier
intake differential also sent parent omission versus explicit null through the
same production Web functions: omission retained pending/unknown, explicit null
cleared both. The committed tests now bind this boundary to the real producer.

## Limits and retained evidence

These are JVM models with controlled Android/socket/JSON/Handler substitutes and
VM production Web functions, not Android/JNI/radio/WebView or real browser
validation. The narrow model is not a full org.json implementation. There is no
new cross-runtime atomicity or peer-identity claim. Old native16, original C1-C4,
PR24/26, full game suites, APK, full TypeScript typecheck, mode acceptance and
independent QA were not rerun or claimed. Original C5 AUDIT/NATIVE_RESULTS and
WEB_TESTS remain historical evidence for `4bd8bf4`; the new evidence is separate.

This is an isolated local engineering fix. Publication/readback belong to the
mainline coordinator; no merge, deployment, mode opening, scoring thaw or NET
resume follows from it.
