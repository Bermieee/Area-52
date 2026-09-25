# Subsystem Lifecycle

Subsystem lifecycle is distinct from Runtime job state.

- `EXPERIMENTAL` — controlled/testing execution; evaluation output only; no silent production authority.
- `SHADOW` — may consume live evidence and produce candidates/evaluation results, but cannot mutate canon or alter sealed foreground context.
- `ACTIVE` — eligible for only manifest-declared authority after required dependencies/capabilities, mandatory certification, and explicit operator/policy promotion succeed.
- `DEPRECATED` — remains inspectable for historical interpretation/migration; new work is rejected unless a future explicit recovery policy says otherwise.

Valid transitions are explicit. Passing certification does not auto-promote a service. ACTIVE promotion still requires explicit action. Rollback from ACTIVE to SHADOW is supported; invalid transitions are rejected.

At every lifecycle state, direct canonical mutation is fenced by Settlement and direct prompt injection is fenced by Context Seal.
