# Diagnostic Retention Policy

Observability data is classified as `LIGHTWEIGHT_METADATA`, `BOUNDED_DIAGNOSTIC`, `FORENSIC_REFERENCE`, `LARGE_DEBUG_PAYLOAD` or `SENSITIVE_PAYLOAD`.

Lightweight IDs, revisions, reason codes, hashes, destinations, authority/status and sequences may be retained longer. Bounded diagnostic detail receives payload/TTL limits. Forensic references are durable by policy. Large debug and sensitive payload detail is not retained by default.

Controls default false for `includeRawPrompt`, `includeRawResponse`, `includeCandidateBodies`, `includeSourceText`, `includeLargeDebug` and `includeSensitive`. The sanitizer removes those payload classes recursively and clips oversized/circular structures.

Pruning removes expired detail but preserves occurrence metadata and the fact that detail expired. Global detail budgeting prunes non-forensic detail first. The diagnostic plane must not become a second database of raw model/context data.
