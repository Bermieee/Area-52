# Lore Wave 5 Changelog

## Fixed

- Restored `LorePublicIntegrationSurface.contractVersion = 1`; Wave 4's version bump was an accidental backward-compatibility regression.
- Updated only the obsolete Wave 1 fixed-ontology assertions; all other Wave 1–3 coverage remains intact.

## Added

- evidence-derived `LoreWorldOntology`;
- revision-fenced concept, relationship and community graph read model;
- multi-level summary read surface;
- Brain packet ontology revision, thematic communities and relevant summaries;
- summary retention gates for rule exceptions and character behavior;
- Wave 5 acceptance/quality/performance tests.

## Changed

- removed hardcoded tavern/weapon/proprietor ontology generation;
- community discovery now uses authored book-local tree topics and evidence-derived concepts instead of generic fixed parent categories;
- package version advanced to `0.6.0-lore-wave5`.

## Preserved

- exact source and Lore Tree;
- Wave 1–3 lifecycle/provenance/retrieval guarantees;
- Wave 4 failure/retry and discovery contracts;
- derived-cognition authority boundaries;
- self-contained native execution.
