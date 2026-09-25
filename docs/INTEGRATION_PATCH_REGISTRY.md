# Integration Patch Registry

Compatibility-only integration patches are explicit records.

Required fields:

- `patchId`;
- target path;
- source lane;
- accepted source SHA;
- reason;
- expected before digest;
- expected after digest;
- host/integration-only flag.

Validation distinguishes `VALID`, `STALE`, and `CONFLICT`.

An integration-local file differing from the accepted source without a matching registered patch remains `CONFLICT`. Wave 6 retains the earlier assembly-preflight adversarial test proving undocumented drift is never silently accepted.

The rehearsal registry contains a compatibility-only Scene/Runtime event-adapter patch fixture solely to exercise the policy. It does not alter the Scene lane and is not applied to `main`.
