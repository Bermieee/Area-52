# Coprocessor Capability Discovery and Negotiation

## Ownership boundary

Sidecar declares semantic cognitive requirements and discovers eligible capability profiles.

Runtime owns scheduling, resource allocation, execution lifecycle, backpressure, batching infrastructure, and worker allocation.

Capability discovery therefore returns candidate profiles and negotiation metadata only. It does not return `execute`, `schedule`, Resource Governor decisions, or named Sidecar slots as task semantics.

## Discovery order

For one `CognitiveTask`:

1. evaluate the primary `capabilityRequests`;
2. enforce minimum capability versions;
3. prefer preferred versions through deterministic ordering;
4. filter by health and availability;
5. filter by concurrency/load;
6. enforce foreground/background eligibility;
7. enforce cognitive layer and HOT/DEEP placement compatibility;
8. enforce structured-output, context-size, output-size, cost and optional latency constraints;
9. return all eligible normalized profiles;
10. only if none qualify, try declared fallback capability sets in order.

A fallback-set match is marked `degraded:true` and carries the exact fallback index. It does not silently rewrite task semantics.

## Provider neutrality

Provider/model/implementation identity remains metadata. Downstream normalized CognitiveWorkerResult semantics do not branch on MiMo, GLM, DeepSeek, Jev, or another provider name.

The Runtime descriptor now carries:

- capability versions/descriptors;
- fallback capabilities;
- supported layers and placements;
- resource profile;
- provider/model/implementation identity;
- concurrency and current load;
- latency class/score;
- reliability;
- structured-output support;
- context/output limits;
- local/remote metadata;
- cost class;
- foreground/background eligibility;
- health and availability.

## Fallback boundary

Fallback capability negotiation is discovery, not execution selection. The Sidecar execution layer continues to require the specialist's primary semantic contract. Runtime may use the discovery result when selecting a compatible implementation.
