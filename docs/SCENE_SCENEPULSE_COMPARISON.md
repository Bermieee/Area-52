# Scene Intelligence — ScenePulse comparison

Status: completed research artifact for card #214. This is an architectural comparison, not a dependency declaration.

## Sources reviewed

- ScenePulse repository/README: https://github.com/xenofei/SillyTavern-ScenePulse
- ScenePulse changelog, including the v6.24 temporal validator: https://github.com/xenofei/SillyTavern-ScenePulse/blob/main/CHANGELOG.md

The public project describes per-message scene tracking, delta-mode merging, smart snapshot selection, a timeline/snapshot browser, manual refresh/edit controls, separate fallback generation, and a temporal validator with explicit flashback/time-skip/parallel intent plus anti-cascade behavior.

## Feature matrix

| ScenePulse capability | Area-52 position | Adopted pattern | Rejected / bounded pattern | Area-52 implementation and evidence |
| --- | --- | --- | --- | --- |
| Delta-mode scene state | Area-52 exceeds the tracker-only version by retaining field epistemology and revision fences | Apply only changed Scene fields and preserve unchanged accepted state | No full-state LLM rewrite is required for ordinary tracking | `delta-engine.js`, `live-state-assimilation.js`; completion test “native Scene live-state stays incremental…” |
| Smart snapshot selection | Adopt | Prefer field slices/current Scene/significant revisions over “last N” snapshots | Snapshot selection cannot grant truth or prompt inclusion | `SceneSmartSnapshotSelector`; completion contract tests |
| Temporal intent: continue / flashback / time-skip / parallel | Adopt and extend | Preserve explicit temporal intent and non-linear topology | A flashback/parallel observation cannot become current-world fact merely because it was retrieved | `temporal-state.js`, `scene-stack.js`; flashback/parallel/resume goldens |
| Anti-cascade temporal recovery | Adopt and extend | Corrections create a fence so stale inference cannot re-seed later state | Area-52 does not silently rewrite source narrative | `SceneReconciler.applyCorrection/guardProposal`; stale-correction regression |
| Manual correction | Adopt | Operator correction is a new evidenced Scene revision | Operator correction is Scene-local; it does not settle Lore/Memory/world canon | `operator-service.js`, `reconciliation.js` |
| Historical timeline / snapshot browsing | Adopt backend contract | Bounded Scene history and exact source/revision lineage | No unbounded snapshot requirement | `SceneRegistry`, operator `history()`, bounded retention stress |
| Rescan/full refresh | Adopt as recovery, not normal mode | Explicit rescan/rebuild when drift or operator request requires it | Full reconstruction is not the default for every turn | `operator-service.rescan`, refresh-required Scene runtime behavior |
| Separate model fallback | Optional only | Sidecar/Jev may help bounded ambiguity | Normal Scene tracking must not depend on remote model/provider | native Scene runtime + optional `SceneJevOwnerAdjudicator` |
| Structured tracker JSON injected into narrative generation | Reject as an Area-52 requirement | None | Scene state is produced through owner contracts; no tracker payload must be appended to story text | Scene owner/event/read-model contracts |
| Dashboard mood/tension data | Adopt only as inferred atmosphere | Evidence-backed expiring atmosphere may guide retrieval/cognitive attention | Atmosphere cannot become factual authority or recursively validate prose style | `atmosphere.js`, `atmosphere-policy.js` |
| Inventory / object tracking | Adopt with stronger epistemic separation | Track mention, visible/present, held, transfer, damage, destruction | Mention is never possession; durable ownership stays proposal-only | `object-state.js`, object continuity goldens |
| Debug/history export | Adopt metadata/reference approach | Exact revisions, evidence refs, graph/episode/history views | No raw prompt, hidden reasoning, or authority escalation | Scene UI/read model/operator contracts |

## Conclusions

ScenePulse validates several useful operator and recovery patterns: delta-first tracking, smart snapshot selection, explicit temporal intent, manual correction, and anti-cascade recovery. Area-52 adopts those ideas in Scene-owned, story-neutral contracts with stronger observation/inference separation and revision fencing.

Area-52 intentionally does **not** import ScenePulse as a runtime dependency, does not require its Together/Separate model extraction modes, and does not copy tracker payloads into narrative output. Optional models remain advisory accelerators for ambiguity; the native one-resource path remains sufficient for ordinary Scene state.

## Verification mapping

The relevant Area-52 exact-head suites are:
- `tests/scene-completion-wave4.mjs`
- `tests/scene-completion-wave4-gaps.mjs`
- `tests/scene-completion-wave4-stress.mjs`
- preserved `tests/scene-*.mjs`
- shared Scene Jev seam `tests/coprocessor-wave9-scene.test.mjs`

Card #214 needs this documented evaluation; it does not require Area-52 to depend on ScenePulse or to reproduce ScenePulse's UI.
