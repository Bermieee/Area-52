# Lore Wave 3 Changelog

## Added

- Derived Lore navigation hierarchy over fresh Wave 1 sources.
- Authored Tree scope preservation with no source/Tree mutation.
- Evidence-backed cross-Tree community scopes.
- Deterministic bounded SHARD scopes for large fan-out.
- Corpus navigation scope.
- Local structure revisions and hierarchy fingerprint.
- Revisioned \`NavigationSummary\` artifact contract.
- Bottom-up child-before-parent summary generation.
- Exact source-revision and child-summary dependency tracking.
- Source-grounded critical evidence propagation.
- Historical Eris/Blade/Tavern location composite from existing Wave 1 artifact evidence.
- Hard-rule source-span grounding.
- Strict source/child/statement ref validation.
- Block-only-dependent-ancestor failure behavior.
- Summary registry with reuse, history, stale reasons and hierarchy synchronization.
- Checkpoint/yield/resume navigation-build lifecycle.
- Exact-revision source-evidence cache for scalable hierarchy builds.
- Deterministic browser-safe contextual retrieval index.
- Pronoun-friendly contextual exact-source retrieval forms without source mutation.
- Narrow exact/entity retrieval path.
- Broad branch/community summary retrieval path.
- Exact-source drill-down.
- Core Candidate Bus-compatible nomination adapter shape using \`Development-Nexus\` as read-only reference.
- Explicit Candidate payload bounds.
- Authority-negative retrieval/summary/community metadata.
- Wave 3 focused goldens.
- 2,100-entry hierarchy/retrieval stress.
- Dedicated Wave 3 CI.
- Dedicated architecture and acceptance documentation.

## Production files

- \`src/lore-navigation-contracts.js\`
- \`src/lore-navigation-hierarchy.js\`
- \`src/lore-navigation-summary-registry.js\`
- \`src/lore-navigation-summary-builder.js\`
- \`src/lore-contextual-retrieval.js\`
- \`src/lore-hierarchy-retrieval-system.js\`

## Test/CI files

- \`tests/lore-wave3.mjs\`
- \`tests/lore-wave3-stress.mjs\`
- \`tests/lore-browser-safe.mjs\`
- \`.github/workflows/lore-wave3-ci.yml\`
- \`package.json\`

## Documentation

- \`docs/LORE_HIERARCHY_CONTEXTUAL_RETRIEVAL.md\`
- \`docs/LORE_WAVE3_ACCEPTANCE.md\`
- \`docs/LORE_WAVE3_CHANGELOG.md\`

## Worker 4 boundary

Wave 3 did not edit:

- \`src/lore-representation-compiler.js\`;
- \`src/lore-representation-contracts.js\`;
- \`src/lore-representation-registry.js\`.

Worker 4's Wave 2 repair remains a separate future integration input.

## Measured stress checkpoint

Wave 3 Actions run \`36052793956\` passed the full pre-documentation implementation:

- 2,100 sources;
- 2,324 initial scopes;
- 2,326 final scopes;
- 2,121 source revisions;
- 160 retrieval queries;
- 20 targeted edits;
- one Tree reorganization;
- 2,400 retained summary artifacts;
- 2,321 current summaries;
- 4,421 retrieval records;
- max examined 144;
- max returned 16;
- stale current summaries 0;
- authority promotions 0;
- duplicate current scopes 0;
- source loss 0;
- unrelated branch reused.

## Status discipline

Valid completion claim after final exact-head CI:

**LORE HIERARCHY + CONTEXTUAL RETRIEVAL READY FOR CORE INTEGRATION**

Do not claim:

- #36 fully complete;
- #48 fully complete;
- #179 FT004 PASS;
- #224 PASS;
- Wave 2 Director acceptance;
- live assembled Brain.
