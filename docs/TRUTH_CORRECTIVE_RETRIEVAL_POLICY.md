# Area-52 Truth + Corrective Retrieval Policy

## Separation of responsibilities

Retrieval nominates evidence.

Truth Gate classifies whether evidence is usable for the requested temporal intent.

Truth Gate does not settle canonical truth.

## Required classifications

CURRENT, HISTORICAL, SUPERSEDED, CONTRADICTED, UNCERTAIN and UNRESOLVED remain the canonical truth-state vocabulary.

## Intents

Wave 3 supports CURRENT, HISTORICAL, TEMPORAL and CONTRADICTION while leaving the contract open to future intents.

## Confidence policy

### HIGH

Sufficient intent-correct evidence exists. Continue.

### MIXED

Useful evidence exists but current resolution is incomplete, historical or conflicting.

Emit a bounded corrective request carrying:

- reason;
- requested action;
- original query;
- intent;
- source/world/scene revision fences;
- prior candidate IDs;
- missing evidence type if inferable;
- maximum attempts;
- attempt number.

Reference Wave 3 policy allows one corrective attempt.

### LOW

No useful long-term memory is admitted. Publishing no long-term memory is correct and preferable to irrelevant context.

## Termination

Corrective retrieval never recurses indefinitely.

At the attempt limit:

- preserve the evidence already available;
- preserve MIXED/UNRESOLVED;
- compile conservatively;
- record CORRECTIVE_EXHAUSTED where applicable.

If the corrective worker throws:

- preserve prior evidence;
- do not fabricate certainty;
- record CORRECTIVE_FAILED;
- continue publication.

## Historical support

For a CURRENT query, historical evidence may be included as explicitly historical support after MIXED analysis.

It never becomes current truth merely because it is useful to explain uncertainty.

## Rebuild

Truth assessment is temporary. It is recomputed from current candidates and revision-fenced evidence for each publication attempt.

## Benchmark

Wave 3 tests prove HIGH/MIXED/LOW, all six truth classifications, one-attempt termination, corrective failure containment and a LOW empty-memory packet.
