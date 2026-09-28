# Memory Retrieval Outcome Feedback — #39 / #118 production connection

## Scope

This connection closes the installed retrieval-outcome gap identified for #39 without rebuilding Reflection, consolidation, reconsolidation, maturation, or forgetting. #118 remains the owner of bounded plasticity/reconsolidation policy. The connection is noncanonical: retrieval outcomes change operational retrieval state only.

Audit base: `main@0632b2526435d9608b9dbb23f36446650e223821`.

## Production call path

1. Memory Historian emits owner-backed `CandidateNomination` records.
2. Candidate Bus preserves exact Memory nomination lineage: `artifactRef`, `artifactRevision`, source/dependency revisions, and representation revision.
3. Truth/Precision/Gather/Context Seal publish their existing receipts.
4. Native Brain builds a bounded `MemoryRetrievalFeedbackBatch` from those receipts only.
5. Response completion records first. Feedback is submitted as an L2 / NEARLINE `MEMORY_RETRIEVAL_FEEDBACK` Runtime obligation.
6. Memory owner revalidates exact artifact revision, source fence, dependent evidence freshness, and selected-story identity.
7. Memory applies accepted/rejected outcomes through existing plasticity APIs with `countRetrieval:false`; nomination-time retrieval counters remain nomination-time facts.
8. Existing reconsolidation policy applies the permitted bounded effect. Subsequent Historian nominations expose `plasticityPriority` and `retrievalFeedbackIsEvidence:false`.

No parallel event bus or task queue is added.

## Outcome classification

| Evidence | Feedback outcome | Quality signal |
| --- | --- | --- |
| Candidate nominated/retrieved | nomination counters only | none |
| Explicit stale/invalid/foreign-scope evidence | rejected mapping/outcome | none |
| Truth explicitly rejects a non-temporal candidate | `REJECTED_RELEVANCE_QUALITY` | rejected |
| Truth admits candidate downstream | `ACCEPTED_DOWNSTREAM` | accepted |
| Candidate appears in sealed context | `INCLUDED_IN_SEALED_CONTEXT` | accepted |
| Truth-usable candidate omitted/deferred with no rejection receipt | `OMITTED_OR_DEFERRED_NEUTRAL` | none |
| Missing Truth/downstream evidence | `OUTCOME_UNKNOWN` | none |
| Conflicting exact outcomes for one artifact revision | `MIXED_DOWNSTREAM_OUTCOME_NEUTRAL` | none |

Context Seal proves sealed-context inclusion. It does **not** prove host/provider delivery. Every feedback batch/receipt therefore reports `deliveryKnown:false` unless a separate future exact delivery contract is introduced.

## Identity and deduplication

Memory feedback identity is the exact Memory artifact ID + artifact revision, not a label, title, or nearby activity. Candidate merging may preserve multiple nomination IDs and candidate IDs, but one artifact revision produces one bounded outcome per batch.

The owner rejects:

- missing/mismatched artifact references;
- missing artifact revisions;
- stale/rebuild-required revisions;
- source-revision fence mismatches;
- stale dependent evidence;
- foreign-story mappings;
- mappings whose story scope cannot be proven.

Outcome IDs are stable over the selected chat/turn/generation/correlation identity plus exact artifact revision and downstream result. Applied/neutral outcomes are retained in the Memory snapshot, so replay/reload cannot amplify counters.

## Bounded operational effects

Accepted/rejected feedback updates only existing Memory plasticity counters and derived ranking/residency state. Feedback does not add evidence, factual support, settlement authority, confidence authority, or canonical mutation authority.

Co-retrieval feedback updates only a pre-existing association established by exact nomination-time co-retrieval. Outcome feedback does not create a new association merely because two artifacts were accepted together.

Corrections/deletions continue through the existing source-revision invalidation path, which marks dependent plasticity state stale/rebuild-required and prevents later feedback from applying to the invalid revision.

## Runtime and diagnostics

The Runtime obligation is deduplicated by the feedback batch identity and retains chat/turn/generation/correlation/source-revision fences. Recovered tasks reattach the existing Memory feedback executor; a selection mismatch is rejected.

Selected-turn/Diagnostics metadata exposes:

- feedback scheduled vs applied;
- batch/outcome counts;
- exact candidate → Memory artifact/revision mapping;
- stage/outcome/reason codes;
- owner accepted/rejected/deferred result;
- replay/deduplication and stale/scope rejection;
- before/after counters, nomination priority, residency and reconsolidation receipt;
- `supportAdded:false`, `retrievalUseIsEvidence:false`, `authorityChanged:false`, and `deliveryKnown:false`.

Raw story/Lore text, prompts, provider bodies, credentials and hidden reasoning are excluded.

## Acceptance coverage

`tests/worker2-memory-retrieval-feedback.test.mjs` covers exact accepted feedback, relevance/quality rejection, neutral omission/missing evidence, foreign-story and stale rejection, Candidate Bus lineage deduplication, co-retrieval bounded effects, replay/reload durability, subsequent owner-backed rank change, noncanonical authority, nonblocking response completion, and Runtime recovery.

Installed-host live acceptance remains a follow-up. A ranking change is evidence that the bounded policy effect executed; it is not a claim that retrieval quality improved.
