# FT005 Assembly Rehearsal

Status: **ASSEMBLY REHEARSAL GREEN / LIVE PROVIDER EXECUTION PENDING**.

This rehearsal uses provider-neutral accepted Coprocessor and Core contracts. It does not close #180 and does not claim live external-provider acceptance.

## Cases

- Provider A canonical result -> Core;
- Provider B canonical result -> same canonical Core shape;
- forced Provider A malformed/failure -> bounded Provider B fallback;
- malformed Provider B output -> typed failure, no canonical-ready admission;
- semantic contradiction -> rejected before canonical-ready;
- OPPORTUNISTIC result after Context Seal -> `NEXT_TURN`.

Provider/model identity never grants authority or alters the canonical result contract. Live provider calls and a live SillyTavern forced-fallback drill remain pending.
