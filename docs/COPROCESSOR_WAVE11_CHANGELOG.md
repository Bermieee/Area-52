# Coprocessor Wave 11 Changelog

- Added browser-safe native-first Coprocessor bootstrap and built-in deterministic capability inventory.
- Added explicit optional Jev/sidecar slot discovery with unavailable/degraded reasons and no implicit network/service dependency.
- Added capability eligibility contract without creating a parallel Worker Director.
- Added native bounded turn result, optional proposal admission fence, Context Seal/deadline/freshness handling, and versioned assembly seam.
- Extended the Wave 10 13-case corpus with a sidecar-proposal-only baseline using the identical evidence set.
- Replaced fixture timing as acceptance evidence with elapsed wall-clock measurements around local deterministic execution and controlled delayed/timeout adapters.
- Added controlled network-unavailable, malformed-output, timeout/fallback, no-provider, repeatability, hot/deep, browser-source and no-optional-install tests.
- Preserved Jev proposal-only authority and the #211 repair boundary.