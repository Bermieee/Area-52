# Worker 3 — Brain Trace, Diagnostics, and UI Wiring Wave

Branch: `Development-Client-Repair-3`  
Reconciled base: `main@ea66ddce461803d5279b4497f6604e3d75d6def6` (Scene PR #252)  
Cards: #244, #259, #152. Producer/journal dependencies: #263, #250.

## Boundaries
This is a selected-turn UI/Diagnostics consumer. It does not implement Scene owner behavior, Core prompt semantics, provider-role rewriting, or optional-resource authority. Scene uses the owner-published `SceneUiReadModel`; the assembled host only applies selected chat/turn/generation/revision fences. Core #264 remains owner work.

## Producer → UI matrix
| Stage | Evidence consumed | Absent state |
| --- | --- | --- |
| Host observation | owner host receipt when published | NO_EVIDENCE |
| Scene | SceneUiReadModel / owner receipt | NO_EVIDENCE |
| Hot Cognition | owner read model / receipt | NO_EVIDENCE |
| Cognitive Choice | owner receipt | NO_EVIDENCE |
| Sensory / Retrieval | owner Sensory/Candidate receipt | NO_EVIDENCE |
| Truth | owner assessment | NO_EVIDENCE |
| Runtime jobs | owner Runtime receipt + job audit | NO_EVIDENCE |
| Jev / Sidecar / Vectoring | configured → qualified → attempt → return → owner accepted | exact lifecycle only |
| Gather | owner disposition | NO_EVIDENCE |
| Context Seal | owner admission receipt | NO_EVIDENCE |
| PromptPlan | owner plan | NO_EVIDENCE |
| Compiled / sealed delivery | owner compiled receipt | NO_EVIDENCE |
| Actual host delivery | SillyTavern boundary receipt | NO_EVIDENCE |
| Learning | owner learning receipt | NO_EVIDENCE |
| Memory / Lore | owner receipt/read model | NO_EVIDENCE |

Parent receipt linkage, duration and owner acceptance are displayed only when owners publish them; they are never inferred.

## Safety / retention
Journal history remains bounded by turns, entries and serialized bytes. Selected-turn export is metadata-only and excludes raw prompts, story/Lore bodies, credentials and hidden reasoning. Chat switches/regeneration use distinct journal identities; stale/foreign receipts fail the live coherence fence.

## Evidence classes
Deterministic CI covers the causal trace, six-job drilldown, missing producer, foreign identity, chat/regeneration isolation, duplicate capture coalescing, safe export, scheduler coalescing, long-turn reads and bounded host listeners.

Installed SillyTavern acceptance is not asserted here. Existing installed-host observations on Trello predate this exact head and remain separate until rerun.
