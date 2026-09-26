# Worker 4 — Client Repair Wave 4: Lore readiness to Brain handoff

Branch: `Development-Client-Repair-4`  
Base at wave start: `main@1bc78102eeafa8624be3726731e3f0038983d4a2`

## Observed demo evidence

The supplied real demo export showed substantial Lore operation: 105 entries were reported accepted/current/retrieval-ready; Sensory reported 16 nominations, Truth reported 16 CURRENT, and Gather reported 32 admitted results. It also showed a PromptPlan with about 499 tokens used from a 4,096-token budget while `RELEVANT_LORE` was deferred as `OPTIONAL_DEFERRED_BY_BUDGET`.

That evidence does **not** prove that a particular Lore entry was story-authorized, selected into the final PromptPlan, or delivered to SillyTavern. Worker 1 owns that final PromptPlan/host-delivery boundary.

The normalized Gather export showed admitted `owner-lore` result IDs but empty `evidenceRefs` and `sourceRevisionRefs`.

## Root causes and disposition

### 1. Global readiness was being confused with story authority

Before this repair, `LoreIntelligenceService.status()` could truthfully say an entry was learned/current and retrieval-ready, but Lore had no exact-chat read-authority state on main. The live `LoreOwnerRetrievalChannel` called the owner interface without a `chatId`, so the owner query was global.

Repair:
- Added exact-chat `LoreStoryAuthorityRegistry`.
- Discovery, acceptance-for-study, read authorization, learned/current, retrieval-ready, and candidate eligibility are now separate claims.
- SillyTavern discovery already carries `discovery.chatId`; explicit acceptance binds that discovered Lorebook to that exact chat.
- The live owner channel forwards the turn's exact `chatId`.
- An unbound/imported chat fails closed with `LORE_STORY_SCOPE_REQUIRED`.
- An accepted Lorebook can be removed from a story's read scope without altering authored Lore.
- Lore never gains Truth, Gather, Context Seal, settlement, mutation, or host-prompt authority.

### 2. Revision freshness was already strong; story scoping was missing

The existing study/runtime/index path already rejected stale learned material:
- source revisions are immutable;
- a changed/removed UID creates a new revision/study obligation;
- stale obligations are superseded;
- `publicSurface()` reports `STALE_OR_UNLEARNED` unless learned revision == current authored revision;
- contextual retrieval indexes only current learned revisions;
- Candidate Bus also fences source revisions against the current revision set.

This wave keeps those protections and adds story scope on top. A changed source remains authorized as a Lorebook identity, but it is excluded as `SOURCE_REVISION_NOT_LEARNED_CURRENT` until the new source revision is studied. A removed source is excluded as `SOURCE_REMOVED`.

### 3. Demo Gather provenance loss is downstream of the Lore producer

Lore producer nominations already carry:
- `candidateId`
- `sourceRevisionRefs`
- `evidenceRefs`
- `provenance`
- `authorityClass`
- exact source drillback metadata.

This wave additionally carries bounded source entry identity:
- `sourceId`
- `lorebookId`
- `uid`
- `sourceRevisionId`
- exact-chat authority scope
- eligibility/exclusion decision and reason.

The loss seen in the demo occurs in Native Brain's UI Gather read-model projection: `#uiGatherReceipt()` maps result routes down to result id, accepted, freshness, and destination. The Wave 8 Gather normalizer can retain source/evidence references when they are present upstream. This wave therefore does not broadly edit Worker 1/2/3 surfaces.

### 4. Repeated unchanged Lore acceptance did unnecessary Lore-owned rebuild work

`runStudy({scope:'DUE'})` is already incremental; it does not study all current entries every generation.

However, `acceptLorebook()` previously refreshed representation freshness and rebuilt ontology/hierarchy/retrieval even when a full discovered snapshot contained no source-revision changes. If a live caller repeatedly submits the same 105-entry snapshot, that is avoidable turn pressure.

Repair:
- unchanged accepted snapshots reuse current study/index state;
- no new study obligations are created;
- ontology/hierarchy/retrieval maintenance is skipped with `maintenanceReason: NO_SOURCE_REVISION_CHANGE`;
- changed/removed source revisions still force freshness maintenance immediately.

Worker 2 should profile call frequency and browser cost in the installed client. This repair removes the Lore-owned redundant rebuild but does not claim to solve non-Lore UI/journal/browser costs.

## Candidate/provenance contract for Workers 1–3

### Eligible Lore candidate

A candidate handed from Lore toward Brain is eligible only if all are true:

1. exact chat is bound;
2. Lorebook was explicitly accepted for study for that chat;
3. Lorebook is in that chat's read scope;
4. authored source revision is not removed;
5. learned revision is CURRENT and references that exact authored source revision;
6. retrieval index contains the current source;
7. candidate/summary contains no source outside the authorized source set;
8. downstream Candidate Bus/Truth/Gather freshness checks still pass.

Metadata-only candidate receipt:
```text
kind: LoreCandidateProvenanceReceipt
candidateId
retrievalRecordRef
sourceEntries[]: { sourceId, lorebookId, uid, sourceRevisionId }
sourceRevisionRefs[]
evidenceRefs[]
provenanceRefs[]
authorityScope: { chatId, lorebookIds[] }
authorityClass
decision: ELIGIBLE
reason: AUTHORIZED_CURRENT_RETRIEVAL_MATCH
normalizedRank
rawLoreIncluded: false
```

### Legitimate Lore exclusions

Current reason codes:
- `LORE_STORY_SCOPE_REQUIRED`
- `LORE_STORY_READ_SCOPE_EMPTY`
- `LOREBOOK_NOT_ACCEPTED_FOR_STUDY`
- `LOREBOOK_OUTSIDE_STORY_READ_SCOPE`
- `SOURCE_REMOVED`
- `SOURCE_REVISION_NOT_LEARNED_CURRENT`
- `SOURCE_NOT_RETRIEVAL_READY`
- `NO_AUTHORIZED_RETRIEVAL_MATCH`
- downstream revision rejection such as `OWNER_CURRENT_REVISION_MISMATCH`.

These exclusions are not PromptPlan budget failures.

## Worker 1 fixtures

Use `tests/fixtures/worker4-lore-readiness-fixtures.mjs`.

- Eligible/current fixture: selected chat + accepted/studied Harbor Lore + query `Harbor Gate`. It must produce an eligible Lore candidate with source identity/revision and exact-chat authority metadata.
- Legitimate exclusion fixture: the same learned Lore queried from `chat:worker4:imported-unbound` must yield `LORE_STORY_SCOPE_REQUIRED`.
- Unaccepted fixture: globally learned Quartz Archive queried from the selected chat remains excluded with `LOREBOOK_NOT_ACCEPTED_FOR_STUDY`.

If Worker 1 receives the eligible fixture and still emits `OPTIONAL_DEFERRED_BY_BUDGET` with ample remaining budget, that is downstream of Lore eligibility. If Worker 1 receives the exclusion fixture, absence of Lore is legitimate and must not be “fixed” by forcing Lore into the prompt.

## Worker 2 reproduction and performance handoff

For provenance loss, compare:
1. `LoreOwnerRetrievalChannel.receipt().candidateReceipts` — bounded entry/revision/authority metadata is present.
2. Native Brain `readGather()` / exported `NormalizedGatherReceipt` — if refs are empty, inspect `NativeBrain.#uiGatherReceipt()` projection before the UI normalizer.

For performance:
1. accept/study a large Lorebook once;
2. submit the identical full snapshot again;
3. verify acceptance reports `sourceRevisionChanged:false`, `maintenancePerformed:false`, `dueStudyObligations:0`;
4. profile installed-client call frequency and total time around discovery/acceptance/retrieval separately.

## Worker 3 producer contract

Worker 3 does not need Lore bodies to explain a result. It should display or retain only bounded metadata from the producer:
- Lorebook/UID/source identity;
- source revision;
- exact-chat scope state;
- eligible/excluded decision and reason;
- evidence/provenance refs;
- normalized priority/rank if useful.

Do not export `representationText`, exact authored Lore bodies, prompts, credentials, provider keys, or hidden reasoning.

## Remaining installed-SillyTavern checks

These require real installed-host evidence and are not claimed by unit/CI:
- select a Lorebook in SillyTavern, discover it, explicitly accept it, and verify the discovery chatId equals the active story chat;
- open/import a different chat and verify it does not inherit the first chat's Lore scope;
- edit one accepted UID, generate before restudy, and verify it is excluded as stale; then study and verify the new revision is eligible;
- remove one UID and verify it cannot appear current/retrieval-ready;
- inspect an actual Gather/Brain handoff and confirm metadata-only source/authority references survive;
- inspect PromptPlan and host-delivery receipts separately before claiming the model request contained Lore;
- profile a large current Lorebook over consecutive turns and confirm unchanged turns do not trigger repeated Lore maintenance.
