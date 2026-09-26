# Core UI Observation Contracts

Worker 1 supplies read-only backend projections for UI.Core. No DOM, CSS, workspace, widget or visual implementation is owned here.

## ContextReceiptReadModel

Answers "What did this generation receive?" with:
- turn/generation identity;
- Context Seal and PromptPlan identity;
- packet hash/model profile;
- world/scene/source revisions;
- included, omitted and deferred sections;
- unresolved evidence;
- reused and rebuilt segments;
- budget/estimated tokens;
- fallback state;
- provenance references;
- Widget Health.

## PromptPlanReadModel

Exposes slot allocation, section ordering, representation density, reuse/cache decisions, dropped/deferred reasons, model/profile revision, delivery-policy revision, integrity state and revision identities. Massive prompt bodies are excluded by default.

## ForensicReadModel

Projects source revisions, Runtime work references, worker result references, Truth, Precision, Gather, Cognitive Transactions, Settlement references, Context Seal, PromptPlan, late/stale results, diagnostic reasons and assembly provenance.

## Widget Health

Core vocabulary:
- READY
- WORKING
- DEGRADED
- STALE
- BLOCKED
- ERROR

Authority/status fields preserve explicit labels such as SOURCE_CANON, OBSERVED, SETTLED, INFERRED and UNRESOLVED where relevant. UI is never required to infer authority from confidence or color.

All projections are deep-frozen clones with `mutationAuthority:false`. Editing a projection cannot mutate Core cognition.

Read models include enough turn/generation/seal/plan/world/scene/source identity for stale UI updates to be rejected.

Deterministic UI fixtures cover healthy, late-opportunistic, unresolved, optional-dependency degraded, validation-failure and reuse states.

These contracts are Worker 1 readiness contributions to #145, #152 and #187. Those UI-owned cards remain open.
