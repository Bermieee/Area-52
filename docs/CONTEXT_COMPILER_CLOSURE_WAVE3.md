# Context Compiler Closure — Wave 3

Worker 1 Wave 3 closes the remaining Core-owned Context Compiler ambiguity without changing canonical truth semantics.

## Permanent ownership split

The Context Compiler owns **what model-independent semantic knowledge must be communicated**: selection, dedupe, compatible support merge, truth/authority/status preservation, temporal qualifiers, unresolved/conflicting evidence, provenance, revision dependencies, active-thread semantics, semantic priority and representation eligibility.

Adaptive Context owns **how already-sealed semantics are presented to a target model/profile**: model-specific token estimation, model context limits, budget allocation, section ordering, representation density, cache segmentation/reuse, role formatting, rendering and model-adapter behavior.

The compiler reports neutral physical/semantic sizing in CompilerReceipt. It does not emit a target-model token count. Adaptive Context reports the model/profile token estimator and allocated token budget in PromptPlan diagnostics.

## Active threads

ActiveThread is a bounded compiler input with subject references, objective/unresolved question, priority, source revisions, optional scene revision and evidence references. Its authority is fixed to UNRESOLVED.

An active thread can increase deterministic communication priority for already-existing current, unresolved or historical semantics sharing a subject. It cannot create a current fact, raise authority, settle a dispute, change Temporal State or alter source provenance.

Stale-thread source revisions are rejected from the compiled/sealed packet and reported in CompilerReceipt diagnostics.

## Compatibility

Compiler diagnostic metadata is not counted as sealed semantic payload. This preserves the previously accepted compact packet shape and fallback semantics. Active threads themselves are sealed only when present because they are generation-relevant semantic obligations.

#10 acceptance is satisfied by this explicit and tested compiler/delivery ownership boundary.
