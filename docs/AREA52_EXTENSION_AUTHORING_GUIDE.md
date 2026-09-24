# Area-52 Extension Authoring Guide

## 1. Declare the subsystem

Create a `SubsystemManifest` with stable identity/version/owner and begin in `EXPERIMENTAL`. Declare everything the service consumes, produces, requires and may attempt. Do not hide dependencies, capabilities or authority.

## 2. Register artifact types

Register each new produced artifact type with a schema version, owner, payload validator and repository domain. Put domain-specific semantics in the payload; keep the common envelope stable.

## 3. Register event types

Register event identity/version/payload validation through `EventTypeRegistry`. Runtime/Event Spine still owns delivery and scheduling.

## 4. Declare capabilities and dependencies

Use required dependencies/capabilities only for things without which the service cannot honestly operate. Use optional dependencies/capabilities for degradable behavior. Missing required inputs block ACTIVE; missing optional inputs advertise degradation and can recover dynamically when restored.

## 5. Choose repository domains

Request repository domains in the manifest and use `CognitiveRepositoryRouter`. Do not embed SQLite/Postgres/IndexedDB/vector-engine semantics into cognitive contracts.

## 6. Preserve authority boundaries

Models and services propose. Canonical owners settle. A service may not directly mutate canonical state. A Result Bus route or artifact registration does not confer mutation authority.

Generation-facing semantic material may not append directly to prompts. It must enter an accepted publication/compiler path, be sealed by Context Seal, and then reach PromptPlan/adapter rendering.

## 7. Preserve provenance and revision fences

Every semantic result must retain provenance and source revision identity. Reject stale source revisions. Migrations may change representation but cannot rewrite identity, provenance, authority, revision lineage or temporal classification.

## 8. Implement failure/degradation behavior

Declare how the subsystem rebuilds or recovers. A missing optional dependency must not be presented as full capability. Diagnostics must expose why a service is degraded/unavailable.

## 9. Run conformance

Run the shared conformance kit against valid and intentionally invalid fixtures. Validate artifact/event contracts, provenance, stale results, lifecycle restrictions, authority, Context Seal, Settlement, dependencies, idempotence, recovery and diagnostics.

## 10. Run golden worlds

Declare mandatory evaluation requirements, including truth/history/provenance/stale/authority/recovery/resource categories as applicable. A failed mandatory test blocks ACTIVE eligibility.

## 11. Promote explicitly

Normal path: `EXPERIMENTAL -> conformance -> SHADOW -> live evaluation -> certification -> explicit ACTIVE promotion`. Tests never auto-promote. Roll back to SHADOW when production authority should be withdrawn. Deprecate explicitly.

## 12. UI discovery

Declare UI contributions as metadata only. UI.Core owns widgets/workspaces/actions/rendering. Do not create direct subsystem DOM architecture in the Cognitive Kernel.

## 13. Runtime boundary

Runtime owns scheduling, batching, capacity, worker execution, Event Spine delivery and backpressure. The Framework manifest may state runtime requirements, but must not grow a second Runtime.

## 14. Provider boundary

Provider/Coprocessor layers own provider routing and execution. Framework contracts remain provider-neutral and do not depend on native function/tool calling.
