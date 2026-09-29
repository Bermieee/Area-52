# D7 / D11 trace: Truth, temporal/conflict semantics and native-path Jev

Status of both findings: **OPEN, blocked on owner rules that no document defines.** Nothing below is a fix; it is the trace, the exact missing rules and concrete proposals. Evidence labels: MOCK-HARNESS (fake SillyTavern host, story-bound golden lorebook `createGoldenDeploymentLorebook()`).

## 1. What the contracts already say (and the code already does)

| Contract | Where | Wired? |
|---|---|---|
| Lore carries `truthStatusHint` and bounded `temporalHints` to Truth; hints are evidence only, Truth stays authoritative | `docs/WORKER4_LORE_COMPLETION_HANDOFF.md` "Temporal semantics repair" | Yes: `lore-contextual-retrieval.js` computes them, `owner-knowledge-channels.js:122` honours them, an unknown hint becomes UNRESOLVED (fail closed) |
| A Lore conflict set (same subject and predicate, different values, at least one uncertain claim) is `UNRESOLVED` | `lore-source-registry.js` `conflicts()` | Yes, returned in every story query packet |
| Any unresolved claim makes its source's hint `UNRESOLVED` | `lore-contextual-retrieval.js` `truthStatusForArtifacts` | Yes |
| Truth: ambiguous evidence stays unresolved; graph proximity never settles | PROJECT_PLAN Gate E, `entityIdentityContract` | Yes in Truth Gate |
| Jev is optional; native path is native-first; a slot exists only when the host supplies configuration and an adapter | `docs/JEV_WAVE11_NATIVE_OPTIONAL_ARCHITECTURE.md`, `docs/NATIVE_BRAIN_COMPLETION.md` (`attachJevAdapter`) | Seam exists (`NativeBrain.attachJevAdapter`), nothing attaches it |
| With 2 or more unresolved alternatives and no adapter the choice controller reports `JEV_UNAVAILABLE` (not SKIP) | `cognitive-choice-controller.js` `evaluateJev` | Yes |
| The Jev seam on the Core is synchronous; async adapters must return through the coordinated Result Bus path | `evaluateJev` (throws on a thenable) | No native async path exists |

So the plumbing is correct end to end. The finding stays open because the *input* to it is wrong.

## 2. Measured trace for the golden world (MOCK-HARNESS)

Query: "Where can Eris find the Sun Blade now? The accounts are conflicting." Six authored sources: `tavern-intact` (at 3), `fire` (at 10, "The Ember Tavern burns down. The Sun Blade is destroyed in the fire."), `blade-report-a` (at 12, claimAt 9, "A recovered journal claims someone removed the Sun Blade shortly before the fire."), `blade-report-b` (at 13, claimAt 10, "A later recovered journal claims the Sun Blade survived the fire.").

1. Lore study extracted **two claims in total**: `entity:ember-tavern state "intact"` (CURRENT) and `entity:sun-blade type "destroyed in the fire"` (TIMELESS). The two journal entries produced **no claim at all**.
2. Because no claim carries UNCERTAIN, `store.conflicts()` is `[]`, and every source-level hint falls through `truthStatusForArtifacts` to its documented default `CURRENT` ("a current authored source revision with no explicit historical/conflict marker remains eligible as current source evidence").
3. All 12 Lore candidates reach Truth as `CURRENT`; Truth reports confidence MIXED (was HIGH at the audit; the difference comes from the recent-tail row), `packet.unresolved` is 0.
4. With no ambiguity, `evaluateJev` sees fewer than 2 alternatives and records `SKIP_JEV / JEV_NOT_REQUIRED` (D11).

Why no claim: `lore-study-engine.js` is a fixed list of sentence-shape rules. The UNCERTAIN rules (lines 341-362) only match `"(A) (witness) report/claim/rumor (that) (the) X (was) removed before the fire"` and `"... destroyed in the fire"`. "A recovered journal claims someone removed the Sun Blade shortly before the fire" does not fit (extra "recovered journal", "someone", "shortly"), and "A later recovered journal claims the Sun Blade survived the fire" has no rule. `metadata.at` and `metadata.claimAt` are not read anywhere in Lore Intelligence. `lore-study.js` (the older Core study used by the standalone deployment brain) does read both and models exactly this scenario; it is not the installed Lore path.

## 3. Exact missing rules

- **R1, attribution:** which statements are *reported* claims. Proposal: a sentence-shape-independent marker set (`claims|claimed|reports|reported|according to|rumou?r|journal|witness|allegedly|survived?|recovered`) that turns the sentence's subject/predicate/value into an `UNCERTAIN`, `unresolved` claim with `qualifier:'reported'`, whatever its shape.
- **R2, time semantics:** what `metadata.at` and `claimAt` mean (authoring/narrative order key vs in-world time) and their scale. Proposal: `at` is the source's position on the story timeline; `claimAt` is when an attributed claim was made; both are integers compared only within one lorebook.
- **R3, supersession:** when an event on the same subject at a later `at` makes an earlier state `HISTORICAL`. Proposal: a state claim (`intact`) on subject S becomes `HISTORICAL` when a later-`at` event claim on S (`burns down`, `destroyed`) exists; both stay stored, only the temporal class changes.
- **R4, conflict sets for attributed claims:** two `UNCERTAIN` claims about the same subject and slot with different values form a `LoreConflictSet` even when their predicates differ in wording (`removed-before-fire` vs `survived-fire` are both `fate`).

With R1-R4 in the Lore study engine the existing, already wired path would deliver: `tavern-intact` HISTORICAL, `fire` CURRENT event, both journals UNRESOLVED and one conflict set, Truth `packet.unresolved > 0`, and `evaluateJev` would report `JEV_UNAVAILABLE` (no adapter) or invoke Jev (adapter attached).

## 4. Proposals

1. **Owner decision (Lore/Truth):** accept R1-R4, or replace them. Deliverable once approved: port the temporal pass of `lore-study.js` into `lore-study-engine.js` behind a `TEMPORAL_PASS` revision (so it is a new compiler revision and old learned revisions go stale through the normal freshness path), with tests: golden world Truth classification (tavern HISTORICAL, journals UNRESOLVED, conflict set of size 2), incremental edit of one entry, and no change for lorebooks without `at`.
2. **Native Jev (D11), owner decision:** the installed host attaches nothing today. Two options, both documented-compatible: (a) attach the operator-configured Jev resource through a *NEXT_TURN advisory* path: the choice controller records `JEV_REQUIRED`, the request goes through the Runtime/Result Bus (same pattern as `adjudicateSceneObservationAmbiguity`), the result is admitted only against the same revision fence and can influence the *next* turn, never the sealed one; (b) keep native Jev absent (valid by contract) and only surface `JEV_UNAVAILABLE` to the operator. Recommendation: (a), because it reuses an existing pattern and leaves seals immutable. It needs a decision on the fence (turn revision vs world revision) and on which Jev resource is eligible.
3. Do **not** wire the deployment core's synchronous adapter into the native core: it reads deployment turn records (`this.turns.get(turnId)?.jevProposal`) and throws for native turn ids, so it would only convert `SKIP_JEV` into `JEV_UNAVAILABLE`.

## 5. Related evidence for the open D14 question (O2)

`docs/WAVE18_COPROCESSOR_JEV_NATIVE_PATH.md` (#88) describes `NativeHotDeepScheduler` as a *local cooperative scheduler*: HOT work has foreground priority, DEEP work "borrows spare capacity, checkpoints between slices, yields while the foreground reserve is active", and it "separates logical work IDs from physical resource slots". That is a placement/scheduling vocabulary; no document says a resource *profile* is typed `DEEP_BACKGROUND`. This strengthens, but does not settle, the reading that `metadata.resourceClass:'DEEP_BACKGROUND'` on the consolidation task is a scheduling hint that should not be a strict profile-equality filter (`capability-negotiation.js`). Still an owner decision.
