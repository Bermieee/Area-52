# Generation diagnostics repair

Base: main `d21b552c1d7435fc3bcae95839028c031405a186`.

## Changes

- Installed entry no longer registers the removed development-demo renderer. Normal host notifications therefore do not construct and clone a complete evidence export for that absent consumer. Diagnostics Center and explicit export remain available.
- Sidecar and Jev execution records retain explicit chat/turn/generation/correlation identities supplied by their owners. Scene Jev retains the same selection through its existing adapter. Diagnostics fences all optional resource attempts and owner-acceptance projections to the selected generation. Missing identities stay unproven; task IDs are not parsed to invent identity.
- Missing final completion text remains a typed failure. Safe response metadata records choice count, allowlisted finish reason/content type, reasoning-field presence, tool-call count and numeric token usage. It never stores reasoning text, prompts, tool arguments or response bodies. Existing Diagnostics resource drillback and JSON export carry these fields.
- Gather routing counts and final Seal admission counts remain distinct. The supplied second run contained six routed results and five final admissions; this repair does not force those counters to agree.

## Validation

The focused provider/resource, Scene/Jev production path, host delivery, Diagnostics journal/export, decision-visibility and profiling suites passed: **85 tests, zero failures**. Regression tests first reproduced the obsolete callback, foreign/unfenced attempt attribution and missing failure metadata.

Copied-checkpoint digests were refreshed only for six changed production paths. Local assembly verification reports 23 mismatches in unchanged Memory/UI/resource-host files; none is a modified production path. Windows checkout CRLF was normalized in this isolated checkout before byte-digest verification.

## Installed follow-up

Measure the next profiled generation using this build. Compare host-notification cost and browser long tasks. If Scene observation fails, inspect its exact-generation resource attempt for finish reason, content type, reasoning presence and token counts. These repairs do not claim to fix provider-side missing content or to eliminate all browser lag.
