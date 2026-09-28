# Scene and Diagnostics repair — 2026-09-28

Evidence: `Area52-Diagnostics-20260928-145113.zip`, selected message 434.
Starting main: `71ce1edeaf4530d9618e84e670bece7c9c49090c`.

The GLM Scene observation call succeeded in 4,691 ms. Its resource receipt
does not itself establish Scene owner admission. The installed UI binding
allowlist omitted `readSceneObservationReceipts`, preventing the Diagnostics
operations reader from exposing the existing execution/route/owner chain.
The reader now survives that installed wrapper. Existing bounded, metadata-only
owner receipts retain acceptance or rejection reasons without provider bodies.

Native Brain's selected-turn Scene reader projected current Core state. Later
observations could change its revision or source fence, making the installed
wrapper return null for an otherwise valid selected generation. New turns retain
the Scene read model used at preparation. Older checkpoints only project current
state when Scene ID and revision still exactly match. This does not promote
late evidence into a sealed generation.

Routine Operations and Diagnostics status reads previously requested the full
Lore study surface, including artifact payloads and ontology. They now use an
owner metadata surface. Full Lore panel reads remain unchanged. Representation
selection, which returns metadata, no longer clones complete representation
bodies internally. Readiness still checks exact owner revisions and required
profiles; no indexing, retrieval or study limits were introduced.

Detailed host profiles finish after persistence, later than native response
notifications. The UI subscription now receives `HOST_PROFILE_COMPLETED` after
the profile is available. Twelve bounded capture-state rows distinguish an
armed generation, a checkpoint wait, an available profile and an unarmed run.
Diagnostics exports and the existing Flight Recorder show exact-generation
capture reasons; another generation's profile is never used as a substitute.
This repairs the reproduced notification gap. The supplied export alone cannot
prove whether its missing selected profile was pending, absent or misselected.

Validation: the initial three regressions failed before production changes.
125 focused Scene, host, learning, Lore, installed-binding and profiler tests
passed afterward. A controlled 105-entry Lorebook check retained identical
105 READY counts: eight metadata reads averaged 7.60 ms; eight full reads averaged
68.13 ms. Output size was 183,171 vs 1,139,267 bytes. This compares read paths
in a local fixture, not installed-browser latency.

The platform-specific npm check invokes unavailable `xargs` on Windows; changed
JS surfaces are checked directly. Assembly reconciliation updates only three
changed paths present in the existing digest inventory and preserves all other
accepted expectations.

Installed acceptance remains separate: verify selected Scene execution and owner
decision, subsequent Scene anchors, detailed profile publication, and UI refresh
costs in a fresh generation. No live admission, provider latency improvement,
or complete browser-stall resolution is claimed from fixture results.
