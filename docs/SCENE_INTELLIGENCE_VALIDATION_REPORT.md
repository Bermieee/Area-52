# Scene Intelligence continuation — validation and ownership report

This report covers the Scene Intelligence continuation on `Development-Scene-Scanner`. It is a review artifact only. It does not authorize integration into `main`.

## Immutable integration boundary

- `main` is read-only for this continuation.
- Last observed main while reconciling this wave: `ea66ddce461803d5279b4497f6604e3d75d6def6`.
- No revert, merge, cherry-pick, force update, or other main mutation is part of this wave.
- Core's unsupported outbound `context` provider role remains card #264 and is not masked by a Scene adapter.
- Scene remains non-canonical: it observes and publishes bounded evidence/signals; it does not own Truth, Settlement, Gather admission, Context Seal, PromptPlan admission, or durable world truth.

## Parallel-owner reconciliation

### Worker 1 — Brain/Core/Sensory

Current owner head reconciled: `Development-Nexus@0a2c1e620e0d5400a48b5ca61b3f4aafd0eea78c`.

Scene reconciliation commit: `4d99732403adbcfec85e6af2db5b96ad63042326`.

The post-snapshot Worker 1 delta changed Core/Sensory/Graph files and their tests/workflow. Scene accepted those owner files rather than reimplementing their semantics.

### Worker 3 — host/UI/Diagnostics

Current owner head reconciled: `Development-Client-Repair-3@142b78e4bc6d69d3e39e571951389c135c18a38e` (PR #253).

Scene reconciliation marker: `911ba1527a787c091199059307c22aca879dd5a4`.

Overlap was intentional and resolved as follows:

- Worker 3 remains owner of the selected-turn host/UI fence and Inspector/Diagnostics scheduling.
- The assembled host accepts only canonical `SceneUiReadModel` output and fences it by selected chat, Scene revision, and selected source revisions.
- Scene continuation retains the newer owner receipt, Scene flow, host-delivery observation, and FT002 evidence already layered around that seam.
- Worker 3 UI evidence/diagnostics files and load probes are preserved.
- The Scene branch does not add a host-side workaround for Core #264.

After reconciliation the Scene branch was observed 0 commits behind both current owner heads.

## FT002 edge evidence

Focused deterministic/assembled-host coverage verifies:

1. host narrative observation reaches Scene;
2. Scene lifecycle publishes a bounded owner receipt;
3. selected-turn `SceneUiReadModel` is canonical and revision-fenced;
4. Scene signal state is explicit;
5. fan-out is either `ADMITTED` or honest `NO_WORK`;
6. Gather reports admitted results or published no-work;
7. Context Seal is correlated to the same turn;
8. PromptPlan is correlated to the same turn/generation;
9. host delivery remains `UNAVAILABLE` until the actual request hook is observed;
10. `CHAT_COMPLETION_PROMPT_READY` produces an observed host-delivery receipt with matching PromptPlan/Context Seal IDs;
11. raw prompt/story/Lore/credentials/hidden reasoning are not stored in the metadata receipt;
12. Scene never receives canonical mutation, Settlement, or Context Seal authority.

Scenario coverage includes stable scene, explicit location/cast/time, mentioned-only cast exclusion, doorway false cut/no-work, confirmed travel transition, flashback/resume, source replacement/edit invalidation, regeneration/swipe/delete handling, and correction with bounded rebuild.

### FT002 acceptance status

**PARTIAL / IN PROGRESS.**

The deterministic and assembled-host path is green. This is not an installed-SillyTavern live pass. Card #177 remains open until the same scenario matrix is observed in an actually installed SillyTavern with exact chat/turn/generation/revision fences through:

`Scene observation -> selected-turn SceneUiReadModel -> Scene signals/jobs -> Gather -> Context Seal -> PromptPlan -> observed host delivery`.

## Stress / recovery evidence (#183)

Focused deterministic and real-browser qualification are green.

Implementation-head Scene workflow `36262570900` tested `911ba1527a787c091199059307c22aca879dd5a4`.

Real Headless Chrome 153:

- updates: 2,500
- batches: 25 x 100
- max batch: 34.3 ms
- total batch time: 737.1 ms
- long tasks: 0
- heap before: 876,714 bytes
- heap after: 2,389,718 bytes
- heap growth: 1,513,004 bytes
- retained snapshots: 96
- retained deltas: 192

The preserved Scene suite passed 160/160. Shared Scene/Jev seam passed 7/7.

### #183 acceptance status

**PARTIAL / IN PROGRESS.**

Browser and deterministic stress/recovery evidence do not satisfy the original installed-SillyTavern responsiveness requirement. Remaining installed-host evidence includes sustained session load, representative cast/location/time/boundary churn, correction/rollback, reload/resume, stale containment, event/backpressure, listener/coalescing behavior, long tasks, and heap-growth observation.

## Scene child/shared-card disposition

| Card | Scene-owned evidence | Overall status |
| --- | --- | --- |
| #97 | Owner lane and original child behavior substantially implemented | In Progress — blocked by live/shared acceptance below |
| #107 | Inferred atmosphere with evidence/confidence and non-canonical authority | Partial — downstream consumption is shared |
| #109 | Confirmed close/open, Episode finalization, transition event/prefetch, no raw-history deletion | Partial — active-context retirement/eligibility is Context-owned |
| #110 | Scene graph temporal/parallel/flashback/resume + evidence-backed cause/support | Partial — durable Memory graph ownership remains external |
| #112 | Scene publishes speculative prefetch intent | Partial — Dynamic Fan-Out execution is external |
| #113 | Scene publishes normalized immutable events without authority escalation | Partial — Event Spine/Worker Director consumption is external |
| #173 | Scanner/carryover backend, continuity gaps and promotion previews | Partial — visible operator/UI ownership remains external |
| #177 | Deterministic + assembled host FT002 path green | In Progress — installed ST proof still required |
| #183 | deterministic + Chrome stress/recovery qualification green | In Progress — installed ST sustained-load proof still required |
| #184 | Scene object presence/possession/state observations | Partial — durable world-state settlement is external |
| #203 | Scene graph provider works through shared bounded Graph Walker | Partial/shared — other owner providers/integration remain external |
| #213 | Optional Jev ambiguity seam preserves Scene owner authority | Partial until the full deterministic + sidecar-assisted + Jev + unavailable golden is demonstrated together |
| #214 | ScenePulse comparison artifact produced | Scene research work complete |
| #215 | SceneRAG comparison + semantic-vs-fixed benchmark now measures boundary coherence, retrieval precision/recall, event completeness, source traceability, temporal correctness, callback recovery, graph-neighbor usefulness, context size and rebuild scope | Scene research acceptance complete, subject to exact-head CI |
| #216 | bounded transition handoff/prefetch + targeted invalidation implemented | Partial — Context Compiler final decision is external |
| #217 | safe vibe consumption policy preserves inferred/expiring/disableable semantics | Scene policy complete; downstream compiler use remains shared |
| #220 | native live-state assimilation and bounded correction path | Scene owner work complete |
| #221 | semantic SceneEpisode/graph/retrieval and deterministic fixed-chunk comparison | Partial — Memory/Historian indexing and downstream admission are external |
| #35 | Scene query planner owner path | Scene owner work complete |

## Exact-head qualification policy

A green CI/browser pass is qualification evidence only. It must not be recorded as installed-host proof.

Before review, the final PR head must have:

- Scene Intelligence Completion exact-head success;
- Worker 3 Client Repair compatibility success;
- Diagnostics Turn Log success;
- Worker 1 compatibility success;
- broad integration result documented honestly, including inherited baseline failures if present.

The user alone decides whether or when the review PR is integrated.
