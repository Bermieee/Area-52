# Live Scene, graph and browser profiling repair

Baseline: main `8a3c897594683592366f87268072d81574be4c55`.
Evidence: Area52-Diagnostics-20260928-134358.zip, selected turn 430 and retained turn 428.

## Findings and changes

- Turn 428 physically attempted Scene extraction and failed MALFORMED_OUTPUT. The exported receipt omitted completion details, so this export cannot identify whether that response was truncated, fenced, empty or otherwise invalid. The worker prompt omitted the exact field-row schema enforced by the normalizer. The repair supplies that schema, explicitly requests JSON-object output on the existing OpenAI-compatible transport, and retains finish reason, token usage and adaptive budget on normalization failures. Raw responses remain excluded. A mocked configured HTTP Sidecar now proves actual Scene-owner admission through Runtime. It is not a live GLM acceptance claim.
- Selected Scene revision 2 had no location/cast/objects/threads or inferred atmosphere. No facts are synthesized to fill this state. Successful extraction still requires fresh source-linked evidence and Scene-owner admission.
- Lore graph loading exhausted a shared 15ms clock and skipped Memory and Scene providers. Each registered synchronous provider is already bounded by the owner query contract and provider/edge/node/depth/candidate counts. Positive latency estimates now report overruns instead of erasing later owner consideration. An explicit zero budget still disables external provider loading. Traversal fences and authority boundaries remain intact.
- The selected graph request also lacked entity anchors. Such requests now report NO_ENTITY_ANCHORS and avoid materializing owner graphs that cannot be traversed. This is separate from budget starvation; it does not invent query entities.
- Memory graph freshness checks serialized the entire Memory snapshot; Lore checks materialized the full operator status. Lightweight owner APIs now return active Memory source revisions or check the exact current non-removed Lore source revision. Legacy adapters retain compatibility fallbacks. These remove demonstrated foreground allocation paths; they do not prove the entire installed-browser heap spike is fixed.
- Detailed profiling previously began after Scene/Fan-Out preparation and ended before checkpoint persistence. It now covers both, separately reports checkpoint duration/heap delta/status, drains pending PerformanceObserver records at samples, and exports at most 64 numeric long-task intervals through the existing Diagnostics Center and export. No browser attribution URLs, prompts or story text are retained. Interval phases indicate overlap, not a causal attribution to a particular extension.

## Verification

Focused Scene output, configured HTTP owner admission, asynchronous lifecycle/staleness, graph fairness/freshness, selected-turn graph UI, live-host lifecycle and Diagnostics profiling tests pass. Four FT002 assembly tests fail with the same Memory consolidation interface exception on unchanged baseline main; these remain disclosed baseline failures. Canonical copied-path digest comparison introduces no new mismatches; Windows CRLF checkout hashes differ from canonical Git blobs, so raw local verifier output is not represented as a clean Linux assembly pass.

Installed acceptance remains open: generate with profiling enabled, confirm populated Scene-owner fields, inspect Sidecar finish metadata if it fails, verify graph owners are considered when anchors exist, and compare long-task intervals/heap peaks against the prior run.
