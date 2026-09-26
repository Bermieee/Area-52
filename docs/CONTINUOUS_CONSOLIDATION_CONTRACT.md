# Continuous Memory Consolidation Contract

Continuous consolidation is DEEP L3/L4 Coprocessor work. It consumes Artifact References to raw experience, SceneEpisodes, episodic artifacts, claims, relationship evidence, state transitions, unresolved threads and reflection candidates. Payload cloning is not the default data-plane contract.

Outputs are `ConsolidationProposal` objects for episode summaries, claim candidates, relationship updates, reflection evidence, state-change proposals, compressed representations or cross-episode links. They never mutate Memory, claim Settlement authority or request deletion of raw source turns.

Large jobs use existing Runtime obligation metadata: adaptive slices, legal checkpoint boundary, yield/park, resume identity, partial-result semantics, and Runtime-owned checkpoint storage. Runtime alone schedules and preempts work.

`ConsolidationBacklog` is capacity bounded and exposes pending units, age, priority, checkpoint, superseded units and stale discards. Revision-fence change marks work `STALE`; references remain available for safe recomputation, but stale output cannot become active durable memory.
