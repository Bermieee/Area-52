# Development Deployment — Main Review Package

**Status:** review candidate only. This document does not authorize a merge.

## Worker 4 lineage

- Worker 4 demo-repair starting deployment SHA: `fb463f596922fb8ac08bbddaf5786eb80ac4099e`.
- `main` verified at Worker 4 start: `8138be59308873fb164c167eadd9e1a58c10364e`.
- That `main` head was fast-forwarded into `Development-Deployment` as an ancestor before Worker 4 repairs. Worker 4 has not mutated `main`.
- Worker 1 Memory accepted pin: `94669e656f7ebf24b072cdde2f31e3b3cf5d0b2f`; current worker branch head inspected at handoff: `51aa0d6e7293ddeaa3899e81f6699794d0c22b2c`.
- Worker 2 Sidecar/Jev accepted/current pin: `e4da2ffcabd8a385b44fc1836b95a85836cfaf6e`.
- Worker 3 UI accepted/current pin: `751b23fe2209165295d047106c35bce160e74a5c`.
- Exact copied-path digests and deployment-only reconciliations are recorded in `assembly/lanes/*.json`.

## Worker 4 integration repairs

The deployment line additionally preserves:

- story-independent live Scene initialization and generic turn classification;
- deterministic Ember data only as a regression fixture, never as a live-host prerequisite;
- arbitrary authored Lore fallback that preserves exact source text without inventing semantic claims;
- Memory consolidation source sets using the dedicated consolidation bound while retaining the smaller per-artifact bound;
- Jev replay retention/freshness/seal fencing;
- negotiated capability fallback without allowing arbitrary provider-profile bypass;
- real optional-resource host bindings into Wave 13 connect/test/disconnect controls;
- split Lore accepted/processed/retrievable lifecycle into Wave 13 Lore Study;
- selection-aware Memory UI reads;
- measured-live provider evidence kept distinct from deterministic Jev fixture/fallback evidence.

## One integrated Brain invariant

The candidate remains one installable SillyTavern extension. Optional Jev/sidecar resources can be attached, inspected, tested, disconnected, or absent. No database, SQL server, Redis, Dapr, external orchestrator, or remote model provider is mandatory for native Brain operation.

## Remaining gates

Do not promote until all of the following are true:

- exact-head Development Deployment CI is green, including Memory Wave 4, Coprocessor Wave 4/13/14, Wave 13 UI, digest verification, full syntax/regression, and live-package host tests;
- clean install / branch switch and a subsequent normal fast-forward update are verified in real SillyTavern;
- two unrelated real stories complete without fixed-scenario assumptions;
- Prompt Inspector confirms the sealed Area-52 PromptPlan entered the actual generation request;
- Wave 13 navigation/resource/Lore controls are usable in the installed extension;
- Lore acceptance is distinguished from processed/retrievable knowledge;
- no-resource, connected-resource, and disconnected/failing-resource behavior is reviewed;
- #180/FT005 remains open unless a real configured provider call carries measured-live provenance;
- the user reviews exported evidence and the Director approves promotion.

#224 remains open even after operator capture; the evidence exporter intentionally cannot auto-complete the gate.

## Promotion / rollback

Promotion must be an ordinary reviewed fast-forward/merge of the verified candidate into `main`; do not force-update `main`.

Record the pre-promotion `main` SHA and the approved candidate SHA. If rollback is required after promotion, prefer a history-preserving revert of the promotion commit. Before promotion, rollback is simply leaving `main` untouched.
