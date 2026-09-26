# Scene Intelligence Completion Plan

> Worker 2 completion wave on `Development-Scene-Scanner`, reconciled to current main before feature edits.

## Goal
Close the remaining Scene-owned behavior from #97 and assigned child/shared cards without importing Sidecar/Jev, Memory, Core, UI, ScenePulse, or SceneRAG authority.

## Architecture
Keep the accepted Phase 1-3 Scene core. Add narrow Scene-owned services for smart snapshot/live-state safeguards, query decomposition, transition handoff nomination, atmosphere consumption, Jev owner review, operator utilities, and load qualification. Shared Core/Graph Walker/Jev services remain injected or referenced rather than duplicated. Repair the installed Scene read contract by projecting Native Brain Scene state through the canonical `SceneUiReadModel` contract.

## Authority constraints
- Scene observations/inferences never settle durable world truth.
- Jev proposals are advisory and never create Scene revisions on their own.
- Prefetch/query/handoff artifacts never schedule workers or decide Candidate Bus/Truth/Context Seal admission.
- Transition handoff never deletes raw dialogue or decides prompt inclusion.
- Atmosphere never becomes prose-style or fact-creation authority.
- Native one-resource behavior remains sufficient without external services.

## Work packages
1. Live-state completion: correction fence, smart snapshot selection, expanded temporal intent, bounded registry retention.
2. Continuity/retrieval: query planner, temporal-path retrieval, transition handoff, episode metadata, Scene graph-provider qualification.
3. Judgment/operator: atmosphere consumption policy, Scene Jev owner review, advanced scanner backend service.
4. Integration: Native Brain `readScene` → canonical `SceneUiReadModel`; preserve UI adapter contract.
5. Qualification/research: long-session/browser-load instrumentation, story-neutral goldens, ScenePulse/SceneRAG comparison and benchmark evidence.

## Shared-card closure rule
#203, #221, #177, and #183 remain open if their non-Scene owner or installed-host criteria are not demonstrated by this branch.
