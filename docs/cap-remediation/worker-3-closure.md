# Worker 3 closure — live Scene/Jev completion and prompt delivery

Date: 2026-09-29  
Repository: Bermieee/Area-52  
Branch: `Development-Worker-3`  
Starting main: `1de19e82a0083d5dfa70175bc0434dae45ee676c`  
Repair/test sequence reviewed through: `682da7a0eaf2476c0732cf6999264cd58a3bd8cd`

## Scope and evidence rule

This closes Worker 3's assigned cap rows 29, 30, 31, 32, 33, 35, 59 and 62, plus the two traced live Scene/Jev findings and the observed prompt-allocation/read-model failure. The 2026-09-29 17:10 export is treated as **live observation**, not as a synthetic reproduction claim.

Selected live generation: `440:23c2b5f7:1`.

Observed facts used to drive the trace:

- Foreground Scene work returned after about 3,986 ms, was admitted, and advanced Scene revision 2 -> 3. The same turn had no entity anchors at foreground preparation time, which is valid because the result arrived later.
- POST_RESPONSE Scene work returned after about 13,914 ms with Scene fields plus one ambiguity. The Result Bus routed it FRESH to BACKGROUND; owner consideration was still PENDING in the export. That export does not prove a permanent stall.
- The selected foreground Cognitive Choice separately said `JEV_UNAVAILABLE` with no synchronous physical attempt. This is a different seam from asynchronous Runtime/Result Bus Jev.
- The raw PromptPlan used a 4,096-token budget and planned about 3,806 tokens. Relevant Lore was **partially admitted**; the normalized ContextReceipt incorrectly classified the whole slot as deferred because it treated a partial remainder record as whole-slot omission.
- Prompt planning itself was about 21.9 ms; host preparation was about 2,143.5 ms and query embedding about 1,705 ms. No repair attributes the host preparation delay to the planner alone.

## Confirmed findings and repairs

### 1. Scene/Jev owner await had no enforced deadline

Confirmed in `src/deployment/brain.js` -> `adjudicateSceneObservationAmbiguity()` -> `SceneJevOwnerAdjudicator.adjudicate()`. The request carried 900/1,200 ms timestamps, but the owner awaited the Jev service without enforcing them.

Repair:

- `SceneJevOwnerAdjudicator` now enforces `input.deadline` with an owner-side timer.
- An internal `AbortController` is forwarded to the Jev service.
- External cancellation is accepted and forwarded.
- Every terminal path clears timer/listener state.
- Deadline and cancellation return explicit unresolved owner receipts rather than mutating Scene:
  - `JEV_ADJUDICATION_DEADLINE_EXCEEDED`
  - `JEV_ADJUDICATION_CANCELLED`
- The deployment path publishes a PENDING adjudication receipt before awaiting, then a terminal receipt afterward.

The repair does **not** split a dependent Scene proposal. Existing admission remains revision-fenced and atomic: accepted Jev advice may replace only the specifically ambiguous field; otherwise the proposal continues through ordinary Scene-owner admission without settlement authority.

### 2. Foreground Jev diagnostics conflated synchronous availability with asynchronous Jev work

Confirmed. Native Core has no asynchronous adapter in its synchronous seam. It may consume an already-standing, fresh NEXT_TURN advisory, but it must not block a sealed turn waiting for Runtime Jev.

Repair:

- `JEV_UNAVAILABLE` from the synchronous choice path now distinguishes:
  - `NO_FRESH_ADVICE_FOR_THIS_DECISION`
  - `SYNCHRONOUS_JEV_ADAPTER_UNAVAILABLE`
  - `SYNCHRONOUS_JEV_ADAPTER_FAILED`
- The read-model normalizer no longer treats a Cognitive Choice Jev summary as though it were a provider execution receipt.
- Unavailable/skipped choice summaries explicitly report `physicalAttempt:false`.
- `NativeJevAdvisory.diagnostics()` now separately reports service attachment/configuration, pending async work, failed execution, and owner rejection.

Current semantics remain advisory-only: standing async advice can inform a later Cognitive Choice while alternatives remain unresolved. It does not rewrite the prior sealed turn and does not receive Scene/Lore settlement authority.

### 3. Prompt-delivery gap was partly a read-model accounting defect

Confirmed against the live export and planner/read-model source. The raw plan already included a **partial** `RELEVANT_LORE` section; `createPromptPlanReadModel()` treated the partial deferred remainder as if the whole slot were omitted.

Repair:

- partial slots are now `state:'PARTIAL'`, `included:true`, `partial:true`;
- the deferred remainder stays visible, including deferred-entry count and reason;
- `createContextReceiptReadModel()` therefore includes the actually delivered Lore slot while still reporting the remainder as deferred.

No blanket context-limit increase was made. Required `CURRENT_SCENE` and `USER_INPUT` protections remain intact. The final host payload, not nomination count alone, is the acceptance surface.

## Cap dispositions

| Row | Disposition | Result |
| --- | --- | --- |
| 29 | FIXED | 320-character Scene query is now a bounded head+tail derived query with explicit coverage, preserving late-turn evidence without inventing entities. |
| 30 | FIXED | Reference families are counted before the stable bound; per-family coverage reports total/included/bounded-out refs. |
| 31 | FIXED | Traversal returns `HOP_LIMIT_REACHED` with a bounded continuation hint when the frontier is not exhausted; `NOT_FOUND` means graph exhaustion within the bound. |
| 32 | FIXED | Prefetch cache pressure evicts terminal rows, never ACTIVE work. Full ACTIVE capacity returns an explicit deferred recommendation and foreground-retrieval recovery. |
| 33 | VERIFIED_BY_DESIGN + OBSERVABILITY | The 12-claim generation-facing rank is retained. Canonical graph truth is not discarded; `claimCoverage` reports total/included/bounded-out claims. |
| 35 | FIXED | 12,000-character external evidence uses a head+tail transport excerpt with explicit partial coverage and retained artifact/source drillback. |
| 59 | VERIFIED_BY_DESIGN | The 128-entry `enqueueDeep` physical guard remains. A source-wide regression proves there is still no production caller; no fictitious backpressure machinery was added. |
| 62 | FIXED | Candidate ranking text uses a head+tail 1,600-character transport representation and records partial coverage/source drillback availability. |

## Test coverage added

`tests/worker3-scene-jev-publication.test.mjs` covers:

- delayed Jev deadline and provider abort propagation;
- external cancellation with a non-cooperative provider promise;
- choice-summary normalization and `physicalAttempt:false`;
- async Jev connection/pending/failure/owner-rejection diagnostics;
- partial-Lore PromptPlan/ContextReceipt accounting;
- installed SillyTavern host insertion of the actually admitted partial `RELEVANT_LORE` fragment, with the remainder still explicitly deferred;
- long Scene query head/tail coverage and ref bounds;
- hop-cap vs genuine NOT_FOUND plus bounded recovery;
- ACTIVE prefetch retention at capacity;
- 12-claim compiler coverage accounting;
- 12k external evidence head/tail + drillback;
- 1.6k Candidate Bus ranking text head/tail + drillback;
- source-wide proof that production has no `enqueueDeep()` caller;
- connected-resource timeout/abort returning `activeExecutions` to zero;
- terminal Runtime failure returning the Worker Director governor to `activeLeases:0`.

Existing acceptance expected on the draft PR includes Scene async/runtime lifecycle, Scene cognition owner/Jev integration, deployment live-host insertion, Candidate Bus, Cognitive Choice, browser-facing imports, syntax, and the repository-wide baseline-diff workflow. The PR's exact-head checks are authoritative; this document does not pre-claim a CI result.

## Commits

- `f23e530ba6f511ca626887fcb1b27098c4ff9f13` — bound Scene Jev and repair delivery diagnostics
- `6372d8585c934bc912e50f3b29c07f37cedd0ebd` — preserve bounded Scene and evidence coverage
- `bef3db32b5a5e7bc00950f9a02b3e95acee073c7` — retain full ref pool before intent bound
- `cbdffa9c1ae862685c7c6719983231dd9d9917c3` — report bounded claim coverage
- `14c1463d0c861567c204dca764694cba5852b0b8` — preserve Jev reason detail and physical attempt
- `a49e966efc8cdc370278fddd08f74f2ffb0dc2af` — add Scene/Jev publication cap regressions
- `54dfd4e9584b81d5db21786e3e712c466184d4f7` — document closure and cap dispositions
- `4ff6c8b35d7d150ef478ffac41107ca9dc7ad00d` — fix claim coverage finalize block
- `1790d81a9cd96b7f2878332ac7a9f0d96bc9f62a` — reconcile reviewed Scene/Jev assembly digests
- `dc5e79c6448530ecec15c8a2d9bfd9fb69396c04` — assert partial Lore reaches final host payload
- `fe98a54a5561ec484bc2927c15c8e5bbd6fc6347` — align host payload regression with installed evidence seam
- `ab6a8731dab58e5476bb2cb42dc8072e402979c7` — assert provider timeout/abort release connected-resource slots
- `682da7a0eaf2476c0732cf6999264cd58a3bd8cd` — prove terminal Runtime failure releases the Director lease

## Validation status

The prior Worker 3 head ran the repository workflows with all observed functional suites green; the only failing Main Owner Integration step was the development-assembly digest verifier, which reported the three intentional reviewed Worker 3 byte changes as undeclared drift. Commit `1790d81a...` updates the reconciliation overlay with those exact reviewed git-blob digests instead of weakening the verifier.

The final host-payload and lease-release assertions were added afterward. Exact-head GitHub Actions are the authoritative acceptance surface for those final commits; queued/pending checks are not counted as passed in this closure document.

## Acceptance still requiring a real provider

Synthetic and host-fixture tests can establish owner deadlines, routing, fencing, cancellation, diagnostics and payload construction. They cannot certify a real external Jev provider. Real-provider acceptance remains a separate live qualification step and must not be inferred from fixture tests.

## Merge state

**Do not merge.** This branch is intended to remain a reviewable Worker 3 draft PR targeting `main`.
