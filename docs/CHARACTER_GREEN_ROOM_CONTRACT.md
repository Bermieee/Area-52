# Character Green Room Contract

## Authority

Green Room state is always:

- INFERRED;
- EPHEMERAL;
- SCENE-SCOPED;
- EXPIRING;
- NON-CANONICAL.

Repeated inference does not directly mutate Character State.

## Input

Multiple active characters may be sent in one provider call.

Per character:

- characterId;
- evidenceRefs;
- recent scene evidence;
- relationship evidence refs.

## Output

Per character:

- guardedness;
- warmth;
- anger;
- trustTrend;
- anxiety;
- latentIntent;
- confidence;
- evidenceRefs;
- sceneRevision;
- expiry policy.

Normalized scalar values are bounded to 0..1 where applicable.

## Expiry

GreenRoomEphemeralStore rejects/retires state when:

- scene revision changes;
- turn TTL is exceeded;
- character is no longer active when active-cast fencing is supplied.

Expired inference is not automatically reused in a later scene.

## Batching

Green Room declares adaptive batch semantics and the Sidecar Batch Adapter can submit multiple characters as common Runtime Batch Engine units.

Focused per-character follow-up is not automatic.
