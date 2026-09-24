# Forensic Bundle Contract

A `ForensicBundle` is an explicit persistent reconstruction package for one selected turn/generation/incident. It is reference-oriented rather than a permanent copy of raw prompts, responses, candidate bodies or lore.

The bundle may reference source revisions, scene/world revisions, Runtime work, worker results, Truth/precision/Gather receipts, Cognitive Transactions, Settlement receipts, PromptPlan, Context Seal, late/stale results, diagnostics and assembly provenance.

Context Seal reconstruction preserves the seal receipt identity/hash, source revisions, admitted/rejected/stale results and late-result separation. A result that arrived after the seal stays visibly late and is never added retroactively to the admitted set.

Bundles include a reconstruction receipt and explicit completeness flag. Missing required transaction references cause fidelity failure or partial reconstruction, not `complete=true`.
