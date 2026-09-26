# UI.Core Wave 5 — Progressive Cognitive Disclosure

Wave 5 implements three presentation levels as UI preference only.

## NORMAL

Answers: **What is happening?**

Normal mode uses product language, concise status, current scene, character/lore/memory/world summaries, Brain Activity, and important notifications. Engineering implementation vocabulary is intentionally minimized.

## DETAIL

Answers: **What did Area-52 find, change, or decide?**

Detail adds evidence counts, authority labels, historical state, scene boundary confidence, episode relationships, cognitive work progress, PromptPlan segment summaries, and conflict reasons.

## ADVANCED

Answers: **How did the machinery arrive there?**

Advanced exposes deliberate inspection actions and the Brain gateway. It does not duplicate raw Brain Inspector internals. Existing engineering workspaces and Inspector renderers remain authoritative.

## Persistence and safety

`ProductDetailLevel` supports `NORMAL`, `DETAIL`, and `ADVANCED`. The selected level persists through the existing UI state store. Changing it never changes backend cognitive state.

Inferred atmosphere and relationship state remain visibly `INFERRED`. Historical state is never promoted to current truth.
