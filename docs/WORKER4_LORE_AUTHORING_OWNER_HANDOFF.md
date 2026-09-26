# Worker 4 — Lore Authoring Owner Workflow Handoff

Branch: `Development-Lore-Authoring-Owner`  
Stacked base: `Development-Lore-Completion@1d3f8b8a399fe3320e54894a054d44ab73906e23` / PR #254  
Review PR: #261

## Scope

This implementation wave finishes reusable Lore-owner functionality for #120, #195, and the evidence-led reviewed-mutation rebuild card. It does not rerun FT004/live-demo qualification and does not absorb Worker 3 UI, Worker 1 Core delivery, or Worker 2 Scene ownership.

PR #255 is not required by this branch. Its reference-backed hierarchy evidence registry remains an independent optimization stack over #254.

## Semantic impact planner

`LoreSemanticImpactPlanner.plan({sourceId,fromRevisionId,toRevisionId})` produces a bounded exact-revision A→B plan from retained authored revisions and studied artifacts.

Reported change families include:

- claims/properties;
- entities and aliases;
- relationships;
- rules, restrictions and capabilities;
- temporal classification;
- unresolved/contradictory state;
- concepts and community/ontology membership;
- retrieval and compact representations;
- structure / human-Tree metadata.

The plan distinguishes meaning-changing and wording-only revisions, keeps exact source/revision drillback, and classifies dependency effects as `DIRECT`, `TRANSITIVE`, `REGENERATE`, `REINDEX`, `REVIEW`, or `PRESERVE`.

Only explicit dependency evidence is used. Revision-fenced study/representation/retrieval rows refresh when their exact source revision changes; unrelated source state is preserved. Tree metadata changes are organizational evidence and do not become semantic truth.

## Reviewed mutation operation matrix

| Operation | Canonical behavior | Input preservation |
| --- | --- | --- |
| CREATE | Publish one new exact authored source UID after review/commit | Existing sources untouched |
| UPDATE | Publish a new revision of one current source | Prior revision remains reconstructable |
| DELETE | Publish a REMOVED revision | Prior authored revisions retained |
| MERGE | Publish caller-supplied exact merged output from 2+ current inputs | Inputs preserved unless separately approved for deletion |
| SPLIT | Publish 2+ caller-supplied exact outputs from one current input | Original preserved unless separately approved for deletion |
| MOVE | Approved create-at-target + remove-old-source transaction | Old source history/reconstruction retained |
| TREE_ASSIGN | Publish same content with reviewed Tree metadata change | Exact authored content unchanged |

MERGE/SPLIT do not generate source text. Exact outputs must be supplied by the operator/caller/reconciliation consumer.

## Authority and lifecycle

`LoreReviewedMutationService` owns deterministic proposal validation and canonical commit.

Flow:

`create proposal -> REVIEW_READY -> approve or reject -> commit revalidation -> COMMITTED`

Possible fail-closed states include `REJECTED`, `STALE`, and `FAILED`.

Every proposal records:

- stable proposal ID and operation fingerprint;
- exact chat scope or explicit `GLOBAL_OPERATOR` scope;
- source revision fence and target expectations;
- evidence / learned artifact refs;
- bounded before/after preview;
- semantic impact plan;
- affected Tree paths;
- reconstruction state and audit ID;
- authority-negative model/Jev/inferred flags.

Proposal creation, approval and rejection do not mutate authored canon.

Commit requires explicit operator approval and revalidates:

- request scope;
- exact source revisions;
- stored operation fingerprint;
- target absence/current revision expectation;
- approval identity.

Successful commit writes only through Lore Study Runtime / Source Registry, publishes new source revisions, records Story-authority revision changes, queues normal study obligations, refreshes derived freshness, and emits invalidation/audit receipts.

Rejected, duplicate, stale, target-collision, fingerprint-tampered or scope-mismatched proposals do not silently mutate source.

## Recovery and restoration

Multi-write failure records partial revision events and attempts compensating writes from the proposal reconstruction map. Recovery status and compensation revision events are retained in the audit.

Restoration:

- requires the proposal to be committed;
- requires a fresh explicit operator decision ID;
- fails if committed output revisions have since changed;
- publishes append-only compensating revisions;
- never rewrites source history.

## Worker 3 owner contract

Published contract: `LoreAuthoringOperatorContract@2`, `mutationExtensionVersion:1`.

Reads:

- `read.mutationProposal({proposalId})`
- `read.mutationQueue({chatId?,status?,limit?})`
- `read.semanticImpactPreview(request)`
- `read.mutationAudit({proposalId})`
- existing Wave-7 progress / Draft Review / Final Preview / Settlement reads remain available.

Actions:

- `actions.createMutationProposal(request)`
- `actions.approveMutationProposal(request)`
- `actions.rejectMutationProposal(request)`
- `actions.commitMutationProposal(request)`
- `actions.restoreMutationProposal(request)`
- existing Wave-7 Tree/Merge actions remain supported.

Worker 3 PR #259 has an explicit handoff comment for adapting its seven UI proposal kinds to the new generic mutation extension. This contract supersedes the need to republish the older CREATE/UPDATE/DELETE-only `startSourceMutationBuild` session seam from PR #241.

No Worker 3 UI files are changed here.

## Focused qualification

Exact implementation head before this documentation-only handoff commit: `139824fd36987e2d08fe01ce2973b94b8fca36f3`.

Main Owner Integration run #187 / 36270583451 verified:

- semantic impact planner typed A→B changes and exact revision drillback;
- wording-only revision minimal semantic cone;
- temporal/unresolved transitions and unrelated-source preservation;
- CREATE / UPDATE / DELETE / TREE_ASSIGN approval + commit;
- MERGE / SPLIT / MOVE source preservation;
- reject / duplicate / stale no-op behavior;
- exact-chat scope and explicit global-operator mode;
- replay, target collision, snapshot/reload and audit recovery;
- commit-time fingerprint tamper rejection;
- bounded Worker 3 read/action contract;
- multi-write compensation/recovery.

Focused Worker 4 authoring-owner tests: **11/11 pass**.

Lore job: **102 pass / 1 fail**. The single failure is the inherited Wave-7/Worker-3 assembly assertion:
`assembled host exposes Wave 7 owner lifecycle while Worker 3 UI remains explicitly preview-only`.

Full assembled regression: **1502 pass / 25 fail** on the repository's existing cross-owner baseline failures.

Syntax/module-load: **351/351 source modules PASS; 178/178 test syntax PASS**.

The final documentation head must be rechecked separately before handoff is considered exact-head verified.

## Card reconciliation

### #120 — Semantic Lore Compiler

Keep In Progress. This wave implements the reusable meaning-level A→B diff and dependency impact backend while preserving exact source and the human Tree. Broader #120 ontology-refactoring/product acceptance remains.

### #195 — Semantic Diff + Dependency Impact Planner

Moved To Do -> In Progress. The core reusable planner and focused acceptance behaviors are implemented and tested. Consumer integration and stacked review remain.

### Evidence-led Lore proposal / reviewed mutation rebuild card

Moved To Do -> In Progress. The seven-operation owner backend, review/commit fences, audit/recovery and Worker 3 read/action contract are implemented. Worker 3 UI integration/assembled acceptance remains separate.

### #169 / #192 / #189

No completion credit taken. These are consumers of the new planner/mutation APIs and were not rebuilt in this wave.

## Known gaps / dependencies

- Worker 3 PR #259 must adapt its UI adapter from the older partial `startSourceMutationBuild` feature-detection seam to `mutationExtensionVersion:1` and the generic mutation actions.
- PR #255 is independent; this branch does not use its evidence registry.
- Full assembled repository CI still has unrelated baseline failures.
- No installed-host FT004 or live-provider delivery claim is made.
- #169/#192/#189 consumer workflows remain separate implementation work.
- No merge into `main` is authorized by this handoff.
