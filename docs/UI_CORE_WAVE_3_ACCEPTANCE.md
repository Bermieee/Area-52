# UI.Core Wave 3 — Change / Acceptance Record

**Working branch:** \`Development-UI\`  
**Starting SHA:** \`aa466daadfed9f335993b83c6bfd4b44a32f41bc\`  
**Canonical Development-Nexus reference at kickoff:** \`1b1f81d0a1d1d036a4c5719bdc477fd8effb8acd\`  
**Validated implementation commit:** \`95b58b22d17fae3a6422e56a08423a93d8845c89\`  
**GitHub Actions validation run:** \`35821826935\`

Both live branch heads matched the kickoff contract before implementation.

During Wave 3, `Development-Nexus` advanced by eight commits. Final reconciliation confirmed the new canonical additions introduce memory reconsolidation/maturation (#118), causal/event hypotheses (#119), and semantic lore compilation/diff (#120) while preserving the existing authority, provenance, history and settlement invariants. The Wave 3 UI contracts remain compatible; these new backend extensions are not claimed as UI-owned completion work.

## Delivered

### Runtime observability
- living runtime overview;
- Hot vs Deep activity;
- L0-L4 utilization;
- reserved foreground / borrowed background capacity;
- active/parked worker counts;
- queued obligations;
- blocked/recovering work;
- active batches and deadline state;
- recovery/fallback activity;
- worker capability/layer/task/state/provider/model/latency;
- lifecycle obligations independent of worker availability;
- batch/yield/checkpoint/resume diagnostics;
- paged/virtualized Work Ledger summaries with explicit detail fetch.

### Coprocessor observability
- Turn Swarm capability/result-class diagnostics;
- queue and execution latency;
- retries and validation result;
- stale-result drops;
- duplicate/dedupe events;
- warm/cache hit;
- fallback usage;
- result destination;
- Context Seal contribution;
- Gather correlation ID, required workers, missing work, fallback satisfaction, stale/rejected results and late results;
- explicit CURRENT CONTEXT / NEXT TURN / BACKGROUND / STALE-DROPPED / FALLBACK presentation;
- large raw prompt/response/debug payloads remain explicit on-demand reads.

### Advanced Memory / state-aware retrieval
- SOURCE -> DERIVED UNDERSTANDING -> PROPOSAL -> SETTLEMENT -> temporal state lineage;
- original source, revisions, authority, evidence, dependencies and invalidators;
- current vs historical state without predecessor deletion;
- unresolved contradiction retained alongside settled current state;
- read-only Settlement trace;
- Reflection evidence/history with INFERRED authority;
- deterministic Reflection weakening under contradiction/support removal;
- raw narrative -> SceneEpisode -> claims/state -> Reflection -> retrieval-candidate provenance chain.

### Precision / reranking
- Scene Query -> broad retrieval -> Candidate Bus -> Truth Gate -> cheap pruning -> Precision Reranker -> optional semantic judge -> Context Compiler pipeline;
- adaptive candidate budget;
- candidate stage funnel;
- current/historical/superseded/contradicted/unresolved Truth classifications;
- detailed rerank record including pre-score/raw/normalized/final rank/profile/runtime/budgets/truncation/latency/freshness/fallback;
- six intent-opposite fixtures;
- implementation-neutral FP32/FP16/INT8 CPU/GPU benchmark display contract;
- foreground reranker deadline miss with deterministic fused-ranking fallback;
- late precision result routed outside sealed current context.

## Integrated Ember Tavern / Sun Blade scenario

The deterministic Wave 3 fixture performs all 18 requested acceptance steps:

1. ruined Ember Tavern is CurrentScene;
2. Eris asks where the Sun Blade is;
3. broad retrieval returns historical/current/unresolved evidence;
4. Truth Gate classifications are displayed;
5. reranking separates current-use evidence from semantic historical neighbors;
6. journal contradiction remains inspectable;
7. settlement preserves unresolved uncertainty instead of fabricating certainty;
8. Eris/Mara Reflection remains INFERRED and evidence-backed;
9. one Turn Event creates Historian, Graph Walker, Green Room and Truth/Precision workers;
10. runtime telemetry shows L0-L4 and Hot/Deep state;
11. Historian + Graph complete required work;
12. Truth/Precision foreground need is satisfied through deterministic deadline fallback;
13. reranker timeout/fallback state is visible;
14. Context Seal occurs;
15. Main proceeds after seal;
16. late Green Room result is routed to BACKGROUND;
17. admitted Sun Blade current state remains traceable to source/evidence/settlement;
18. historical Sun Blade possession/location remains inspectable without masquerading as current truth.

## Stress coverage

Deterministic stress fixtures include:

- 256 workers;
- 8,000 lifecycle obligations;
- 12,000 Work Ledger tasks;
- 128 batches;
- 5,000 memory/state records;
- 1,500 Reflections;
- 10,000 SceneEpisodes;
- 12,000 precision candidates;
- 16,000 provenance edges;
- 600 stale results;
- 1,500 rapid transitions for one worker;
- 1,200 rapid Candidate Bus stage updates.

Keyed render scheduling reduces each same-key storm to one pending render.

## Authority boundary

Wave 3 does not implement Runtime Fabric, Work Ledger persistence, Scene Intelligence, Source Registry, Temporal State Graph, Reflection settlement, Settlement Engine, Truth Gate, Candidate Bus, retrieval, reranking, Context Compiler, Context Seal, Sidecar execution, or canonical memory mutation.

UI.Core observes typed state, presents evidence, and routes typed read/inspection actions.

## Cross-lane issue state

### #33 Runtime telemetry
UI-owned observability portion: complete.

Still open because the real Worker-Director-owned telemetry publisher/runtime integration is outside UI.Core and is not proven complete by this fixture work.

### #86 Coprocessor telemetry
UI-owned observability portion: complete.

Still open because the real Sidecar/Jev-owned worker telemetry publisher/execution integration is outside UI.Core and is not proven complete by this fixture work.

No UI completion claim is made for #8, #9, #39, #42, #43, #75 or other backend cards exercised by deterministic UI fixtures.

## Branch discipline

- No new branch created.
- Work remained on \`Development-UI\`.
- No implementation was moved to \`Development-Nexus\`.
- No merge to \`Development-Nexus\` or \`main\` was performed.
