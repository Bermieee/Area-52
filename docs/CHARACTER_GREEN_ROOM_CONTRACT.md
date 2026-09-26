# Character Green Room Contract

Green Room is scene-local inferred micro-state, not Character State. Every inference carries character reference, scene revision, evidence refs, confidence, creation time, expiry condition, source revision set and `authority: INFERRED`.

Dimensions are sparse and bounded. Supported dimensions include guardedness, warmth, anger, trust trend, anxiety, latent intent, attention target, social pressure and uncertainty. Characters are processed in bounded batches rather than one call per character.

Expiry may be triggered by Scene close/replacement, major time shift, character departure, contradictory evidence, source-revision invalidation, Scene revision change or TTL. Active-character count, dimensions, evidence refs and retained history are all capped.

Repeated compatible observations may produce a `ReflectionCandidate`, but that object remains proposal-only and has no Memory/Settlement mutation authority. Provider output claiming canonical, Settlement or Memory authority fails closed.
