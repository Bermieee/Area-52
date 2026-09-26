# UI.Core Wave 3 — Test / Syntax Evidence

**Validated commit:** \`95b58b22d17fae3a6422e56a08423a93d8845c89\`  
**Workflow:** \`.github/workflows/ui-core-wave3.yml\`  
**Run:** \`35821826935\`  
**Runner:** Ubuntu 24.04 / Node 22.23.2

## Deterministic regression command

\`\`\`text
npm test
\`\`\`

Result:

\`\`\`text
tests 57
pass 57
fail 0
cancelled 0
skipped 0
todo 0
\`\`\`

The 57 tests comprise the existing Wave 1 and Wave 2 suites plus 26 Wave 3 tests. The existing Wave 2 16/16 acceptance suite remains green.

Wave 3 coverage includes:

- adapter compatibility;
- lightweight runtime telemetry;
- on-demand worker/ledger detail;
- raw-payload exclusion from normal telemetry;
- worker-transition keyed coalescing;
- queue/utilization/capacity field signals;
- lifecycle obligation persistence independent of worker parking;
- Work Ledger paging/detail;
- current/historical/unresolved state rendering contracts;
- memory lineage;
- Settlement trace;
- Reflection weakening;
- episodic provenance;
- adaptive Candidate Bus budget;
- Candidate Bus keyed coalescing;
- rerank inspection;
- intent-opposite precision fixtures;
- implementation-neutral benchmark metadata;
- foreground timeout/fallback;
- coprocessor telemetry;
- Gather quorum through deterministic fallback;
- stale/dedupe containment;
- Context Seal late-result containment;
- large-history paging/virtualization;
- stress collection sizes;
- mount/destroy/remount cleanup;
- integrated 18-step Ember Tavern scenario.

## JavaScript syntax command

\`\`\`text
find src demo tests -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
\`\`\`

Result: **PASS**

## Module import command

\`\`\`text
node -e "import('./src/ui-core/index.js').then(() => console.log('UI.Core index import PASS'))"
\`\`\`

Result:

\`\`\`text
UI.Core index import PASS
\`\`\`

## Performance assertions

- 1,500 same-worker transition events -> one pending keyed runtime render.
- 1,200 same-stage Candidate Bus events -> one pending keyed funnel render.
- 12,000 Work Ledger records remain paged.
- 12,000 precision candidates remain paged/virtualizable.
- raw prompts/responses/debug payloads are excluded from normal coprocessor telemetry and require explicit detail access.
