# Lore Authoring Owner Workflow Design

## Context

Worker 4's current Lore backend on PR #254 already preserves exact authored source, studies source revisions, exposes semantic edit previews, proposes Tree/merge changes, and has a reviewed Final Preview -> approval -> Settlement -> restoration lifecycle.

The remaining gap is reusable owner functionality. The current semantic report covers claims, relationships and concepts but does not expose a complete typed A -> B meaning diff or the smallest truthful dependency cone. The mutation lifecycle is specialized to Tree and merge workflows instead of exposing one typed proposal/review/commit contract for all authoring operations.

This wave stacks on PR #254 only. PR #255's reference-backed hierarchy evidence registry is not required for source-revision semantic diff or canonical mutation and remains an independent stacked optimization.

## Goals

1. Finish #120/#195's reusable semantic-diff and dependency-impact backend.
2. Add the owner backend required by the Area-52 rebuild evidence-led proposal/reviewed mutation card.
3. Preserve exact authored Lore, human Lore Tree, provenance, historical revisions and unaffected derived state.
4. Give Worker 3 bounded read/action APIs without changing UI files.
5. Reuse current Source Registry, Study Runtime and settlement/recovery semantics; do not introduce an external DB, SQL service, orchestrator or required provider.

## Semantic A -> B contract

Add a reusable planner over exact source revisions.

For an exact source revision pair it produces a bounded `LoreSemanticImpactPlan` with:

- source/revision identities and exact hashes;
- semantic additions, removals and changes grouped by:
  - CLAIM;
  - ENTITY;
  - ALIAS;
  - RELATIONSHIP;
  - RULE / capability or behavioral constraint;
  - TEMPORAL status;
  - contradiction/unresolved state;
  - CONCEPT / ontology/community;
  - RETRIEVAL / compact representation;
  - STRUCTURE / taxonomy-hierarchy metadata;
- wording-only vs meaning-changing classification;
- before/after bounded artifact descriptors with exact evidence/source drillback;
- direct dependency edges from the old revision;
- transitively affected aggregate artifacts;
- required restudy/recompile/reindex work;
- unaffected artifact/source counts and retained refs.

The planner must not invalidate broad systems merely because a source revision number changed. Wording-only edits whose studied semantics are equivalent still require the changed source revision to be studied/fenced, but unrelated semantic aggregates remain reusable unless their explicit dependency is the exact changed revision. Directly revision-fenced representations/retrieval rows are always stale when their source revision changes.

Tree-path metadata changes are reported separately from semantic source-text changes. A Tree move does not become semantic truth.

## Dependency cone

The impact planner walks only explicit dependency evidence available in Area-52:

- learned study artifacts for the changed source revision;
- multi-resolution representations fenced to that source revision;
- navigation summaries whose source revision sets contain the revision;
- contextual retrieval records fenced to the source revision;
- ontology/community rows with source-revision provenance;
- structure/taxonomy placement metadata;
- proposal/reconciliation artifacts when their recorded source revision fence includes the revision.

The output distinguishes `DIRECT`, `TRANSITIVE`, `REGENERATE`, `REINDEX`, `REVIEW` and `PRESERVE`. Missing dependency evidence is reported rather than guessed.

## Generic reviewed mutation workflow

Add a Lore-owned proposal service supporting typed operations:

- `CREATE`
- `UPDATE`
- `DELETE`
- `MERGE`
- `SPLIT`
- `MOVE`
- `TREE_ASSIGN`

Every proposal is authority-negative until explicit operator approval and successful commit.

A `LoreMutationProposal` contains:

- stable proposal ID and operation fingerprint;
- operation kind;
- story/chat scope when supplied;
- exact source IDs and current source revision fence;
- exact target Lorebook/UID identities;
- supporting learned artifact/evidence refs;
- bounded before/after preview;
- semantic impact plan;
- affected Tree paths and downstream artifact cone;
- provenance/reconstruction data;
- status and audit receipts;
- `modelMutationAuthority:false`, `jevMutationAuthority:false`.

### Operation semantics

- CREATE: creates one new authored source UID.
- UPDATE: replaces one current source revision with new exact content/metadata.
- DELETE: publishes a REMOVED source revision; prior authored revisions remain recoverable.
- MOVE: changes exact authored content/metadata from one UID to another only through an explicitly approved delete+create owner transaction; source history is preserved in audit/reconstruction.
- TREE_ASSIGN: changes only human Tree metadata for the same source ID.
- MERGE: produces a new explicitly specified output source from 2+ current input revisions; inputs are preserved unless the approved proposal explicitly includes separate DELETE operations.
- SPLIT: produces 2+ explicitly specified output sources from one current source; original is preserved unless a separate approved DELETE is present.

MERGE/SPLIT never invent source text. The exact proposed output must be supplied by the caller/operator/reconciliation consumer and its supporting source revisions/evidence refs recorded.

## Review and commit lifecycle

Proposal states:

`PROPOSED -> REVIEW_READY -> APPROVED | REJECTED -> COMMITTED | STALE | FAILED`

Rules:

- proposal creation never mutates Source Registry;
- reject changes nothing;
- duplicate proposal fingerprint returns the same extant proposal rather than creating a second mutation;
- approval requires a unique operator decision ID;
- approval does not mutate source;
- commit revalidates:
  - story/chat scope;
  - every source revision fence;
  - operation fingerprint;
  - target UID/book state;
  - approval identity/state;
- stale/duplicate/replayed commit fails closed;
- successful commit uses LoreStudyRuntime `upsertEntry` / `removeEntry`, creating new source revisions and normal study obligations;
- the resulting audit stores revision events, invalidation/impact receipts, proposal fingerprint and a reconstruction receipt;
- restoration uses exact pre-commit state to publish compensating source revisions; it never rewrites revision history.

A proposal whose evidence came from model/Jev output still requires the same deterministic validation and operator approval. Model/Jev output has no canonical mutation authority.

## Story/chat scope

When a proposal supplies `chatId`, it must bind to that exact chat's Lore authority scope. Sources outside the chat's selected/accepted scope cannot be mutated through that scoped proposal. A scoped proposal cannot be approved/committed using a different chat ID.

Unscoped administrative authoring remains possible only when the caller explicitly uses `scopeMode:'GLOBAL_OPERATOR'`; it is not inferred from an absent chat ID.

## Worker 3 contract

Extend `LoreAuthoringService.operatorContract()` with bounded read models:

- `mutationProposal({proposalId})`
- `mutationQueue({chatId?,status?,limit?})`
- `semanticImpactPreview(request)`
- `mutationAudit({proposalId})`

Actions:

- `createMutationProposal(request)`
- `approveMutationProposal(request)`
- `rejectMutationProposal(request)`
- `commitMutationProposal(request)`
- `restoreMutationProposal(request)`

Read models include exact revision/source IDs, operation kind, bounded before/after text metadata, impact counts/refs, state, approval/audit IDs and errors. They do not expose credentials or infer UI completion. Worker 3 owns rendering and interaction design.

## Compatibility

The existing Wave 7 Tree/Merge lifecycle remains supported. This wave does not rewrite #169/#192/#189 consumers. New planner/proposal APIs are designed so those systems can adopt them incrementally.

PR #255 remains independently stackable after #254. This branch must not depend on its evidence registry.

## Tests

Focused deterministic fixtures must cover:

- wording-only update with minimal semantic cone;
- claim/entity/alias/relationship/rule/temporal/unresolved/retrieval/structure changes;
- dependency direct/transitive/preserve classification;
- all seven operations;
- reject/no-op;
- duplicate proposal;
- stale source after approval;
- target UID collision;
- exact-chat scope violation;
- explicit global operator scope;
- commit-time fingerprint revalidation;
- targeted study obligations/invalidation;
- unaffected source retention;
- reload and audit recovery;
- restoration by compensating revision;
- model/Jev metadata without mutation authority;
- bounded Worker 3 read/action contract.

No test in this wave claims FT004 or installed-host provider delivery.
