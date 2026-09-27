# Vectoring Causal Telemetry Design

## Problem and observed evidence

The installed diagnostics export from 2026-09-27 16:06 shows a qualified OpenRouter Vectoring resource and two successful physical embedding requests (about 1.4 s and 3.5 s). Its resource read model has only the latest execution, no operation or selection identity, and no owner outcome. The selected-turn journal assigns resource activity to the selected generation even when the underlying resource record has no turn identity. Brain's selected-turn Vectoring → Gather edge remains `NO_EVIDENCE`; Gather admitted zero results. The operator cannot distinguish a foreground query from background Memory artifact indexing or tell whether a vector result influenced retrieval.

## Intent and boundary

The operator must be able to answer, for each embedding attempt: why it ran, whether it succeeded, which owner received the result, what that owner did with it, and whether any resulting candidate reached Truth, Gather, Context Seal, or the host request. Background indexing must remain visible as background work without becoming selected-turn proof. A successful provider call alone grants no Truth, Gather, Seal, or prompt authority.

## Approaches considered

1. **Recommended: linked bounded receipts at existing owner boundaries.** Preserve a small execution history in the resource connection, carry an opaque execution ID and exact selection through Memory's query path, and link Memory query/index outcomes to that ID. Diagnostics joins metadata-only receipts and shows explicit missing links. This fits current Resource, Memory, and Diagnostics ownership without a new event service.
2. Infer purpose from provider timestamps and UI selection. This is cheap but recreates the present false attribution: background maintenance can finish during a selected turn.
3. Introduce a general cross-owner trace bus. That might support future subsystems but broadens authority and retention scope beyond the observed Vectoring gap.

## Receipt contract

Each physical embedding attempt publishes a bounded `VectorExecutionReceipt@1` with an opaque execution ID, resource/provider/model identifiers, operation (`EMBED_QUERY` or `EMBED_ARTIFACT`), status, timing, vector count/dimensions or bounded failure code, and `requestPurpose: COGNITIVE_EXECUTION`. A foreground query carries exact chat, turn, generation, and correlation IDs from its Memory retrieval selection. Background artifact indexing carries chat and opaque Memory work/artifact revision references but **no turn or generation ID**. The same ID appears in the returned provider result and in the Memory owner outcome.

Memory's query receipt records provider execution ID, candidate count, query hash, and `ACCEPTED_FOR_HISTORIAN_NOMINATION`, `REJECTED`, `UNAVAILABLE`, or the actual owner reason. An artifact indexing receipt records the execution ID, work ID, and `ACCEPTED`/rejected/deferred outcome for the Memory vector index. The provider receipt says only that an embedding was returned; the Memory receipt says whether the owner retained or used it. Existing Candidate Bus, Truth, Gather, Seal, and host receipts remain the only evidence for their respective later stages. Diagnostics must not backfill them from a vector success.

All receipts are bounded in count and size. They contain no input text, raw Memory/Lore content, embedding arrays, API key, raw provider response, or hidden reasoning. Provider request ID is optional and treated as metadata. No new canonical or prompt mutation authority is introduced.

## Data flow and presentation

`MemoryVectorIndex.primeQuery` supplies its exact selection and operation to the deployment Vectoring executor; `runMaintenance` supplies its work ID, artifact revision, chat ID, and `EMBED_ARTIFACT`. The deployment bridge forwards only this metadata to `CoprocessorResourceConnections.executeEmbedding`. The resource registry records physical execution and returns its opaque execution ID. Memory stores its own subsequent outcome with the same ID.

The existing Diagnostics Center owns the presentation. Its selected-turn resource/causal section includes only receipts whose chat, turn, and generation all match; a resource call without that identity is not assigned to the selected turn. Its existing resource and Memory diagnostics sections show recent background artifact-indexing receipts separately. For a selected query, the Diagnostics Center shows the stages `provider attempt → provider result → Memory decision → nominations → Truth → Gather → Seal → host observation`, with `NO_EVIDENCE` or `NOT_APPLICABLE` where the relevant owner has not published proof. An embedding of an artifact is `NOT_APPLICABLE` to Gather unless a later exact retrieval nominates that artifact.

The existing single-JSON Diagnostics export carries the same bounded trace. The Diagnostics Center renders concise rows with operation, outcome, latency, destination, and stage details using its current inspection pattern. There is no separate Vectoring workspace, new activity feed, or independent telemetry UI. Existing resource health/qualification displays remain separate.

## Failure and identity rules

- A failed, aborted, timed-out, or unavailable provider call has no successful embedding result or Memory acceptance claim.
- A result arriving after the foreground budget, after revision invalidation, or after a generation switch remains associated with its original identity and cannot be relabeled current.
- Memory may reject a valid embedding for stale artifact/source revision; Diagnostics shows physical success and owner rejection independently.
- Missing Memory or downstream receipts remain `NO_EVIDENCE`; timestamps, current UI selection, model name, and connection state cannot substitute for exact IDs.
- Qualification probes remain outside cognitive execution history.

## Verification

Tests must reproduce the 16:06 evidence shape: two successful provider calls, one foreground query and one background index. They must prove exact-turn filtering; no background call counted as selected-turn execution; owner accepted/rejected/unavailable outcomes; nomination count without false Gather/Seal/host claims; stale generation exclusion; bounded history; safe JSON export; and continued browser-facing module imports. A deterministic assembled path should show a query execution ID linked through Memory and, when a candidate is actually nominated, independently through the existing Truth/Gather/Seal receipts. Installed SillyTavern remains the final observational check for configured OpenRouter execution and operator display.
