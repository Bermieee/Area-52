# Worker 2 → Worker 3: row 65 bounded Memory transport handoff

## Scope

Cap-remediation row 65 is not a request to remove the existing bounded provider inputs. The current deployment path intentionally sends:

- at most eight recent Memory episodes into the consolidation proposal path;
- at most 2,400 characters of exact Memory drillback per consolidation evidence slice;
- at most eight Jev evidence rows;
- at most 1,200 characters in each Jev evidence summary.

Those are transport limits, not Memory retention limits. Exact Memory evidence and source revisions remain owner-backed and must stay recoverable.

Worker 3 owns `src/deployment/brain.js`. Worker 2 does not edit that shared file. This handoff supplies the narrow integration needed to make the transport boundary truthful.

## New Worker 2 helper

Use:

```js
import {createMemoryTransportExcerpt} from '../memory-transport-excerpt.js';
```

(adjust the relative path to the deployment module's actual import location).

The helper returns:

```js
{
  excerpt,
  coverage: {
    coverageComplete,
    exhaustiveEvidenceTransported: false,
    originalCharacters,
    transmittedCharacters,
    omittedCharacters,
    limitCharacters,
    reasonCode,
    canonicalKnowledgeDropped: false
  },
  drillback: {
    artifactRef,
    artifactRevision,
    provenanceRef,
    sourceRevisionRefs,
    sourceRevisionCount,
    sourceRevisionRefsComplete,
    evidenceRefs,
    evidenceRefCount,
    evidenceRefsComplete,
    exactSourceDrillback: true,
    exhaustiveEvidenceTransported: false
  },
  structuredFacts: [coverage, drillback]
}
```

The excerpt is deliberately transport-only. The receipt says explicitly whether bytes were omitted and points back to owner evidence instead of pretending the excerpt is exhaustive.

## Consolidation callsite

Current deployment logic obtains exact drillback, joins it, and then performs `.slice(0,2400)`.

Replace only that manual slicing step. Conceptually:

```js
const exact = episode ? this.memory.experienceStore.exactDrillback(episode.id) : [];
const exactText = exact
  .map((row) => String(row?.exactContent ?? row?.content ?? ''))
  .filter(Boolean)
  .join('\n');

const transport = createMemoryTransportExcerpt({
  text: exactText,
  maxCharacters: 2400,
  artifactRef: ref,
  sourceRevisionRefs: episode?.sourceRevisionRefs ?? [],
  evidenceRefs: exact.map((row) => row?.id).filter(Boolean),
  provenanceRef: 'memory-drillback:' + ref.artifactId,
  transportPurpose: 'CONSOLIDATION_EVIDENCE'
});

dispatchedPayloadCharacters += transport.excerpt.length;

return {
  ref,
  excerpt: transport.excerpt,
  structuredFacts: transport.structuredFacts,
  provenanceRef: 'memory-drillback:' + ref.artifactId
};
```

If the episode has segmented Memory references, use Worker 2's `memoryReferenceValues(episode, 'sourceRevisionRefs')` rather than reading only the legacy head segment.

No provider-payload schema change is required. `createConsolidationProviderInput()` already preserves bounded `structuredFacts` on each selected context slice.

## Jev callsite

Current deployment logic performs:

```js
summary: String(row.representationText ?? query).slice(0, 1200)
```

Build the same bounded excerpt with the helper and carry the receipt in Jev evidence `metadata`:

```js
const transport = createMemoryTransportExcerpt({
  text: String(row.representationText ?? query),
  maxCharacters: 1200,
  artifactRef: row.artifactRef ?? null,
  sourceRevisionRefs: row.sourceRevisionRefs ?? [],
  evidenceRefs: row.evidenceRefs ?? [],
  provenanceRef: row.representationRef ?? null,
  transportPurpose: 'JEV_EVIDENCE'
});

return {
  evidenceId,
  sourceRef: row.representationRef,
  summary: transport.excerpt,
  provenanceRefs: /* existing bounded refs */,
  revision: row.representationRevision ?? 1,
  available: true,
  stale: false,
  metadata: {
    transportCoverage: transport.coverage,
    drillback: transport.drillback
  }
};
```

Jev already preserves a bounded `metadata` object for each evidence row, so no Jev contract expansion is required.

## Acceptance

Worker 3 integration is complete when deployment tests show:

1. a short Memory input reports `coverageComplete: true`;
2. a long Memory input reports `coverageComplete: false` plus a positive `omittedCharacters`;
3. neither path labels the transport excerpt as exhaustive Memory evidence;
4. artifact revision and owner drillback identity survive into Consolidation/Jev input;
5. existing 2,400 / 1,200 / eight-row transport limits remain enforced;
6. no raw chat, whole Memory store, hidden reasoning, or unbounded source body is added to provider input.

Worker 2 regression coverage: `tests/cap-remediation-memory-transport-excerpt.test.mjs`.
