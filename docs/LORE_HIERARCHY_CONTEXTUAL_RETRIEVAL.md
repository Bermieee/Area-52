# Area-52 Native Lore Hierarchy + Contextual Retrieval

**Wave:** Lore Wave 3  
**Owner branch:** \`Development-Lorebook-Editor\`  
**Primary cards:** #56 and #193  
**Supporting architecture:** #36, #48, #120  
**Integration targets:** #179, #224

## Purpose

Wave 3 turns fresh studied Lore into a navigable, revisioned body of knowledge.

It builds on the accepted Wave 1 source/study contracts and the current Wave 2 candidate without introducing a second source registry, truth system, scheduler, or representation compiler.

The production path is:

\`\`\`text
exact authored Lore source revisions
  -> Wave 1 learned artifacts
  -> derived navigation hierarchy
       authored Tree scopes
       bounded structural shards
       evidence-backed concept/community scopes
       corpus scope
  -> bottom-up NavigationSummary artifacts
  -> fresh contextual retrieval records
       exact-source contextual records
       branch/community/corpus summary records
  -> deterministic bounded query
  -> Core Candidate Bus-compatible nominations
  -> exact-source drillback
\`\`\`

The authored Lore Tree remains unchanged throughout.

## Authority model

Permanent rules:

\`\`\`text
authored Tree placement != claim truth
community membership != canon
summary fluency != source authority
retrieval rank != truth
retrieval rank != Candidate Bus admission
summary coverage != Settlement
summary freshness != Context Seal access
derived navigation != entity merge authority
\`\`\`

Exact authored source remains SOURCE_CANON as a document.

Navigation scopes and NavigationSummary artifacts are DERIVED.

Even exact-source retrieval nominations carry:

\`\`\`text
authorityGranted: false
admissionAuthority: false
settlementAuthority: false
canonicalMutationAuthority: false
\`\`\`

Summary/community nominations additionally declare no summary/community truth authority and no Context Seal authority.

## Derived hierarchy

\`deriveLoreNavigationHierarchy()\` consumes only sources whose current exact revision has a current Wave 1 learned revision.

Removed, stale, and unstudied sources are excluded from fresh navigation.

Scope families:

- **LEAF** — one current source;
- **TREE** — a derived navigation scope matching an authored Lore Tree path;
- **SHARD** — an internal bounded fan-out scope inserted only when a parent would exceed the child limit;
- **COMMUNITY** — evidence-backed cross-Tree concept/community membership;
- **CORPUS** — the top-level navigation scope.

Authored Tree paths are copied as structural context. They are never mutated and never grant semantic truth.

### Local structure revision

Each scope receives a deterministic local \`structureRevision\`.

It depends on:

- scope type/logical key;
- authored Tree path where relevant;
- member source IDs;
- direct child scope IDs;
- community key where relevant.

It deliberately does **not** depend on source prose.

Consequences:

- a prose edit with unchanged placement can preserve structure revision while source-revision dependencies change;
- a Tree-only move changes only the truthful navigation structure cone;
- unrelated branch structure identities remain reusable;
- community membership changes can invalidate the affected community without treating the authored Tree as wrong.

A hierarchy-level fingerprint is also emitted for diagnostics/snapshot identity.

## Bounded hierarchy fan-out

A scope may depend on at most 64 direct child summaries.

When a Tree/community/corpus scope would exceed that limit, deterministic SHARD scopes group the children into bounded blocks.

Shards are derived implementation/navigation scopes. They do not appear in or mutate the authored Tree.

Maximum authored Tree depth accepted by the builder is 12. Entries beyond that configured limit degrade by exclusion with diagnostics rather than causing unbounded recursion.

## NavigationSummary artifact

A successfully built \`NavigationSummary\` carries:

- summary ID;
- summary revision;
- target scope ID/type/label;
- local structure revision;
- exact source revision set;
- exact child-summary dependency set;
- bounded content;
- statement-to-source provenance;
- critical source evidence;
- structured quality receipt;
- generator revision;
- dependency fingerprint;
- freshness/state;
- DERIVED authority and explicit authority-negative flags.

Old summary revisions remain inspectable.

They are not eligible for fresh retrieval after they become stale/historical.

## Bottom-up dependency rule

The build graph is topologically ordered.

\`\`\`text
leaf
  -> shard / parent Tree
  -> higher Tree
  -> corpus

leaf
  -> community shard
  -> community
\`\`\`

A parent cannot publish unless every required child has a fresh current summary.

If a child fails:

- that child is INVALID/BLOCKED;
- the dependent parent is BLOCKED;
- its ancestor cone is blocked;
- an unrelated branch continues building normally.

No stale child summary is silently used to leave the parent falsely current.

## Grounding and drift control

Wave 3 never validates a parent against the parent's previous prose.

Leaf evidence is reconstructed from current Wave 1 source-backed artifacts plus exact source spans for explicit hard-rule expressions not yet modeled as first-class Wave 1 rule artifacts.

Grounded evidence includes:

- claims;
- significant relationships;
- temporal class;
- unresolved state;
- exact source revision;
- artifact/claim/relationship refs;
- hard-rule source spans.

A paired \`leftAt\` + \`locatedAt\` relationship from the same source sentence is additionally exposed as one derived historical location composite, preserving the original artifact refs and exact source revision.

Parent summaries may consume child summaries for efficiency, but every selected statement retains original source revision/evidence refs.

### Critical propagation

High-risk semantics are propagated bottom-up and cannot be silently dropped:

- unresolved alternatives;
- historical/sequence/dated/uncertain/conflicting temporal distinctions;
- explicit hard rules;
- significant relationships;
- current state changes such as destruction.

If the mandatory critical evidence alone exceeds the summary-size bound, the summary fails closed rather than pretending it compressed safely.

## Strict summary-output validation

A summary provider result must provide exactly the requested:

- source revision refs;
- child summary refs;
- statement refs.

Validation rejects:

- missing source refs;
- extra/invented source refs;
- duplicate source refs;
- missing child refs;
- extra/invented child refs;
- duplicate child refs;
- stale sources;
- stale/failed children;
- malformed output;
- unsupported authority;
- provider persistent IDs;
- unsupported/free-floating statements;
- dropped critical temporal/conflict/rule/relationship evidence;
- summary overflow.

The deterministic local provider is the production-safe default and requires no external model.

Provider use remains optional.

## Summary lifecycle, checkpoint and resume

\`LoreNavigationSummaryBuilder\` uses the same bounded-yield philosophy as Wave 1 study.

A build session stores:

- hierarchy revision;
- deterministic topological work plan;
- cursor;
- completed scope IDs;
- blocked scope IDs;
- reused scope IDs;
- newly built scope IDs;
- bounded diagnostics;
- checkpoint checksum.

At most 32 work units execute per requested batch.

A snapshot/reload can resume at the next scope.

Source evidence is cached by exact source revision for the duration of the build so one source is not semantically re-extracted once per ancestor/community scope.

The cache is ephemeral and reconstructable; it is not a truth store.

## Freshness and invalidation

The summary registry compares active summaries with the newly derived hierarchy and current Wave 1 revision state.

A summary becomes stale for reasons including:

- source revision set changed;
- source removed;
- source became unstudied/stale;
- scope removed/reorganized;
- local structure revision changed;
- dependent child summary changed.

On rebuild:

- fresh equivalent summaries are deterministically reused;
- stale affected summaries get a new revision;
- old revisions remain historical/reconstructable;
- stale reasons remain diagnosable;
- unrelated branch summary IDs stay unchanged.

### Source edit

\`\`\`text
changed UID
  -> leaf stale
  -> direct ancestors stale
  -> dependent corpus/community scopes stale
  -> unrelated branch remains current/reusable
\`\`\`

### Removal

A removed source is excluded from the fresh hierarchy and retrieval index.

Historical source and summary revisions remain inspectable through their registries.

### Tree-only reorganization

The source registry still creates a new exact source revision because its structural metadata changed.

The authored prose remains byte-for-byte unchanged.

Old navigation membership is invalidated, the new path is derived, and unrelated branches remain reusable.

### Concept/community change

Evidence-backed community membership is recalculated from current Wave 1 concept/community artifacts.

Only scopes whose membership/dependencies changed are invalidated.

Community membership is never treated as proof that two entities are identical.

## Contextual retrieval index

\`LoreContextualRetrievalIndex\` is a deterministic browser-safe local retrieval path.

It requires no mandatory:

- external embedding service;
- vector database;
- orchestration service;
- provider model.

It builds records from:

1. exact fresh source revisions;
2. fresh NavigationSummary artifacts.

### Exact contextual source record

The exact authored text is retained separately and never rewritten.

A retrieval-only contextual representation prepends:

- source title;
- authored Tree path;
- Wave 1 learned entity names/aliases.

Then it includes the exact authored text.

This lets locally ambiguous/pronoun-heavy prose inherit source-level identity context for retrieval without changing source canon.

For example:

\`\`\`text
Eris carried the Sun Blade. She left it there.
\`\`\`

remains the exact source, while its retrieval form can also carry title/Tree/entity context sufficient to find it from an Eris/Sun-Blade query.

## Query path

\`query()\` accepts:

- query text;
- NARROW / BROAD / AUTO intent;
- optional retrieval intent ID.

The deterministic index uses an inverted token map. It does not perform an unbounded all-pairs scan.

### Narrow intent

Narrow intent gives a resolution preference to exact-source records.

Typical use:

- Mara;
- Sun Blade;
- exact entity/detail;
- locally ambiguous phrase.

### Broad intent

Broad intent gives a resolution preference to navigation/community summaries.

Typical use:

- branch overview;
- faction/background;
- Tavern history;
- broad world/topic question.

The result is still only a nomination. It has no admission/truth/Settlement authority.

## Candidate Bus integration seam

The Lore channel emits \`CandidateNomination\`-shaped records compatible with the read-only Core contract on \`Development-Nexus\`.

Fields include:

- deterministic nomination/candidate/evidence identity;
- artifact ref/revision;
- bounded source revision refs;
- claim/entity/relationship refs;
- retrieval intent IDs;
- channel-local raw rank signals;
- normalized local rank;
- graph/scope metadata;
- temporal hints;
- owner authority class;
- truth-status hint;
- provenance/evidence/dependency refs;
- FRESH state;
- representation ref/revision;
- bounded representation text;
- bounded metadata;
- all authority-negative fields required by Core.

Lore does **not** instantiate or own Candidate Bus.

### Candidate payload bounds

A nomination carries at most:

- 64 source revision refs;
- 64 claim refs;
- 64 entity refs;
- 64 relationship refs;
- 64 evidence refs;
- 64 dependency refs;
- 16 provenance records;
- 1,600 representation characters.

For a broad scope with more supporting sources, the summary artifact retains the full bounded source set and the nomination reports truncation plus a retrieval-record ref.

\`drillDown()\` resolves that record back toward exact sources.

## Drill-down

Every nomination exposes source drillback.

Exact-source nomination:

\`\`\`text
nomination
  -> exact source revision
  -> exact authored text
\`\`\`

Summary/community nomination:

\`\`\`text
summary nomination
  -> NavigationSummary
  -> supporting source IDs/revisions
  -> exact contextual source records
  -> exact authored text
\`\`\`

The drill-down path never requires the caller to inspect internal Maps.

## Explicit bounds

Current default production limits:

| Bound | Limit |
|---|---:|
| Source refs per summary | 4,096 |
| Direct children per summary | 64 |
| Authored hierarchy depth | 12 |
| Summary characters | 12,000 |
| Query characters | 512 |
| Examined retrieval records | 512 |
| Nominations per intent | 16 |
| Total nominations per query | 24 |
| Retained diagnostics | 128 |
| Active build units per call | 32 |
| Total derived scopes | 12,000 |
| Community scopes | 256 |
| Indexed tokens per record | 192 |
| Candidate representation text | 1,600 |
| Candidate source/evidence/dependency refs | 64 each |

These are configuration contracts, not claims about epistemic authority.

## Degraded behavior

Wave 3 fails or degrades locally rather than widening authority:

- unstudied/stale source -> excluded from fresh hierarchy/retrieval;
- removed source -> excluded;
- over-depth source -> excluded with diagnostic;
- too many total scopes -> hierarchy build rejects;
- failed child -> dependent ancestor cone blocked;
- critical semantics exceed summary cap -> that summary fails;
- overlong query -> query rejects;
- too many matches -> deterministic examined/nomination bounds;
- no embedding/provider -> deterministic local sparse path remains usable;
- broad source set -> Candidate nomination refs truncate while artifact-level drillback remains available.

## Coordination with Wave 2 repair

Wave 3 does not modify:

- \`src/lore-representation-compiler.js\`;
- \`src/lore-representation-contracts.js\`;
- \`src/lore-representation-registry.js\`.

Worker 4's reported Wave 2 repairs remain a later integration input.

Wave 3 regression checks against the current branch candidate are not a Director acceptance claim for Wave 2.

## Known integration gaps

This lane does not implement:

- Core Candidate Bus ownership/admission;
- Truth Gate;
- Precision;
- Gather/Context Seal;
- Settlement;
- Jev;
- Runtime/Worker Director scheduling;
- UI;
- live Context Compiler policy;
- final persistence/database adapter;
- mandatory external embeddings;
- final GraphRAG/RAPTOR clustering research for all of #36/#48;
- assembled-main FT004/live Brain acceptance.

The intended lane completion claim is:

**LORE HIERARCHY + CONTEXTUAL RETRIEVAL READY FOR CORE INTEGRATION**
