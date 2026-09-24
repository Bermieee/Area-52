# Event Registry Contract

The Framework event layer sits above the Runtime Event Spine. It owns event identity, schema/version registration, compatibility and common envelope rules. It does not own delivery, subscription scheduling, backpressure or durability.

`CognitiveEventEnvelope` preserves event ID/type/version, producer, causation/correlation IDs, optional turn/task IDs, source revision set, world/scene revisions, sequence/time, dedupe identity, payload and payload schema version.

A registered unknown-to-core event type is accepted through the registry. An unregistered type or incompatible version is explicitly rejected. Repeated dedupe identity is contained idempotently and returns the originally accepted event.
