# Scene Intelligence Phase 1 Evidence

## Qualification source

GitHub Actions run `35961526241` on pre-squash tree-equivalent head `bee29f03de586e7f77728a5a1b6b50dbec0fdf8b`.

## Deterministic suite

```text
tests 127
pass  127
fail  0
```

Browser compatibility source scan: **PASS (33 modules)**.

Scene module import: **PASS**.

## Wave 1 pressure evidence

- 1,200 updates;
- 800 deltas;
- 400 cast mentions;
- 300 object mentions;
- 48 weak boundary candidates, all 48 rejected;
- 11 temporal corrections;
- 7 location corrections;
- 40 cast churn events;
- final Scene revision 802;
- active cast bounded at 23 entries;
- object set bounded at 31 entries;
- active provenance refs bounded at 128;
- source revision refs bounded at 128;
- Scene history bounded at 64 snapshots;
- delta history bounded at 128;
- active CurrentScene serialized size 18,926 bytes.

## Wave 2 pressure evidence

- 5,000 host events accepted;
- 2,600 deltas;
- 2,511 deltas/second in the fixture;
- 520 boundary candidates;
- TP 120 / FP 0 / FN 0 / TN 400;
- boundary precision 1.0;
- boundary recall 1.0;
- false-cut rate 0;
- 130 transitions;
- 110 SceneEpisodes;
- 652 events;
- event dedupe rate 0.99;
- 1,000 retrieval queries;
- retrieval precision@1 1.0;
- 20 edited closed Scenes;
- maximum rebuild scope 1 field;
- stale containment true;
- provenance completeness 1.0.

## Wave 3 integration pressure evidence

- 10,000 host events accepted;
- 50 duplicate host-event checks;
- host dedupe bounded at 2,048 entries;
- host dedupe serialized size 988,988 bytes;
- 5,000 Scene deltas;
- 60 deltas/second in the full integration fixture;
- 6,252 emitted Scene events;
- maximum event envelope 3,390 bytes;
- event dedupe bounded at 512 entries;
- event dedupe serialized size 721,116 bytes;
- 99 duplicate events suppressed;
- 250 transitions;
- 250 SceneEpisodes;
- 2,000 retrieval queries;
- retrieval precision@1 1.0;
- all 2,000 retrievals non-empty;
- 1,000 prefetch recommendations generated;
- prefetch pending set bounded at 32;
- prefetch state serialized size 14,347 bytes;
- 1,000 SceneIntegrationSignal snapshots;
- maximum signal snapshot 19,683 bytes;
- 1,000 SceneUiReadModel snapshots;
- maximum UI snapshot 12,246 bytes;
- active CurrentScene 1,509 bytes at end;
- maximum active CurrentScene 4,161 bytes;
- serialized lifecycle state 30,421,382 bytes for the full synthetic run;
- 10 restart/reconstruction cycles;
- average reconstruction time 775.47 ms for that synthetic state;
- 50 edited closed Scenes;
- maximum source-edit invalidation scope 1 field;
- stale Scene event contained: true;
- stale SceneEpisode contained: true;
- Context invalidation dedupe bounded at 250 entries.

## Recovery / correctness findings

The pressure pass found and repaired two real integration defects before acceptance:

1. retrieval adjacency/relation work was being recomputed inside the Episode loop;
2. recency could outrank an exact SceneEpisode semantic match in repeated-cast near-duplicate scenes.

The accepted implementation precomputes current-Scene adjacency once per retrieval and gives exact semantic matches explicit ranking weight.

## Interpretation

These numbers are deterministic CI evidence for the worker implementation. They are not a live browser responsiveness benchmark and do not replace #185 target-host compatibility or FT002 assembled-main testing.
