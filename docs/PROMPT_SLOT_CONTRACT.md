# Prompt Slot Contract

## Core slots

- `SYSTEM_POLICY`
- `WORLD_FOUNDATION`
- `CHARACTER_FOUNDATION`
- `CURRENT_CHARACTER_STATE`
- `CURRENT_WORLD_STATE`
- `CURRENT_SCENE`
- `ACTIVE_THREADS`
- `RELEVANT_LORE`
- `EPISODIC_MEMORY`
- `HISTORICAL_SUPPORT`
- `UNRESOLVED_EVIDENCE`
- `RECENT_NARRATIVE`
- `USER_INPUT`

Each registered slot has one presentation owner, allowed source categories, role, semantic/non-semantic policy, protected-floor policy, delivery band and cache eligibility.

Subsystems contribute through `PromptContribution`; there is no raw append API.

## Source categories

- `SEALED_PACKET` — semantic references already present in the immutable packet;
- `STATIC_POLICY` — revisioned system/operator policy;
- `GENERATION_ENVELOPE` — current input/narrative metadata needed for the generation;
- `PRESENTATION_METADATA` — non-semantic rendering hints.

Semantic content from a non-sealed category is rejected.

A sealed semantic contribution must name `semanticRefs`. Runtime resolves those references from the packet; arbitrary contribution text is not trusted as a new cognitive fact.

## Extension slots

Future subsystems may register `EXT_*` slots with an explicit contract. Registration does not bypass seal or integrity rules.
