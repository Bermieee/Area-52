# Area-52 Lore Multi-Resolution Representations

**Wave:** Lore Wave 2  
**Owner lane:** \`Development-Lorebook-Editor\`  
**Primary card:** #190  
**Architecture parent:** \`docs/AREA52_COGNITIVE_MEMORY_BLUEPRINT.md\` and \`docs/LORE_WAVE1.md\`

## 1. Purpose

Wave 2 extends the accepted native Lore producer without replacing it.

Wave 1 remains responsible for exact source/revision identity, Lore Study, learned semantic artifacts, lifecycle truth, incremental relearning, and the public Lore producer surface.

Wave 2 consumes those validated products and adds a revisioned family of semantic-retention representations:

\`\`\`text
exact source revision
  -> Wave 1 learned artifacts
  -> bounded source slices for source-only semantic classes
  -> grounded contributions
  -> semantic-retention profile
  -> provider-neutral representation request
  -> strict grounding/retention validation
  -> quality receipt
  -> revisioned representation publication
\`\`\`

The exact source is still the authority. Representations are cognition.

## 2. Representation artifact contract

A \`LoreRepresentationArtifact\` preserves:

- deterministic representation ID;
- representation revision inside its source/profile/cap family;
- profile;
- source ID;
- exact source revision ID;
- dependency artifact IDs;
- grounded contribution IDs;
- provenance;
- produced content;
- character, byte, and approximate-token size;
- structured retention receipt;
- policy revision;
- compiler revision;
- semantic dependency hash;
- reuse key;
- current/historical/stale state;
- DERIVED authority;
- temporal-retention counts;
- unresolved-retention counts;
- hard-cap state.

Equivalent source revision + profile/cap + policy revision + compiler revision + semantic dependency hash maps to one reuse key.

No representation mutates the exact source.

## 3. Canonical profiles

Profiles are defined by retention policy, not a percentage target.

### LEAN

Mandatory semantic classes:

- REQUIRED_IDENTITY;
- LOAD_BEARING_FACT;
- HARD_CONSTRAINT;
- RELATIONSHIP_CORE;
- TEMPORAL_ANCHOR;
- UNRESOLVED_CONFLICT;
- CHARACTER_BEHAVIOR.

Causal context is recognized but is not mandatory for Lean.

### BALANCED

Balanced preserves all Lean mandatory material and additionally retains preferred:

- CAUSAL_CONTEXT;
- SENSORY_ANCHOR;
- EDGE_CASE.

This creates more relationship, emotional, exception, and sensory texture while keeping the same grounded facts.

### HEAVY

Heavy preserves the mandatory core, requires sensory identity, and retains the richer preferred set including:

- causal context;
- edge cases;
- flavor detail.

Heavy is still a derived representation. Extra texture cannot change truth.

### CUSTOM_CAP

Custom Cap is an explicit character cap over a selected base semantic profile.

The compiler first calculates the mandatory semantic minimum. If that minimum cannot fit, the request fails with \`CAP_IMPOSSIBLE\` and publishes nothing.

A cap is never permission to delete mandatory meaning.

## 4. Grounded contribution model

A \`LoreGroundedContribution\` contains:

- contribution ID;
- revision-independent semantic ID;
- exact source revision;
- source span where applicable;
- semantic category;
- entity refs;
- claim refs;
- relationship refs;
- temporal refs;
- unresolved refs;
- behavioral refs;
- sensory refs;
- dependency artifact IDs;
- source authority metadata;
- DERIVED contribution authority;
- provenance.

Wave 2 preferentially builds contributions from Wave 1 entities, claims, relationships, and temporal/unresolved state.

It does not independently re-derive those facts when Wave 1 already supplies them.

Bounded source-span classification is used for semantic classes Wave 1 does not yet natively model, especially hard constraints, behavioral anchors, sensory anchors, edge cases, causal context, and descriptive flavor.

This preserves the source/learned separation while making long-form RP texture visible to representation policy.

## 5. Bounded source slicing

Production limits are explicit:

- source slice: 1,200 characters;
- overlap: 120 characters;
- maximum slices: 128;
- contribution budget per slice: 48;
- total contribution budget: 512;
- relationship refs: 128;
- claim refs: 192;
- behavioral anchors: 64;
- sensory anchors: 64;
- validation refs: 768;
- final representation: 24,000 characters;
- provider request estimate: 96,000 characters.

Each slice retains:

- deterministic slice ID;
- source start/end span;
- slice index;
- exact text;
- text hash.

Slice coverage validation proves there are no source gaps and no invalid spans.

Source-only texture contributions retain the owning slice ID in their provenance span.

The public \`validateProviderSliceResults()\` contract rejects:

- unknown slice refs;
- duplicate slice refs;
- missing slice refs;
- malformed result collections.

The current deterministic compiler does not need a model to extract Wave 1 facts. Future model-backed contribution providers can use this seam without changing the source/revision contract.

## 6. Contribution reduction

Wave 2 performs a conservative reduction step:

- identical semantic contributions dedupe deterministically;
- dependency refs merge;
- contradictory alternatives remain separate;
- temporal alternatives remain separate;
- hard constraints remain separate.

The implementation deliberately does not perform aggressive free-form merging yet. Unique semantics are preferred over maximum compression.

## 7. Provider-neutral generation seam

The representation compiler accepts a provider interface.

The provider receives only:

- source identity/revision;
- requested profile/cap;
- profile policy;
- bounded selected contributions;
- a bounded slice coverage receipt.

It does not receive one unbounded raw-source prompt from the compiler.

The default provider is deterministic so CI can verify exact semantics.

Provider output is not trusted merely because it is fluent. In the current safe contract, final output must be exactly grounded in declared contribution refs. Free-floating provider prose fails \`UNSUPPORTED_ASSERTION\`.

Future paraphrasing providers will require an additional semantic verifier before they may relax this strict equality rule.

## 8. Structured validation

Publication rejects:

- malformed output;
- unknown contribution refs;
- duplicate contribution refs;
- source ID invention;
- stale source revision;
- provider persistent-ID injection;
- authority escalation;
- missing mandatory contributions;
- temporal collapse;
- unresolved-conflict collapse;
- dropped hard constraints;
- unsupported/free-floating assertions;
- failed source-slice coverage;
- cap overflow;
- impossible cap;
- internal representation-size overflow;
- provider request overflow.

A failed draft never becomes a current representation.

## 9. Quality receipts

Every accepted representation carries a \`RepresentationQualityReceipt\`.

It records:

- source revision;
- profile/policy revision;
- source size;
- representation size;
- compression ratio;
- required contributions total/retained;
- preferred total/retained;
- optional total/retained;
- claim retention;
- relationship retention;
- temporal-anchor retention;
- unresolved-conflict retention;
- hard-constraint retention;
- behavioral-anchor retention;
- sensory-anchor retention;
- unsupported-statement count;
- requested cap;
- minimum safe estimate;
- cap compliance;
- slice coverage;
- validation failures;
- PASS/FAIL.

No single opaque quality score is authoritative.

Quality coverage is diagnostic evidence, not Settlement authority.

## 10. Temporal and unresolved semantics

Contribution identity includes temporal meaning.

CURRENT, HISTORICAL, SEQUENCE, DATED, UNCERTAIN, and CONFLICTING state is preserved in representation text and semantic fingerprints.

A change such as:

\`\`\`text
Mara owns Ember Tavern
-> Mara formerly owned Ember Tavern
\`\`\`

therefore changes representation semantics even though subject/predicate/object identity remains similar.

Unresolved alternatives remain distinct mandatory contributions. Compression may shorten their wording but cannot select a winner.

## 11. Representation registry and history

\`LoreRepresentationRegistry\` owns derived representation publication/history only.

It supports:

- deterministic reuse-key lookup;
- current representation lookup;
- historical family lookup;
- source-revision freshness checks;
- source-edit staleness;
- policy-revision staleness;
- compiler-revision staleness;
- forensic stale reasons;
- representation replacement lineage;
- active profile advertisement;
- read-only UI model.

Old representations remain inspectable.

They do not remain in the active pool once their source revision, policy revision, or compiler revision becomes stale.

## 12. Revision invalidation and reuse

Source revisions are immutable.

When \`source@r4\` becomes \`source@r5\`:

- r4 representations become stale;
- unrelated source representations stay current;
- new r5 representations get new IDs;
- historical r4 representations remain inspectable;
- stale reason remains available even after the replacement representation is published.

A wording-only edit can produce equivalent contribution semantics, but the representation is still regenerated under the new exact source revision so provenance is truthful.

No source revision is silently pretended unchanged.

If the exact source revision, policy revision, compiler revision, profile/cap, and semantic dependencies are unchanged, the existing valid representation is reused rather than regenerated.

## 13. Policy revisions

Retention policy is explicitly revisioned.

A changed Lean policy can stale the current Lean representation even when exact source text is unchanged.

Policy refresh is profile-scoped: changing Lean does not grant a reason to stale unrelated profile families.

A new compilation publishes a new representation identity and retains the old representation history.

## 14. Semantic-diff compatibility

Wave 2 reuses the Wave 1 semantic model rather than inventing a parallel freshness system.

\`LoreMultiResolutionSystem.compareSemanticRetention()\` compares revision-independent contribution semantic IDs and distinguishes:

- wording-only semantic equivalence;
- relationship changes;
- temporal changes;
- unresolved/ambiguity changes;
- behavior changes;
- sensory changes.

Representation regeneration remains required on exact source revision change even when semantic content is equivalent, because representation provenance is exact-revision keyed.

Policy revision changes are handled through the same representation freshness registry instead of a separate cache.

## 15. Context Compiler advertisement seam

Lore does not choose context policy.

\`selection()\` returns a \`LoreRepresentationSelectionSurface\` containing:

- source ID/revision;
- requested profile/budget/precision hint;
- available representation refs;
- profile;
- size;
- representation revision;
- quality status;
- optional exact requested-profile match;
- explicit fallback/drillback refs;
- source drillback availability.

\`chooserAuthority=false\`.

Context Compiler remains responsible for deciding which representation to use.

The drillback chain can progress from Lean toward Balanced, Heavy, and exact source without losing source identity.

## 16. UI-ready read model

\`readModel()\` exposes only producer state:

- source ID/title;
- source revision/state;
- available profiles;
- size;
- quality;
- compression ratio;
- current state;
- representation revision;
- provenance summary;
- hard-cap state.

It imports no UI code and owns no mutation or Context Compiler selection authority.

## 17. Browser safety

All production representation modules use browser-compatible JavaScript.

They have no production dependency on:

- Buffer;
- process;
- require;
- node:*;
- fs;
- path;
- worker_threads.

Node-only imports remain confined to test tooling.

## 18. Authority boundaries

Permanent rules:

\`\`\`text
source != representation
summary != SOURCE_CANON
compression ratio != quality authority
provider confidence != authority
contribution frequency != truth
semantic coverage != Settlement
ontology != canon
historical != current
unresolved != resolved
hard cap != permission to delete required meaning
\`\`\`

The representation compiler cannot rewrite source and cannot settle canon.

## 19. Current limitation

Wave 2 is a native backend foundation, not the final natural-language summarization product.

The current provider contract is intentionally strict: it composes grounded contribution language rather than allowing unconstrained paraphrase. A future model-backed summarizer may produce more natural prose only after an equally strict semantic grounding/verifier path exists.

Wave 2 also does not implement Tree Builder, overlap discovery, reconciliation, hierarchy-summary services, keyword evaluation, UI, Runtime scheduling, Context Compiler policy, Candidate Bus, Truth Gate, Precision, Jev, Settlement, or main/live integration.
