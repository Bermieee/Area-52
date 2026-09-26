# FT006 Representative Workload Harness

Status after Worker 1 Wave 4: **FT006 HARNESS READY**.

`RepresentativeWorkloadHarness` records multi-turn replay evidence without pretending a deterministic fixture is a live representative RP qualification.

Supported turn evidence includes scene/generation identity, arbitrary event references and independent metrics for:
- current-state errors;
- historical-state errors;
- contradiction errors;
- stale admission;
- missed relevant context;
- unnecessary context;
- unresolved-thread misses;
- provenance completeness;
- callback/continuity quality;
- character consistency evidence;
- latency;
- token/byte size;
- worker fan-out;
- warm/cache reuse;
- operator corrections.

Each metric is MEASURED, REPLAYED, NOT_MEASURED or NOT_APPLICABLE. Missing qualitative RP evidence stays NOT_MEASURED.

The report deliberately has `aggregateScore: null`. Area-52 does not invent a single arbitrary "RP quality" score.

The deterministic Wave 4 fixture demonstrates multi-turn scene transition, late-result, reload/resume and source-edit event recording while leaving liveQualification=false.

#181 stays open for the actual representative live workload and Nexus comparison data.
