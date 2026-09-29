# New PR body (branch `repair/live-fixes` -> main)

**Live-diagnostics fixes after #324 (not for merge until the owner says so)**

Base: main `786c67e`. Findings come from the owner's installed diagnostics (a 438-message chat with an OpenRouter Sidecar). All evidence is MOCK-HARNESS unless stated.

## Fixes
- **Lore excluded with no visible reason**
  - What happened: a Lorebook accepted before the chat was open was learned and shown as "ready", but no chat was authorized to read it.
  - Now: the exclusion reason (`LORE_STORY_SCOPE_REQUIRED`) reaches the inspection.
  - The Lore panel says the open chat cannot read the accepted Lore and offers **Use for this chat**. This binds the already-learned book and re-studies nothing.
  - Accept binds to the chat that is open when it is clicked, and refuses if no chat is open.
- **Sidecar Scene returned no content**
  - What happened: finish_reason=length and content null; reasoning used the whole budget.
  - Now: the Scene budget reserves the estimated answer and sends the remainder as OpenRouter `reasoning.max_tokens`.
  - This applies to OpenRouter hosts only; other endpoints receive the request unchanged.
- **PROMPT_PLAN took 1.2 s live**
  - Cause: the partial fit of recent narrative was quadratic.
  - Fix: bisection, output-identical to the old scan (equivalence test over 1,080 allocations). With 438 × 3 KB messages, time drops from 1.5 s to about 30 ms.
- **Checkpoint CPU**
  - SHA-256 now uses typed arrays and produces identical digests, including for lone surrogates.
  - The Work Ledger now clones once per flush instead of twice.

## Verification
- Full suite, each `tests/*.mjs` file run on its own (247 files): **2,053 / 2,053 pass, 0 failing files**.
- Assembly verifier: **PASS** (addendum 5).
- The new tests are mutation-checked.

## Open
- **Live confirmation**:
  - Lore reaches the prompt after "Use for this chat" (loreSync SYNCED, nominations > 0).
  - The Sidecar Scene call returns content with the reasoning cap.
- **Checkpoint growth with retained turns** (~245 KB and ~45 ms per turn) is deferred to the cap-remediation wave (cap ledger rows 60-61).
