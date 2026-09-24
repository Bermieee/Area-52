# Coprocessor Wave 7 Change Log

Starting point:
`f10e52ca94558c083977ce90d9a3dd7105799617`

Functional checkpoint:
`6025a488808c29242eb79b6392a0a9f241798ffe`

## Added

- `src/coprocessor/historian-retrieval.js`
  - canonical Historian task;
  - Memory resolver/request contract;
  - retrieval modes;
  - perspective fences;
  - ArtifactReference-first normalization;
  - provider payload builder;
  - provider output validation;
  - Candidate Bus-compatible nomination;
  - revision/late-result fencing;
  - provider-neutral `HistorianRetrievalWorker`;
  - dynamic Historian urgency.

- `CorrectiveRetrievalPlan`, `CorrectiveRetrievalDispatcher`, `RetrievalAbstentionReceipt` and corrective candidate merge in `retrieval-control-policy.js`.

- Wave 7 telemetry vocabulary for Historian lifecycle, stale/degraded/abstention and correction behavior.

- Test suites:
  - `coprocessor-wave7-historian.test.mjs`;
  - `coprocessor-wave7-adaptive-retrieval.test.mjs`;
  - `coprocessor-wave7-golden.test.mjs`;
  - `coprocessor-wave7-authority.test.mjs`;
  - `coprocessor-wave7-stress.test.mjs`.

- Dedicated `coprocessor-wave7.yml` exact-head workflow.

## Changed

- `foreground-specialists.js`
  - Historian is now compatibility adapter into canonical `historian-retrieval.js`;
  - legacy ref-only provider output remains supported;
  - prompt-injection content remains explicitly untrusted data.

- `retrieval-control-policy.js`
  - legacy ratio evaluator preserved;
  - production path now evaluates required intent coverage and defects;
  - MIXED receives exactly one correction;
  - LOW or exhausted MIXED abstains explicitly.

- `precision-retrieval-pipeline.js`
  - carries required intents into quality evaluation;
  - preserves valid first-pass evidence through correction;
  - surfaces correction plan and abstention receipt;
  - invokes Precision only after HIGH.

- `candidate-bus.js`
  - local compatibility contract now preserves optional Historian event/claim/retrieval-intent/dependency/perspective/freshness fields;
  - no Candidate Bus settlement/fusion authority added.

- `fanout-planner.js`
  - Historian urgency is dynamic:
    - explicit/history-dependent -> REQUIRED;
    - useful physical/continuity enrichment -> OPPORTUNISTIC;
    - no-value/hot/warm turns -> SKIPPED.

## Compatibility repairs

During implementation:
- corrected the adaptive controller return-name typo;
- restored physical/current-state Historian compatibility as OPPORTUNISTIC;
- preserved legacy duplicate-ref rejection;
- restored the accepted "untrusted data" system instruction;
- made legacy provider normalization consume the canonicalized provider-input candidate metadata.

No inherited Wave 1–6 assertion was removed or relaxed.

## Boundaries

Wave 7 did not implement:
- Memory persistence;
- Experience/SceneEpisode store;
- Character Memory persistence;
- Temporal State;
- Scene Query Planner;
- Graph Walker core;
- vector/sparse database/index;
- Lore index;
- canonical Candidate Bus ownership;
- new Context Compiler/Seal;
- new Runtime Fabric;
- UI;
- FT002–FT006 expansion;
- provider-learning/Phase 2 routing.

Models retrieve/propose. Schemas validate. Revisions fence. Owners settle.

## Validation

Functional Actions run `35981298068` succeeded with:
- full regression 337/337;
- Wave 7 Historian 21/21;
- adaptive 18/18;
- goldens 6/6;
- authority negatives 11/11;
- focused stress PASS;
- all Wave 1–6 regressions PASS;
- browser/syntax/ESM PASS.

Stress showed zero perspective leaks, zero authority violations, zero stale foreground admissions and maximum foreground corrective passes of one.
