# Scene Event Integration Contract

Scene Intelligence is a producer of normalized Scene events. Runtime owns delivery, subscriptions, scheduling, queues, retry/backpressure and worker wakeup.

## Events

Scene currently publishes:

- SCENE_STATE_DELTA
- LOCATION_CHANGED
- TIME_SHIFT_DETECTED
- ACTIVE_CAST_CHANGED
- RELATIONSHIP_SIGNAL
- SCENE_BOUNDARY_CANDIDATE
- SCENE_BOUNDARY_CONFIRMED
- SCENE_CLOSED
- SCENE_OPENED
- VIBE_CHANGED
- SCENE_EPISODE_READY
- PREFETCH_RECOMMENDED
- OBJECT_TRANSITION

## Envelope

The Scene producer envelope preserves event identity/version, producer, causation/correlation/turn identity, Scene identity/revision, source revision set, sequence/time, dedupe identity and payload schema version.

It exposes compatibility adapters for both accepted registry surfaces:

- Runtime `EventTypeRegistry.register({ eventType, schemaVersion, producer, payloadSchema })`;
- Core `EventTypeRegistry.registerType({ eventType, eventVersion, owner, validatePayload })`.

It also exposes `runtimeSink(EventSpine)`, which translates a Scene event into `EventSpine.emit(eventType,payload,meta)` without implementing Event Spine itself.

## Compatibility rejection

Scene rejects:

- unknown Scene event types;
- incompatible event major versions;
- incompatible payload-schema major versions;
- non-object payloads;
- authority/Settlement/Context-Seal bypass attempts.

Duplicate events with the same event type/version/dedupe identity are idempotent.

## Freshness

Consumers must compare `sceneRevision` / revision fences to the active Scene revision. An event emitted for r8 after the Scene has advanced to r9 is stale.

## Authority

Events create information and downstream obligations only. They do not grant canonical mutation authority.
