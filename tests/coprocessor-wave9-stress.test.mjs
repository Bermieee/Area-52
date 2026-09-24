import test from 'node:test';
import assert from 'node:assert/strict';
import { JevDecisionCore, JEV_ADAPTER_LIMITS, createJevDomainAdapterMatrix } from '../src/coprocessor/index.js';
import { currentFor, loreReconciliation, output, providerExecutor, retrievalTruth, sceneBoundary } from './wave9-fixtures.mjs';

function handler({ input }) {
  const ids = input.data.options.map((x) => x.optionId);
  const type = input.data.decisionType;
  let selected = ids[0];
  if (type === 'LORE_RECONCILIATION') selected = ids.includes('TEMPORALLY_DISTINCT') ? 'TEMPORALLY_DISTINCT' : ids[0];
  if (type === 'SCENE_BOUNDARY') selected = ids.includes('CONTINUE_SCENE') ? 'CONTINUE_SCENE' : ids[0];
  if (type === 'TRUTH_SEMANTIC_AMBIGUITY') selected = ids.includes('PRESERVE_UNRESOLVED') ? 'PRESERVE_UNRESOLVED' : ids[0];
  const row = input.data.options.find((x) => x.optionId === selected);
  return { payload: output({ selected: [selected], rejected: ids.filter((id) => id !== selected), evidenceUsed: row?.evidenceRefs?.slice(0, 1) ?? [], confidence: .7 }) };
}

test('Wave 9 mixed adapter stress remains bounded, replay-safe, stale-safe, isolated and non-authoritative', async () => {
  const core = new JevDecisionCore({ providerExecutor: providerExecutor(handler) });
  const m = createJevDomainAdapterMatrix({ core });
  const totals = { decisions: 0, lore: 0, scene: 0, retrieval: 0, duplicates: 0, malformed: 0, stale: 0, deterministicExpected: 0, unresolvedExpected: 0, authorityViolations: 0, staleProposalAcceptance: 0, crossDomainLeaks: 0, forcedDecisionOnAbstain: 0, oversizedProposals: 0 };

  for (let i = 0; i < 3000; i += 1) {
    const domainIndex = i % 3;
    let input;
    if (domainIndex === 0) {
      totals.lore += 1;
      input = loreReconciliation(`stress-lore-${i}`, i % 9 === 0 ? { exactDuplicate: true } : {});
      if (i % 9 === 0) totals.deterministicExpected += 1;
    } else if (domainIndex === 1) {
      totals.scene += 1;
      input = sceneBoundary(`stress-scene-${i}`, i % 10 === 1 ? { boundarySignals: { doorwayOnly: true } } : {});
      if (i % 10 === 1) totals.deterministicExpected += 1;
    } else {
      totals.retrieval += 1;
      input = retrievalTruth(`stress-rt-${i}`, i % 11 === 2 ? { retrievalQuality: 'LOW' } : {});
      if (i % 11 === 2) totals.unresolvedExpected += 1;
    }

    if (i % 97 === 0) {
      input = { ...input, options: [] };
      totals.malformed += 1;
    }

    const stale = i % 89 === 0 && input.options.length > 0;
    const current = stale ? currentFor(input, { worldRevision: input.worldRevision + 1 }) : currentFor(input);
    if (stale) totals.stale += 1;

    const proposal = await m.service.adjudicate(input, { currentRevisionState: current });
    totals.decisions += 1;
    if (proposal.domain !== input.domain) totals.crossDomainLeaks += 1;
    if (proposal.mutationAuthority !== false || proposal.requiresOwnerPolicy !== true) totals.authorityViolations += 1;
    if (stale && proposal.staleState !== 'STALE' && proposal.status !== 'ADAPTER_DEGRADED') totals.staleProposalAcceptance += 1;
    if (input.retrievalQuality === 'LOW' && proposal.proposedOutcome !== 'UNRESOLVED') totals.forcedDecisionOnAbstain += 1;
    if (JSON.stringify(proposal).length > JEV_ADAPTER_LIMITS.maxOwnerProposalBytes) totals.oversizedProposals += 1;

    if (i % 113 === 0 && proposal.sourceRequestRef) {
      const replay = await m.service.adjudicate(structuredClone(input), { currentRevisionState: current });
      totals.duplicates += 1;
      assert.equal(replay, proposal);
    }
  }

  const metrics = m.service.metricsSnapshot();
  assert.equal(m.registry.size, 3);
  assert.equal(totals.authorityViolations, 0);
  assert.equal(totals.staleProposalAcceptance, 0);
  assert.equal(totals.crossDomainLeaks, 0);
  assert.equal(totals.forcedDecisionOnAbstain, 0);
  assert.equal(totals.oversizedProposals, 0);
  assert.equal(JSON.stringify(metrics).includes('Sun Blade'), false);
  assert.ok(core.metricsSnapshot().providerCalls > 0);
  assert.ok(metrics.reduce((sum, row) => sum + row.replays, 0) >= totals.duplicates);
  console.log(JSON.stringify({ stress: 'wave9-jev-domain-adapters', ...totals, providerCalls: core.metricsSnapshot().providerCalls, adapterMetrics: metrics }));
});