# Cognitive Coprocessor Wave 13 Changelog

## Scope

Wave 13 implements the Coprocessor-owned half of #225 without creating a competing cognitive controller.

## Added

- bounded `CoprocessorChoiceProposal` and `CoprocessorChoiceOption` contracts;
- explicit inventory of nominated, skipped, deferred and unavailable cognitive functions;
- deterministic proposal identity over turn/policy/revision/capability state;
- expected-value and estimated latency/cost receipts;
- capability-profile, provider-health/load and resource-count evidence;
- owner-gated corrective retrieval, Jev and external-grounding recommendations;
- bounded Jev question identity with no continuously retained raw question text;
- `CoprocessorChoiceExecutionTrace` joined by task ID or stable choice-option ID;
- typed Runtime/provider states including timeout, abort, stale, invalid and late;
- Core-facing `CoprocessorChoiceContribution` that deliberately leaves final choice/Truth/Precision/evidence/Seal fields unset;
- bounded choice history;
- choice telemetry counters and event types;
- `DynamicFanOutPlanner.planChoice()` wrapper while preserving existing `plan()`;
- 11-case cognitive-choice evaluation corpus;
- one-resource / multi-resource, replay, provider-pressure and stale/late stress;
- browser portability and network-free default guards;
- exact-head Wave 13 Actions workflow.

## Repair-owned boundaries preserved

Wave 13 does not modify:

- `src/coprocessor/jev-decision-core.js`
- `src/coprocessor/jev-domain-adapter.js`
- `src/coprocessor/native-coprocessor-bootstrap.js`
- `evaluation/jev-wave11-evaluator.mjs`
- `tests/coprocessor-wave11-*`

Worker 4's #211 replay repair remains on its owner head until transferred through the appropriate integration path.
