# Framework Kernel Wave 1 — Existing Core Audit

## #10 Context Compiler

Disposition: **implemented substantially; leave open pending explicit token-estimation acceptance mapping**.

Observed implementation already covers semantic dedupe, compatible support merging, temporal classification/qualifiers, unresolved preservation, deterministic sparse representation, provenance retention, correctness-preserving rich fallback under unsafe/budget pressure, and downstream provider-neutral delivery. No rewrite was performed.

The remaining ambiguity is organizational rather than a discovered truth bug: issue #10 names token estimation as a compiler responsibility, while the current architecture performs byte-budget/retention checks in Publication Context Compiler and token estimation/model adaptation in Adaptive Context. Do not close #10 until that split is accepted as satisfying the issue or compiler-side token-estimation evidence is added.

## #37 Settlement Engine + mutation authority

Disposition: **acceptance satisfied by existing implementation/tests; no rewrite needed**.

The existing path enforces proposal schema, evidence validity, source freshness, registered canonical owner policy, optional approval and owner settlement, then produces decision/audit receipts. Existing Wave 3 tests cover unsupported owner rejection without mutation, evidence/freshness rejection without partial mutation, approval-required no-mutation behavior and Result Bus non-authority. Temporal State Graph tests preserve historical/superseded state.
