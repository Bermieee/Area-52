# Deployment Jev owner admission

The assembled `DevelopmentDeploymentBrain` routes Lore Jev work through
`adjudicateJevForOwner()`. Jev's provider attempt and proposal remain separate
from the `JevOwnerAdmissionReceipt`. Cognitive Choice receives an admitted
advisory result only when that receipt says `accepted: true`; pending, rejected,
stale, post-Seal, abstained, and unresolved proposals remain unresolved.

The host may provide `loreJevOwnerReview(proposal)` when constructing the Brain.
That callback must be backed by the actual Lore owner policy and return a
bounded `decision` of `ACCEPTED`, `REJECTED`, `UNRESOLVED`, or `DEFERRED`.
Without it, the receipt is `PENDING_OWNER_CONTRACT` and no owner acceptance is
inferred. The Brain refuses to ask the callback to accept an abstaining or
unresolved proposal. This advisory path cannot report canonical mutation or
Settlement, even if a callback claims those fields; Lore's separate reviewed
mutation path remains authoritative for source changes.

Freshness is checked against current Core source/world revisions, the selected
chat's Scene revision, and Lore hierarchy revision when Jev returns. A sealed
turn cannot enter owner review. The host `readJev` binding exposes bounded
admission status and reason fields without copying provider payloads.

The deterministic local Jev fixture abstains by design, so it exercises the
pending/unresolved path. It is not evidence of live provider acceptance. A
real Lore owner reviewer and installed-host turn are still required before a
live accepted Jev classification can be claimed.
