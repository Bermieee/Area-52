# Deployment Jev owner admission

The assembled `DevelopmentDeploymentBrain` routes Lore Jev work through
`adjudicateJevForOwner()`. Jev's provider attempt and proposal remain separate
from the `JevOwnerAdmissionReceipt`. Cognitive Choice receives an admitted
advisory result only when that receipt says `accepted: true`; pending, rejected,
stale, post-Seal, abstained, and unresolved proposals remain unresolved.

The default Lore advisory reviewer admits only a fresh, bounded reconciliation
classification with at least two evidence items and two owner options. It
checks the Lore hierarchy revision and returns `UNRESOLVED`, `REJECTED`, or
`DEFERRED` when the proposal is not admissible. Admission means the
classification may be considered as advice; it is not a Truth verdict or a
change to authored Lore. The host may supply a stricter
`loreJevOwnerReview(proposal)` callback when constructing the Brain. The Brain
refuses to ask any callback to accept an abstaining or unresolved proposal.
This advisory path cannot report canonical mutation or Settlement, even if a
callback claims those fields; Lore's separate reviewed mutation path remains
authoritative for source changes.

Freshness is checked against current Core source/world revisions, the selected
chat's Scene revision, and Lore hierarchy revision when Jev returns. A sealed
turn cannot enter owner review. The host `readJev` binding exposes bounded
admission status and reason fields without copying provider payloads.

The deterministic local Jev fixture abstains by design, so it exercises the
owner-reviewed unresolved path. It is not evidence of live provider acceptance.
An installed-host turn with an actual provider decision is still required
before live accepted Jev classification can be claimed.
