# Area-52 Cognitive Core — Wave 3

## Accepted baseline and implementation checkpoint

- Working branch: `Development-Nexus`
- Accepted starting SHA: `bd42966f3e0fd28cefacacabd1458ef080c32ea7`
- Wave 3 validated implementation checkpoint: `e644b6197731b3a34f70ce17ad179f82a00daf3b`
- `main` was not modified.
- No new branch was created and no other branch was used as workspace.

Wave 3 preserves Wave 1/2 authority and memory contracts. It adds the foreground publication boundary required to turn asynchronous cognitive results into one bounded, truthful, immutable generation context.

## Executable publication path

```text
retrieval candidates
  -> Result Bus
  -> Truth Gate
      -> HIGH: continue
      -> MIXED: one bounded corrective retrieval
      -> LOW: allow no long-term memory
  -> precision contract
  -> Result Bus
  -> publication Context Compiler
  -> Generation Context Seal
  -> immutable packet for Main
```

Canonical mutation remains separate:

```text
proposal
  -> schema/evidence/freshness validation
  -> registered owner boundary
  -> authority/temporal policy
  -> optional operator approval
  -> canonical Settlement owner
  -> decision + receipt/audit
```

Receipt by Result Bus never grants mutation authority.

## #24 Result Bus

### Input

Normalized `CognitiveResult` carrying result/task/turn/correlation/causation identity, subsystem/worker, result class, payload class, destination owner, evidence/provenance, source revisions, world/scene revisions, authority, timing, destination and payload.

### Output

`ResultRoute` records received result, freshness, effective destination, late state, acceptance and deterministic sequence.

Supported destinations:

- FOREGROUND
- NEXT_TURN
- BACKGROUND
- SETTLEMENT
- CACHE
- EVALUATION

### Authority

Result Bus records and routes. It never settles a proposal, canonizes an observation or mutates canonical state.

### Freshness

Source revision, world revision and scene revision are checked independently of semantic usefulness.

- FRESH may route to requested destination.
- STALE remains recordable but is quarantined to evaluation.
- INVALID future-fenced results are rejected from foreground use.
- post-seal foreground results route forward generically rather than by worker-specific hacks.

### Failure/recovery

Duplicate result IDs are idempotently contained. A stale result can be retained for diagnostics/evaluation without masquerading as current cognition.

### Benchmark

Wave 3 tests cover normalized contracts, correlation identity, fresh/stale/invalid routing, proposal authority containment and post-seal late rerouting.

## #7 Truth Gate + corrective retrieval

The accepted Wave 2 `TruthGate` remains the classification authority for:

- CURRENT
- HISTORICAL
- SUPERSEDED
- CONTRADICTED
- UNCERTAIN
- UNRESOLVED

Wave 3 adds `TruthPublicationGate` for retrieval confidence.

### HIGH

Fresh evidence sufficiently answers the requested temporal intent. Continue to precision/compiler.

### MIXED

Useful evidence exists but current resolution is incomplete, historical or conflicting. Emit at most one revision-fenced `CorrectiveRetrievalRequest` in the reference policy.

The request preserves original query, intent, source/world/scene revision fences, prior candidate IDs, reason, missing evidence type, attempt and maximum attempts.

### LOW

No useful long-term memory is admitted. Empty long-term-memory context is a valid outcome.

### Failure/recovery

Corrective retrieval exceptions are contained. Existing evidence and MIXED confidence survive; publication continues conservatively with `CORRECTIVE_FAILED`.

If the one permitted corrective attempt completes without resolving ambiguity, the seal records `CORRECTIVE_EXHAUSTED`. There is no recursive retrieval loop.

Truth determines usability for reasoning. It does not settle canonical truth.

## Precision integration contract

Wave 3 does not install FlashRank, ONNX, TensorRT, ColBERT, BGE or MiniLM.

The deterministic reference implementation emits:

- candidate ID
- raw and normalized score
- final rank
- profile ID/revision
- runtime profile
- latency
- truncation metadata
- freshness
- source/world/scene revision fences

Intent-opposite fixtures cover kill/heal, enter/leave, trust/distrust, intact/destroyed, present/departed and current/historical.

Precision results themselves return through Result Bus. A stale precision result cannot affect foreground publication.

If precision is unavailable or throws, compilation proceeds with deterministic existing ordering and the seal records `PRECISION_FALLBACK`.

## #10 publication Context Compiler

Wave 3 leaves the accepted canonical `ContextCompiler` intact and adds `PublicationContextCompiler`.

### Input

Only Truth-selected knowledge plus optional explicitly historical support and fresh precision metadata.

### Output

Model-independent semantic packet containing:

- current
- historical
- unresolved
- provenance index
- dependencies

A current-location query may publish a temporary `location=unknown` unresolved fact when no settled current location exists but historical/disputed evidence does. This is packet-level reasoning state, not canonical memory.

### Safety

The compiler measures factual, temporal, contradiction and provenance retention.

If compact representation would lose required cognition, or if an impossible budget would require unsafe dropping, it chooses `RICH_FALLBACK` rather than silently trade correctness for size.

### Provenance/freshness

Compiled facts retain source revision dependencies. The packet is disposable and rebuildable; it is not memory.

## #25 Generation Context Seal

### Input

One compiled packet plus turn/correlation identity, source revision dependencies, world/scene revision, admitted/rejected/stale result IDs, fallback state and deadline metadata.

### Output

A deep-frozen packet and `ContextSealReceipt`.

The receipt preserves:

- seal/turn/correlation/packet identity
- stable SHA-256 packet hash
- source revisions
- world/scene revision
- admitted/rejected/stale result IDs
- fallback state
- deadline/seal sequence
- dependencies
- immutable state

### Immutability

A turn seals once. Repeating the same content is idempotent. Attempting to reseal a turn with different packet content fails.

Late cognition can be received and routed to NEXT_TURN/BACKGROUND/CACHE/EVALUATION but cannot mutate the sealed generation.

Source edits after a seal do not retroactively alter old packet content or hash. A future generation rebuilds from the new source revision.

## #37 Settlement hardening

Wave 2's six decision outcomes remain unchanged:

- ACCEPT_CURRENT
- ACCEPT_HISTORICAL
- SUPERSEDE
- CONTRADICT
- UNRESOLVED
- REJECT

Wave 3 places `SettlementBoundary` around the accepted engine.

### Owner integration

`WORLD_STATE` is registered by default and delegates to the Wave 2 engine. Future canonical owners can register their own policy without allowing Result Bus/worker code to write directly.

No specialist future owner semantics are invented here.

### Validation and approval

The boundary performs schema, evidence and freshness validation before owner policy. Unsupported owners reject with no mutation.

Owner policy may declare NONE, OPTIONAL or REQUIRED operator approval. REQUIRED without approval returns an unresolved/pending decision and does not call the canonical mutation function.

### Audit receipt

Settlement audit preserves proposal/destination owner, decision, evidence, source revisions, world revision, authority/temporal information, considered conflicts, superseded/settled artifacts, reasons, validation results, optional judgment metadata and deterministic sequence.

Diagnostic explanation is not canonical knowledge.

## Integrated Ember Tavern / Sun Blade golden world

World:

- Ember Tavern was intact and owned by Mara.
- Eris carried the Sun Blade.
- Eris left the Blade at the Tavern.
- Eris departed.
- Tavern burned down.
- destruction evidence says the Blade was destroyed.
- later journal claims the Blade was removed shortly before the fire.

Query:

> Where can Eris find the Sun Blade now?

Measured result:

- Truth confidence: MIXED
- one corrective retrieval executed and terminated
- precision contributed before seal
- current Tavern state: destroyed
- historical Blade location at Ember Tavern preserved
- current Blade location published as unknown
- destruction and survival/removal evidence preserved as disputed
- no fabricated current location at Ember Tavern
- provenance complete
- late opportunistic precision result accepted but routed to NEXT_TURN
- packet/hash unchanged after late result
- packet/hash unchanged after source edit
- old source revision remains recoverable
- future turn depends on revised source, not old revision

Golden packet hash at validated checkpoint:

`816c7777888dd6d297cb216c60388907838b0d3f1c596a80bf0fad941d272091`

## #43 compression benchmark

Measured deterministic structured baseline:

- raw benchmark representation: 6,012 bytes
- compiled packet: 2,269 bytes
- ratio: 0.377412
- factual retention: 100%
- temporal qualifier retention: 100%
- contradiction retention: 100%
- unresolved-thread retention: 100%
- provenance retention: 100%
- relationship retention: 100%

The production LLMLingua-2 comparison remains unperformed; no heavy dependency was installed.

## #57 ordering benchmark

Wave 3 created five reusable order variants across:

- current state
- character state
- unresolved threads
- supporting lore
- historical evidence

Current state is exercised at positions 0/1/2; unresolved evidence at positions 0/2/4.

No provider-specific winner is declared. Cross-model measurement remains future work.

## Validation

GitHub Actions validated the exact branch bytes at implementation checkpoint:

- **41/41 tests PASS**
- Wave 1: **10/10 preserved**
- Wave 2: **12/12 preserved**
- Wave 3: **19/19 PASS**
- JavaScript syntax checks: PASS
- ESM module load: PASS
- Wave 3 acceptance report: PASS

Failure-mode regressions include:

- stale/invalid Result Bus containment
- unsupported Settlement owner
- approval-required no-mutation state
- evidence/freshness rejection with no partial mutation
- bounded corrective termination
- corrective worker failure
- precision worker failure
- LOW empty-memory publication
- rich compiler fallback
- late-result routing after seal
- old sealed generation stability after source edit

## Boundaries and deferred work

Not implemented in this wave:

- Scene Intelligence
- Worker Director / Runtime Fabric
- Sidecar swarm
- production reranker
- provider-specific prompt formatting
- UI.Core
- final persistence backend
- full specialist canonical owner policies
- production human-approval UI/workflow
- LLMLingua-2 runtime comparison
- cross-model ordering measurements

The publication contracts are deliberately compatible with those future lanes without implementing their internals.
