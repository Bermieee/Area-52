# Native Brain Identity and Retrieval Wave Handoff

Evidence labels in this document are intentionally strict:

- **DETERMINISTIC** means exercised by repository tests or deterministic owner-contract fixtures.
- **HOST-CONTRACT** means the integration surface exists but the assembled host has not been proven here.
- **LIVE** requires the real SillyTavern send -> sealed Brain context -> real provider request -> response -> learning loop. Worker 1 does not claim LIVE evidence.

## Core-facing identity contract

`Area52NativeBrain.entityIdentityContract()` publishes the stable Core identity rules. Source owners may register stable identities and propose source-backed links or aliases, but proposals do not mutate canonical identity on their own. Model confidence, retrieval score, graph proximity, and co-activation never settle identity. MERGE and SPLIT remain owner/Settlement work. Source-revision invalidation retires only dependent aliases/links and preserves their history.

Identity read-only UI receipt: `uiBindings().readIdentityResolution(selection)`.

## Core-facing graph owner contract

`Area52NativeBrain.graphProviderInterfaceContract()` publishes the provider-neutral graph contract used by Scene/Lore/Memory/Temporal integrations.

Owners register `{providerId, owner, query, isRevisionCurrent?, semanticsVersion?, metadata?}`. Foreground native `query(request)` is bounded and synchronous. The request supplies the query/intent, canonical anchor IDs, allowed edge meanings, depth/node/edge/candidate caps, latency budget, current world/scene revisions, source revision set, and perspective.

External edges carry owner semantics rather than a Core-flattened ontology. Source revision refs are mandatory; source/dependency/world/scene fences are checked before Candidate Bus admission. Provider/owner identity, source kind, edge meaning, temporal status, traversal path, provenance, revision fences, and identity-resolution state survive nomination. Lore graph structure is retrieval evidence and does not inherit Lore source authority merely because it came from a Lore-owned graph.

Provider callbacks are runtime attachments and are not serialized in Brain snapshots. Reattach owner graph providers after `Area52NativeBrain.fromSnapshot(...)`. The persisted Hot graph neighborhood is only a bounded working set of fenced refs; it is not an owner graph and is invalidated when Scene or world revision changes.

Graph read-only UI receipt: `uiBindings().readGraphTraversal(selection)`. Stale graph evidence: `uiBindings().readRejectedEvidence(selection)`.

## Retrieval and budget receipts for Worker 3

Worker 3 should treat these as read-only diagnostics for the same stable turn/generation selection:

- `readCognitiveChoice`: why Hot/retrieval/Graph/Jev work was admitted or skipped.
- `readSensoryTrace` / `readCandidateBusEnvelope` / `readCandidateFusionReceipt`: bounded native nominations and deduplication.
- `readIdentityResolution`: stable identities, unresolved proposals, and settlement receipts.
- `readGraphTraversal`: provider statuses, path counts, bounds, stale rejection, and revision refs.
- `readRetrievalBudget`: channel/candidate/latency decisions.
- `readRejectedEvidence`: stale graph and owner evidence rejected before sealed delivery.
- `readTruth`, `readContextSeal`, `readPromptPlan`, and `readContextReceipt`: admission, immutable semantic packet, model-budget presentation, and omissions.

UI rows never acquire Truth, Settlement, graph mutation, or Context Seal authority.

## Native lifecycle

The native path remains valid with no Jev, Sidecar, remote model, SQL service, external database, or user-managed orchestrator. Optional Coprocessor/Sidecar execution may wrap the same graph/provider contracts, but the native foreground path does not depend on it.

After a successful bounded graph turn, the fused fresh graph refs may warm Hot Cognition for a later quiet turn. The working set is revision-aware and is invalidated on Scene/world changes or dependent source revision invalidation. Hot Cognition never becomes the graph owner.

## Integration map

Worker 1 owns the Core identity registry, native graph walker, Candidate Bus admission path, Truth/Temporal interaction, Hot working-set behavior, Context Seal, and model-budget delivery semantics on `Development-Nexus`.

Worker 4 remains authoritative for Lore ontology/source revisions/exact drillback and Memory owner experience semantics. Scene remains authoritative for Scene observations and its graph semantics. Their branches should expose adapters implementing the published contracts; Worker 1 should not copy or mutate their owner graphs.

Worker 2 owns optional Coprocessor/Sidecar execution and the provider-neutral scatter/gather route required by the full #203 acceptance.

Worker 3 owns the assembled SillyTavern host request. It should consume only the read receipts above and must send the exact `prepared.rendered` produced from the sealed packet. Actual LIVE acceptance remains a Worker 3 integration gate.

## Standing-card posture

The wave adds direct deterministic coverage for #201 identity safety, #203 native bounded graph traversal, #5 current/history/unresolved state, #133 semantic-preserving budget pressure, #27 Hot graph working-set reuse/invalidations, and #6 Candidate Bus normalization/deduplication. Do not close the standing cards solely from these tests: #6 still spans broader hybrid channels and assembled behavior; #203 still includes optional Coprocessor scatter/gather acceptance; #133 is an epic with host/delivery work beyond this branch; #27 includes assembled runtime behavior; #5 remains issue-level until all settlement/provenance acceptance is reconciled.
