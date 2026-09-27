# Worker 4 causal telemetry and selected-turn report contract

## Lineage and ownership

- Repository: `Bermieee/Area-52`
- Worker branch: `Development-Worker-4`
- Verified starting base: `main@f0f742d1335cce9a1d5a028714a773030cbe638f`
- Worker 3 branch was also verified at that same base before this interface was added.
- This wave extends the existing `DemoEvidenceJournal`, selected-turn Brain receipt, Turn Log, Runtime/Coprocessor read models, and Diagnostics evidence. It does not create a second logger.
- Worker 3 remains owner of the visible report button and workspace refresh redesign. Worker 4 publishes a read-only data contract only.
- Worker 1 remains owner of cognitive decisions and lifecycle admission. Worker 2 remains owner of execution/resource scheduling. This wave does not alter either policy.

## Worker 3 consumer API

Worker 4 publishes a pure reader and intentionally does **not** modify Worker 3's active Diagnostics workspace or `wave6-runtime.js` surface. Worker 3 advanced those files while this wave was in progress, so the integration boundary is kept conflict-free.

```js
import { SelectedTurnCausalReportReader } from '../selected-turn-causal-report.js';

const causalReport = new SelectedTurnCausalReportReader({
  journal: evidenceJournal,
  selectionProvider,
  loadTraceProvider: () => uiLoadTrace.snapshot(),
});

causalReport.read({ operatorObservations? });
causalReport.summaryText({ operatorObservations? });
causalReport.exportDetailed({ operatorObservations? });
```

A caller may also pass an explicit `selection` to any method. Otherwise the supplied selected-chat / turn / generation provider is used.

The contract kind is `Area52SelectedTurnCausalReport@1.0.0`. Report assembly is strictly on demand: constructing the reader does not scan the journal and generation-time evidence capture does not assemble a report.

Worker 3 can render or copy `pasteableSummary` and can use `exportDetailed()` for a bounded safe export. The visible button, layout, refresh cadence, Diagnostics integration, and presentation remain Worker 3-owned. This branch supplies no UI button and does not alter Worker 3's current workspace files.

## Selected-turn report fields

The read model preserves the real selected-turn identity and revision fence:

- chat ID, turn ID, generation ID, correlation ID;
- world and Scene revisions;
- bounded source-revision references.

It returns these major sections:

- `generationOutcome`: observed host delivery, planned-only, or `NO_EVIDENCE`;
- `connections`: expected owner boundaries and evidence for each boundary;
- `obligations`: owner-declared expected cognitive work reconciled as `DONE`, `DUE`, `BLOCKED`, `FAILED`, `SKIPPED_WITH_REASON`, `DEFERRED`, `STALE`, or `LATE`;
- `jobs`: logical jobs, physical-start evidence, returned results, and owner admission;
- `optionalResources`: configured, qualified, physically attempted, returned, succeeded/failed, and owner accepted/rejected as separate facts;
- `evidence`: Gather disposition, Context Seal admission, and owner admission counts;
- `missingOrBlocked`: explicit missing owner evidence and unresolved expected work;
- `delivery`: Context Seal, PromptPlan, and observed host delivery as separate states;
- `timing`: owner-published durations plus measured telemetry overhead;
- `uiLoad`: bounded `OperatorLoadTrace` attribution when measured;
- `operatorObservations`: manually supplied numeric observations, always marked `OPERATOR_OBSERVATION` and `UNPROVEN` causal attribution;
- `retention`, `authority`, and `safety`.

## Evidence semantics

The report never turns a connection badge into an execution claim.

These states are intentionally distinct:

```text
configured
  != qualified
  != physically attempted
  != returned
  != owner admitted
  != Gather admitted
  != Context Seal admitted
  != PromptPlan planned
  != observed at the SillyTavern host boundary
```

An expected owner boundary without a matching receipt is `NO_EVIDENCE`. Adjacent successful stages do not fill that gap.

For optional Jev / Sidecar / Vectoring work, `configured` or `qualified` is never counted as exercised. Physical execution requires explicit attempted/returned evidence. Owner acceptance requires an owner receipt.

## Journal, fencing, and retention

The existing bounded evidence journal now also retains a safe projection of `NativeBrainExpectedWorkReadModel`. It does not store arbitrary owner objects.

Selected-turn reads are fenced by chat, turn, generation, correlation, world revision, Scene revision, and source-revision set when those values are known. A corrected same-generation revision fence replaces the stale same-key journal record rather than cross-filling old evidence. Regeneration and chat-switch identities remain distinct.

Turn-count, row-count, and serialized-size ceilings remain enforced. When noise must be pruned, retention preferentially preserves the latest useful host-delivery observation (or delivery owner-edge evidence) instead of blindly deleting it with the oldest rows.

Repeated capture of identical evidence remains idempotent and does not append duplicate rows.

## Safety and authority

Persisted/exported telemetry is metadata-only. Sanitizers reject or redact prompt/content/message/response/Lore/story/credential/API-key/authorization/secret/token/reasoning fields, including common underscore/case variants. Arbitrary live exception bodies are not retained.

The report and journal explicitly have no:

- Truth authority;
- Settlement authority;
- Context Seal authority;
- canonical mutation authority;
- Runtime scheduling authority.

The telemetry path is read-only and cannot make a cognitive decision complete merely to make a trace look complete.

## UI-load and memory interpretation

`OperatorLoadTrace` can attribute bounded measured UI categories including:

- `UI_WORKSPACE_REFRESH`;
- `UI_JOURNAL_PROCESS`;
- `UI_CAPTURE_TOTAL`;
- `OWNER_SELECTED_TURN_READ`.

The selected-turn report labels those values `MEASURED_UI_TRACE`. The Worker 4 benchmark separately labels its measurements `LOCAL_DETERMINISTIC_NODE`; neither is an installed-SillyTavern browser performance pass.

The operator recently observed workspace refresh around **733 ms average** and **783 ms peak**, and roughly **2.5 GB** for the SillyTavern tab in Edge Task Manager during generation. Those are observations, not a proven memory-cause relationship. Browser Task Manager memory is deliberately `UNAVAILABLE_BY_CONTRACT` for automatic telemetry. If a UI supplies the 2.5 GB number manually, it must be passed as an operator observation and remains `causalAttribution: UNPROVEN`.

## Current producer gaps

The report makes producer gaps visible instead of manufacturing evidence:

- Sidecar and Vectoring can remain `NO_EVIDENCE` at the selected Brain boundary unless their actual owner publishes a receipt for that turn.
- Optional Jev may be deliberately skipped and is not a provider execution unless physical-attempt evidence exists.
- Memory and Lore may be unavailable/skipped when their owner integration is absent; owner acceptance is never inferred.
- A Brain observed-host receipt can prove an observed matching request boundary. Response completion is not inferred unless the richer SillyTavern host delivery receipt publishes it.
- Authenticated optional-provider execution in installed SillyTavern remains an installed-host acceptance item.

## Acceptance matrix for this wave

| Contract | Completed in this branch | Still requires installed-host / owner evidence |
| --- | --- | --- |
| Turn receipts and bounded cognitive telemetry (`qhN7QFjA`) | Existing journal extended with revision fencing, expected-work projection, delivery-preserving retention, stricter sanitization, and on-demand safe report/export. | Long-run installed-host retention and real operator workload observation. |
| Publish causal owner receipts to Diagnostics/UI (`KzbGIpef`) | Existing causal owner skeleton retained; Brain owner evidence, runtime jobs, optional lifecycle, expected work, delivery, and `NO_EVIDENCE` are consumable through one report. | Any stage whose owner still does not publish a receipt remains explicitly open. |
| Cognitive obligation reconciliation (`sPXNjdi5`) | Existing reconciler states flow into the same selected-turn journal/report and Turn Log without inventing completion. | Installed-host correction/cancellation/late-result exercises remain a separate gate. |
| Runtime telemetry (`qIcCKcUJ`) | Existing bounded Runtime receipts are consumed; detailed report remains on-demand; no scheduler changes. | Installed-host timing/capacity characterization. |
| Coprocessor telemetry (`uDVSTdg8`) | Existing resource lifecycle evidence is consumed with configured/qualified/attempted/returned/owner-accepted separated. | Authenticated live optional-provider observation. |
| Diagnostics workspace/job drilldown (`pkgl8Xv2`) | Worker 3 gets the pure `SelectedTurnCausalReportReader` contract plus the enriched existing journal rows. | Worker 3 owns wiring that reader into its advancing Diagnostics branch, the report button/layout, and workspace refresh overhaul. |

Deterministic fixture acceptance is evidence for code contracts only. It is not promoted to an installed SillyTavern pass.
