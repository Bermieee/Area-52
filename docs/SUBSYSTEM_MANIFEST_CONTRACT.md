# Subsystem Manifest Contract

A `SubsystemManifest` is the machine-readable declaration for a cognitive service.

Required identity fields are `subsystemId`, `version`, `contractVersion`, `owner`, and `lifecycleState`. The manifest also declares consumed/produced events, consumed/produced artifact types, provided/required/optional capabilities, required/optional dependencies, authority permissions, runtime requirements, invalidation rules, repository requirements, UI contributions, evaluation requirements, failure behavior, compatibility metadata and diagnostics.

Registration fails safely for malformed manifests, duplicate services, incompatible framework contract versions, undeclared/unknown authority permissions, dependency cycles, or declared produced types that were not registered.

A registered service can be looked up, listed, unregistered, inspected for lifecycle/dependencies/capabilities/certification and evaluated without adding a kernel switch on `subsystemId`.

Authority permissions are declarations, not grants of direct mutation. Direct canonical writes still require Settlement. Direct semantic foreground injection still requires Context Seal.
