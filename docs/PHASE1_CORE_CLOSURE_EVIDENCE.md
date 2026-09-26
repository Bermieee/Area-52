# Phase 1 Core Closure Evidence — Worker 1 Wave 3

This document is the human-readable companion to `scripts/phase1-core-closure-evidence.mjs`. CI emits the machine-readable evidence object using the exact `GITHUB_SHA`.

## Accepted starting point

- branch: Development-Nexus
- Wave 2 accepted SHA: `69778d22ba5717258ee75d8244632a745acdfcc0`
- prior accepted full suite: 98/98
- prior diagnostic acceptance: 29/29

## Wave 3 functional evidence

Before the documentation commit, Cognitive Core CI run **35957624434** passed the complete implementation:
- full repository tests: **113/113**;
- syntax: PASS;
- ESM import: PASS;
- existing Wave 3 publication acceptance: PASS;
- Wave 4 Adaptive Context: **26/26**;
- Framework Wave 1: **3/3**;
- Cognitive Audit Wave 2: **29/29**;
- Cognitive Audit stress: PASS;
- Context Closure Wave 3: **19/19**;
- Delivery Learning stress: PASS;
- Core source browser scan: **56/56**;
- Core browser-runtime execution: **7/7**.

The final documentation SHA must rerun this same matrix before handoff.

## Structured context benchmark

Measured Ember Tavern fixture:
- raw bytes: 6,012;
- compiled bytes: 2,269;
- ratio: 0.377412;
- required retention metrics: 1.0.

LLMLingua-2 direct comparison: NOT_MEASURED in this Worker 1 environment.

Target-model ordering comparison: NOT_MEASURED in this Worker 1 environment.

## Delivery Learning stress

Measured:
- PromptPlan evaluations: 1,200;
- feedback records produced: 600;
- bounded feedback retained: 500;
- policy candidates: 120;
- qualified policies: 120;
- ready plans: 1,200;
- integrity failures: 0;
- optional omission/defer pressure cases: 60;
- reuse cases: 1,079.

The suite also proves deterministic candidates for equal evidence, minimum-evidence gating, protected semantic floors, future-only policy effect, immutable Context Seal, old PromptPlan reconstructability, rollback and bounded feedback/policy history.

## Remaining shared / external work

Open shared/integration dependencies remain:
- #46 provider execution side;
- #125 Runtime activation/scheduling;
- #131 Runtime Event Spine transport;
- #145 PromptPlan UI;
- #152 forensic timeline UI;
- #157 program-wide Phase 1 promotion gate;
- #185 assembled-main/live browser host acceptance;
- #186 real main reconstruction.

External measurement gaps remain #43 and #57.

No Phase 2 cognition was started.
