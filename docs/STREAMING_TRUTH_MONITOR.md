# Streaming Truth Monitor

Streaming Truth evaluates complete clauses/claims rather than raw tokens. The pipeline is clause buffering -> claim extraction -> deterministic current-state check -> optional semantic verifier -> violation classification.

Modes are explicit:
- `OBSERVE`: log only; generation text is released immediately.
- `VERIFIED_CHUNKS`: incomplete text is buffered, complete chunks are checked, then released; verification failure fails open.
- `HARD_INTERCEPT`: experimental and disabled unless explicitly enabled. Interception requires a deterministic, high-confidence, high-severity, CURRENT-canon violation. Historical, figurative, hypothetical or creatively ambiguous language is ineligible.

Every receipt is revision-scoped to the generation context. A newer revision does not retroactively rewrite an already-sealed prompt. Missing claim span is a schema failure. Monitor outage never crashes generation.
