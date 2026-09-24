# Cognitive Repository API

The Framework exposes storage-neutral repository semantics: `put`, `get`, `list`, and `delete`, plus deterministic revision retrieval. Repository domains include sources, artifacts, temporal state, episodes, reflections, graphs, vector/index references and ledger/audit data.

`CognitiveRepositoryRouter` binds domains to replaceable adapters. Wave 1 includes a deterministic `InMemoryCognitiveRepository` and an independent `ObjectFixtureCognitiveRepository`; both run the same repository contract suite.

Adapters determine how bytes/objects are stored. They do not determine CURRENT truth, authority, Settlement, provenance meaning, or owner policy. Those semantics remain above storage.
