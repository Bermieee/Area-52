# Cognitive Coprocessor — Wave 10 Changelog

## Jev evaluation / #212

- added versioned 13-case Jev golden corpus covering every #212 required decision class;
- added deterministic-only, raw-provider and Jev adjudication comparison with per-case safety evidence;
- added reproducible JSON/Markdown report and CI artifact generation;
- added Jev-specific provider qualification using existing capability profiles and provider adapters;
- added malformed-output, timeout, bounded fallback, disagreement, stale-result, late-result and consistency qualification;
- added opt-in real-provider Jev smoke with execution-time configuration and explicit SKIPPED state when unconfigured;
- added browser-safety, full regression, syntax and exact-head CI gates;
- preserved proposal-only authority and avoided the #211 repair worker's owned replay/domain-adapter files.

## Non-claims

This wave does not implement Lore, Memory, Temporal, Runtime, Core, UI or Settlement ownership. It does not claim FT005/#180 or #224 passed. Wave 9 remains a candidate pending Director acceptance; #211 acceptance is not inferred from Wave 10.
