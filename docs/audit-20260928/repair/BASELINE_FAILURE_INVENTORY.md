# Wave 0 baseline failure inventory (98a4e438, Node 22.22.2)

48 failing tests in 21 files at audit baseline. Root-cause classes:

- **FIXED**: repaired and proven by reproduction.
- **STALE-FIXTURE**: the test used an object that production never uses; the test was aligned with production wiring.
- **PRODUCT-DEFECT**: behavior contradicts a documented contract; carried to a repair wave.
- **CONTRACT-DRIFT**: code or test changed intentionally on one side; the intended behavior needs an owner decision; left failing.
- **UI-DRIFT**: operator UI copy or structure changed after the tests were written; left failing pending the UI owner.

| # | File :: test | Root cause | Class | Disposition |
|---|---|---|---|---|
| 1–10 | deployment-brain.integration (10) | `observeScene` fed free-text atmosphere into `AtmosphereTracker` → TypeError (983256f) | PRODUCT-DEFECT (rehearsal boundary) | **FIXED 1cc3855**, 13/13 pass; `development-deployment-demo.mjs` rc=0 |
| 11–13 | worker1-scene-ft002-assembly #1, #3, #4 | Helper passed `memorySurface` as the consolidation interface; Native Brain requires `propose()` (6ef4b04); production attaches `memoryConsolidationProducer` | STALE-FIXTURE | **FIXED 559c47e** (pass) |
| 14 | worker1-scene-ft002-assembly #2 | Scenario 8: Scene Fan-Out ingress `REJECTED / SCENE_FANOUT_SELECTION_FENCE_MISMATCH` on `sourceRevisionSet` | PRODUCT-DEFECT (revision identity) | Carried to Wave 3 |
| 15–18 | coprocessor-wave3 (authority test), wave6-consolidation ×2, wave6-golden (consolidation) | Consolidation task declares `metadata.resourceClass:'DEEP_BACKGROUND'` (Wave 6); c72cd72 made `resourceClass` a strict profile-equality filter; profiles default to `STANDARD`; the installed Connections UI can't set it → "No eligible provider adapter" / DEGRADED | CONTRACT-DRIFT, installed impact (**new finding D14**: DEEP consolidation can't run on operator-connected resources) | Needs owner decision: is `DEEP_BACKGROUND` a profile class or a scheduling class? Left failing |
| 19 | coprocessor-wave6-golden (combined HOT/DEEP) | "foreground Green Room must not wait for DEEP consolidation": actual true | Follows from 15–18 (DEEP path degraded) | Re-check after the D14 decision |
| 20 | coprocessor-wave20-backend-closure #124 | `blocked.constraintFailures` undefined: the negotiation receipt shape differs from the test | CONTRACT-DRIFT | Left failing |
| 21 | coprocessor-wave14-connections (manual model id) | `selectResourceModel` of an unlisted model not qualified (false !== true at :173) | CONTRACT-DRIFT (qualification policy) | Left failing |
| 22 | client-repair-wave2 (failed optional execution) | Journal marks a failed Sidecar `failed:false` (:107) | PRODUCT-DEFECT candidate (diagnostics truthfulness) | Left failing; recheck in the Wave 4 telemetry work |
| 23 | coprocessor-wave8-stress | Bounded count 950 vs 700 | CONTRACT-DRIFT (bound changed) | Left failing |
| 24 | coprocessor-wave9-stress | Count 5 vs 3 | CONTRACT-DRIFT | Left failing |
| 25 | scene-clapperboard-handoff (installed path) | Core retirement receipt absent before completion on the installed path | PRODUCT-DEFECT candidate (Wave 2 context retirement) | Carried to Wave 2 |
| 26 | scene-completion-wave4-gaps (evidence link) | `SceneGraph.addEvidenceLink` now requires `ownerApproved=true`; test omits it | CONTRACT-DRIFT (gate tightened) | Left failing; owner confirms the gate |
| 27 | scene-completion-wave4-gaps (graph provider) | Scene provider edge CURRENT where HISTORICAL expected | PRODUCT-DEFECT candidate (temporal status) | Carried to Wave 5 |
| 28 | wave2 Settlement vocabulary | REJECT vs CONTRADICT | CONTRACT-DRIFT | Left failing |
| 29 | wave6 Front Face | Dimension clamp 1440 vs 960 | UI-DRIFT | Left failing |
| 30 | worker1-brain-lifecycle-causal-wave #262 | Scene retrieval-need reconciliation evidence falsy | Unclassified (needs trace) | Left failing |
| 31 | worker1-context-trust-delivery (retirement) | Context retirement proof falsy | PRODUCT-DEFECT candidate (Wave 2) | Carried to Wave 2 |
| 32 | worker1-scene-event-spine #113 | Scene obligation sceneId undefined | Unclassified | Left failing |
| 33 | worker1-scene-prefetch-trigger #112 | Receipt field undefined `.some` | Unclassified | Left failing |
| 34 | worker3-lore-neural-ui (105 hubs) | Rendered hierarchy label changed | UI-DRIFT | Left failing |
| 35 | worker4-causal-telemetry-report (late optional) | Distinct-facts flag false (:80) | Unclassified (telemetry) | Left failing |
| 36–48 | wave13-operator-ui (13) | Lore, Connections, Memory workspace copy and structure changed ("Unknown workspace: memory", missing labels, "CONFIG LOCKED") | UI-DRIFT | Left failing pending the UI owner |

Known-list file `ci/known-main-failures-9eef91c.txt` is stale (5 now pass). It will be regenerated at the final gate from the measured list, never edited by hand.

Assembly drift: 26 pre-existing UNEXPECTED_DRIFT paths, each traced to a post-acceptance `main` commit (09-26 to 09-28) that the lane manifests never recorded (see `assembly-drift-provenance.md`). Repairs add their own changed paths. Reconciliation is deferred to one reviewed overlay at the final gate; no digests are regenerated blindly.
