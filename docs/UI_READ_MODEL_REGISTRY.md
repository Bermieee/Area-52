# UI Read Model Registry

UI implementation remains UI-owned. Wave 6 provides a registry/catalog only.

| Model | Version | Source | Mutation authority |
|---|---|---|---|
| ContextReceiptReadModel | 1.0.0 | CORE | false |
| PromptPlanReadModel | 1.0.0 | CORE | false |
| ForensicReadModel | 1.0.0 | CORE | false |
| KnowledgeTraceReadModel | 1.0.0 | CORE | false |

Every catalog row declares revision identity, the Core health vocabulary, authority fields, stale-detection fields and `mutationAuthority:false`.

No DOM, CSS, widget presentation or UI-owned state is implemented by Worker 1.
