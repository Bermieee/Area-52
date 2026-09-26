# Cognitive Coprocessor Wave 2 — Test Evidence

## Accepted implementation/documentation checkpoint

Checkpoint before this evidence record:

`4caeed0088581b387bb4fc67a6a5aeb66af62c40`

GitHub Actions:

- Cognitive Coprocessor Wave 2 run `35843229348` — SUCCESS;
- Cognitive Coprocessor Wave 1 run `35843229253` — SUCCESS.

Reported results:

- full regression: **73/73 PASS**;
- Wave 1 focused: **40/40 PASS**;
- Wave 2 focused: **30/30 PASS**;
- combined stress files: **3/3 PASS**;
- syntax validation: **PASS**;
- `src/coprocessor/index.js` module import: **PASS**.

## Wave 2 deterministic stress

Wave 2 stress executes:

- **1,400 turns**;
- **5,320 planned worker tasks**;
- bounded per-turn fan-out <= 4;
- mixed provider identities;
- zero-worker turns;
- duplicate result delivery;
- stale revisions;
- future revisions;
- missing/malformed work pressure;
- deterministic fallback;
- opportunistic lateness.

Wave 1 stress remains active:

- 525 turns;
- 2,100 planned worker tasks.

## Specialist corruption / authority coverage

Permanent tests reject:

- prose around JSON;
- truncated JSON;
- wrong enum;
- unknown references;
- duplicate references;
- omitted required fields;
- historical -> current promotion;
- unresolved -> current promotion;
- out-of-range confidence;
- provider prompt echo / unknown output fields;
- source/candidate prompt-injection text used as instructions.

## Provider execution coverage

Tests prove:

- deterministic provider execution without credentials;
- OpenAI-compatible request shape without tools/functions;
- external endpoint/model configuration;
- provider interchangeability;
- live health/availability provider nomination;
- local/remote and output-limit filtering;
- typed PROVIDER_TIMEOUT;
- typed PROVIDER_UNAVAILABLE;
- typed CAPABILITY_UNAVAILABLE.

No real-provider token/cost/CPU/RAM metrics are fabricated.

## Batch / Green Room

Tests prove:

- adaptive slice recommendation changes under context/latency/output/error/deadline pressure;
- Runtime-compatible batch submission;
- committed valid slices survive a later failed slice;
- four active Green Room characters are processed in one specialist call;
- Green Room output is INFERRED;
- Green Room state expires on scene change.

## Function Test 001

`runFunctionTestTurn()` proves:

- four specialist tasks selected;
- Runtime-ready obligations emitted;
- Historian REQUIRED = 40ms;
- Graph Walker REQUIRED = 50ms;
- Truth / Precision REQUIRED = 70ms;
- Green Room OPPORTUNISTIC = 240ms;
- foreground quorum closes at 70ms;
- late Green Room routes NEXT_TURN;
- Gather preserves both Sun Blade fate claims;
- compiler input contains current Tavern, historical Blade-at-Tavern, unresolved current Blade state;
- Sidecar does not own Context Seal;
- external compile/seal/PromptPlan callbacks can be injected.

## Streaming Truth

OBSERVE mode tests prove:

- partial raw-token text is buffered until meaningful clause boundaries;
- soft uncertainty is logged;
- generated text is released unchanged;
- no interception occurs.

## Cross-lane compatibility

Re-fetched near completion:

- Runtime: `Development-Worker-Director@890f8576bcfcc4c056b959271027242dc6af7d7c`;
- Nexus: `Development-Nexus@327c120bc8826e33c07766d94c88dd7d8b82d352`.

Neither shared lane advanced during Wave 2 implementation. Sidecar continues to use only their public/read-only boundaries.

## Final-head rule

The documentation-only commit containing this evidence must pass the same Wave 1 and Wave 2 workflows before handoff is final.
