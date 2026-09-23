# Jev Capability Migration

## Goal

Transform Nexus Decision Core/Jev from a privileged architectural identity into a replaceable semantic capability provider.

## Mapping

| Legacy responsibility | Area-52 capability | Authority |
|---|---|---|
| Change classification | CHANGE_CLASSIFICATION | ADVISORY |
| Semantic judgment | SEMANTIC_JUDGMENT | ADVISORY |
| Proposal review | PROPOSAL_REVIEW | ADVISORY |
| Conflict interpretation | CONFLICT_INTERPRETATION | ADVISORY |
| Truth judgment | TRUTH_JUDGMENT | ADVISORY |

No mapping grants canonical mutation authority.

## Provider interchangeability

A task asks for capabilities.

Example:

```
requiredCapabilities:
  TRUTH_JUDGMENT
  RERANK
```

A Jev-backed profile and an alternate provider profile may both satisfy that task. Tests prove the provider can change without changing task semantics.

## Prohibited path

There is no supported rule equivalent to:

```
if worker == JEV:
    trust result
```

Jev may remain one provider/profile. Settlement and canonical owners remain authoritative.
