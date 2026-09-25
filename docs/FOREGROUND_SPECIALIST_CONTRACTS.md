# Foreground Specialist Contracts

## Shared rules

Every specialist:

1. receives a bounded typed input;
2. treats source/candidate text as untrusted data;
3. returns strict JSON only;
4. emits references rather than copied source objects where possible;
5. is validated against known input references;
6. carries revision/intent freshness;
7. remains non-canonical.

## Historian

Input:

- intent;
- active entities;
- scene refs;
- candidate evidence refs/summaries;
- source/world revision context.

Output:

- refs[];
- relevance[{ref,score}];
- uncertainty;
- reasoningSummary.

Historian can declare evidence relevant. It cannot declare relevance equal to current canon.

## Graph Walker

Input:

- bounded nodes;
- bounded edges;
- supplied state refs;
- conflicts.

Output:

- node refs;
- edge refs;
- currentStateRefs;
- historicalRefs;
- unresolvedRefs;
- conflict refs;
- reasoningSummary.

The validator rejects historical/unresolved state promoted to CURRENT.

## Truth / Precision

Input:

- evidence refs/statements;
- conflict sets;
- required refs;
- intent.

Output:

- assessments;
- ranking;
- rejected refs;
- uncertaintyPreserved.

Classifications:

- SUPPORTED;
- CONFLICTING;
- INSUFFICIENT;
- UNRESOLVED;
- LOW_CONFIDENCE.

Credible conflict sets cannot be collapsed into a single supported winner, and required contradictory evidence cannot be silently dropped.

## Corruption rejection

Permanent tests cover:

- prose around JSON;
- truncated JSON;
- wrong enum;
- unknown refs;
- duplicate refs;
- omitted required fields;
- unsupported/fake state;
- historical/current collapse;
- out-of-range confidence;
- prompt echo/unknown fields;
- source text attempting instruction override.
