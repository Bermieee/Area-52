# Character Green Room — Phase 1 Production Architecture

**Owner:** Cognitive Coprocessor / Sidecar cognition  
**Primary card:** #78  
**Canonical implementation:** \`src/coprocessor/green-room.js\`  
**Execution orchestration:** \`src/coprocessor/cognitive-worker-pipelines.js\`

## Purpose

Character Green Room is HOT, generation-adjacent, scene-scoped cognition for active characters. It derives compact micro-state that may assist current generation while remaining explicitly **INFERRED** and non-canonical.

The production path is:

\`\`\`text
TURN_EVENT / Scene active-cast evidence
 -> createGreenRoomTask
 -> bounded active-cast provider request
 -> provider-neutral SpecialistExecutionLayer
 -> validateGreenRoomProviderOutput
 -> GreenRoomBatch
 -> GreenRoomStore
 -> projectGreenRoomForGeneration
 -> Gather / Context Compiler
\`\`\`

No stage grants durable Character State authority.

## Canonicalization

Wave 6 makes \`green-room.js\` the single canonical Green Room contract, validator and state model.

The older \`foreground-specialists.js\` Green Room path remains only as an explicit compatibility adapter:
- \`buildGreenRoomInput\` delegates to \`createGreenRoomProviderInput\`;
- \`normalizeGreenRoom\` delegates to the canonical validator/projection;
- \`GreenRoomEphemeralStore\` wraps \`GreenRoomStore\`;
- legacy \`characterId\` remains an alias for canonical \`characterRef\`.

There are no two independently evolving Green Room stores after Wave 6.

## Task contract

\`createGreenRoomTask\` carries:
- turnId, taskId, correlationId and optional causationId;
- scene/world/character-state/source revisions;
- active character references;
- bounded evidence/reference categories;
- cognitive layer;
- result class;
- required and optional capabilities;
- deadline and fallback policy;
- intent fingerprint;
- provenance requirement.

Default policy:
- placement: HOT;
- cognitive layer: L1;
- result class: OPPORTUNISTIC;
- required capabilities: SEMANTIC_JUDGMENT + CHARACTER_INFERENCE;
- optional capability: FAST_CLASSIFICATION;
- fallback: skip/degrade Green Room rather than stop normal RP.

## Active-cast batching

The default is one bounded provider request for multiple active characters.

Presence rules:
- PRESENT: eligible;
- UNCERTAIN: eligible when legitimately active/uncertain;
- MENTIONED_ONLY: not active by default.

Duplicate character refs and casts over the configured bound fail validation. Focused follow-up may exist later for difficult/high-value characters, but one request per character is not the default architecture.

## Evidence boundary

Provider input is minimum-necessary and reference-first. Allowed input includes bounded:
- current Scene evidence references/slices;
- recent dialogue/action evidence;
- relationship references;
- Character State references;
- unresolved evidence;
- prior Green Room references as derived context.

Whole conversation, all Memory, all Lore, full Scene history, raw private diagnostics and other whole-brain state are not legal default provider payloads.

## Micro-state

Canonical dimensions include:
- guardedness;
- warmth;
- anger;
- anxiety;
- trust trend;
- attention target;
- social pressure;
- latent intent;
- uncertainty.

Every inference keeps:
- characterRef;
- sceneRevision;
- direct evidence refs;
- prior-inference refs kept separately;
- sourceRevisionSet;
- confidence;
- expiry condition;
- created/updated identity;
- authority = INFERRED.

Confidence never upgrades authority.

## Anti-feedback rule

Prior inference is not new evidence.

Each state has a deterministic support identity derived from direct evidence and revisions. Reflection candidates count unique direct support identities, not repeated Green Room guesses. Repeating the same inference against unchanged evidence cannot manufacture independent support or increase truth authority.

## Lifecycle

\`GreenRoomStore\` deterministically removes ephemeral projection on:
- Scene close;
- Scene replacement/revision change;
- major time shift;
- character departure;
- contradictory evidence;
- source-revision invalidation;
- turn TTL;
- chat switch;
- Scene correction.

Expiration removes Green Room projection only. It does not delete source evidence or mutate durable Character State.

## Reflection seam

Repeated independently supported observations may create a proposal-only \`ReflectionCandidate\` containing:
- character identity;
- supporting evidence refs;
- source revisions;
- independent observation count;
- compatible support identities;
- contradicting evidence;
- scene context;
- INFERRED authority;
- \`durableMutation:false\`.

Destination is Memory/Settlement review. Green Room never writes durable Character State or Reflection storage directly.

## Generation projection

\`projectGreenRoomForGeneration\` emits a compact structured \`greenRoom\` lane containing character identity, dimensions, confidence/uncertainty, evidence refs, source revisions, Scene revision, expiry and explicit INFERRED authority.

It does not emit provider chain-of-thought or giant prose analysis.

## Failure behavior

- provider unavailable: OPPORTUNISTIC Green Room degrades and generation continues;
- malformed output: typed failure;
- stale Scene revision: reject;
- unknown evidence or character: reject;
- authority/durable mutation claim: reject;
- deadline miss: normal result-class policy;
- post-Context-Seal result: NEXT_TURN/background only; it cannot mutate current ephemeral foreground state.

## Ownership boundary

Green Room proposes cognition. Canonical Character State owners settle.

It does not own durable relationship learning, Memory persistence, Reflection admission, Scene truth, Context Seal or Settlement.
