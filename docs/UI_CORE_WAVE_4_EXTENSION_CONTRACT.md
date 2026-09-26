# UI.Core Wave 4 — UI Extension Descriptor Contract

## Schema

Current supported UI-owned schema:

```text
1.x
```

Minimum descriptor:

```js
{
  extensionId: "service.ui-extension",
  subsystemId: "service-id",
  schemaVersion: "1.0.0",
  display: {
    title: "Service",
    category: "Cognitive Services",
    icon: "..."
  },
  workspaces: [],
  inspectors: [],
  telemetry: [],
  actions: [],
  lifecycle: "ACTIVE",
  requiredCapabilities: [],
  optionalCapabilities: [],
  dependencies: [],
  permissions: [],
  authorityHints: [],
  availability: "AVAILABLE"
}
```

The descriptor must contain no executable function values.

## Workspace surface

```js
{
  id: "service-workspace",
  title: "Service",
  category: "Cognitive Services",
  adapter: "ServiceUIAdapter",
  surfaceId: "service.overview",
  views: ["overview"],
  actions: ["service.inspect"]
}
```

`adapter` and `surfaceId` are lookup tokens. They do not contain backend objects or executable code.

## Inspector surface

```js
{
  kind: "service-artifact",
  adapter: "ServiceUIAdapter",
  surfaceId: "service.inspect"
}
```

A descriptor may instead request an approved generic fallback token such as `artifact` or `event` when the binding supplies that fallback.

## Telemetry surface

```js
{
  id: "service-activity",
  signalType: "SERVICE_ACTIVITY",
  adapter: "ServiceUIAdapter",
  surfaceId: "service.telemetry",
  lightweight: true
}
```

Registration alone creates no subscription. Consumers call `UIExtensionRegistry.subscribeTelemetry()`; unregister releases any still-active subscriptions.

## Action surface

```js
{
  type: "service.inspect",
  operation: "inspect",
  adapter: "ServiceUIAdapter",
  permissions: ["service:inspect"],
  readOnly: true
}
```

The descriptor never provides `handler`, `invoke` or `execute`.

The separate binding supplies `actionHandlers[operation]`, and the registry routes the action through the standard `ActionRouter`.

## Separate UI binding

Example shape:

```js
{
  adapters: {
    ServiceUIAdapter: adapter
  },
  workspaceRenderers: {
    "service.overview": renderServiceOverview
  },
  inspectorRenderers: {
    "service.inspect": renderServiceInspector
  },
  telemetrySubscribers: {
    "service.telemetry": subscribeToServiceTelemetry
  },
  actionHandlers: {
    inspect: inspectServiceArtifact
  },
  validators: {},
  fallbackInspectors: {}
}
```

This separation prevents a canonical subsystem manifest from becoming an arbitrary UI code execution vehicle.

## Registration lifecycle

```text
register
 -> discovered in WorkspaceRegistry / InspectorRegistry / ActionRouter
 -> mount only when selected
 -> update presentation lifecycle/availability
 -> unmount through workspace ResourceScope
 -> unregister
 -> all extension telemetry/actions/inspectors/workspaces released
```

## Error codes

Representative local failures:

- `invalid-descriptor`
- `executable-descriptor`
- `unsupported-schema-version`
- `duplicate-extension`
- `duplicate-workspace`
- `duplicate-inspector`
- `duplicate-action`
- `missing-required-adapter`
- `missing-workspace-renderer`
- `missing-inspector-renderer`
- `missing-telemetry-binding`
- `invalid-action`

`tryRegister()` converts registration errors into a diagnostic result so a malformed optional extension does not crash the Area-52 shell.

## Authority rule

A UI descriptor is presentation metadata only.

It cannot:

- settle truth;
- mutate memory directly;
- alter source;
- promote lifecycle state;
- rewrite provenance;
- bypass Action Router;
- grant itself backend permissions.
