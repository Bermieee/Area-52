// Follow-up (audit D14): DEEP_BACKGROUND is a scheduling lane, not a provider label. An operator-connected resource
// (default resourceClass STANDARD, placements HOT+DEEP, background eligible) serves it; other resource classes stay exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityProfileRegistry, resourceClassSatisfied, SCHEDULING_RESOURCE_CLASSES } from '../src/coprocessor/capability-profiles.js';
import { negotiateCapabilities } from '../src/coprocessor/capability-negotiation.js';
import { Capability, Placement } from '../src/coprocessor/constants.js';

test('the scheduling class is satisfied by placement and background eligibility, never by a profile label', () => {
  assert.deepEqual([...SCHEDULING_RESOURCE_CLASSES], ['DEEP_BACKGROUND']);
  assert.equal(resourceClassSatisfied({ resourceClass: 'STANDARD', placements: ['HOT', 'DEEP'], backgroundEligible: true }, 'DEEP_BACKGROUND'), true);
  assert.equal(resourceClassSatisfied({ resourceClass: 'STANDARD', placements: ['HOT'], backgroundEligible: true }, 'DEEP_BACKGROUND'), false, 'no DEEP placement');
  assert.equal(resourceClassSatisfied({ resourceClass: 'STANDARD', placements: ['HOT', 'DEEP'], backgroundEligible: false }, 'DEEP_BACKGROUND'), false, 'not background eligible');
  assert.equal(resourceClassSatisfied({ resourceClass: 'STANDARD', placements: [], backgroundEligible: true }, null), true, 'no requested class');
});

test('other resource classes still need an exact profile match', () => {
  assert.equal(resourceClassSatisfied({ resourceClass: 'NATIVE' }, 'NATIVE'), true);
  assert.equal(resourceClassSatisfied({ resourceClass: 'STANDARD' }, 'NATIVE'), false);
  assert.equal(resourceClassSatisfied({ resourceClass: 'NATIVE', placements: ['DEEP'], backgroundEligible: true }, 'STANDARD'), false);
});

test('capability negotiation admits a default connected profile for DEEP_BACKGROUND work and reports a mismatch for a foreground-only one', () => {
  const profiles = new CapabilityProfileRegistry();
  const base = { workerId: 'w', providerId: 'p', capabilities: [Capability.CONSOLIDATION], supportedLayers: ['L3'], available: true, health: 'HEALTHY' };
  profiles.register({ ...base, profileId: 'general', placements: [Placement.HOT, Placement.DEEP], foregroundEligible: true, backgroundEligible: true });
  profiles.register({ ...base, profileId: 'hot-only', providerId: 'p2', workerId: 'w2', placements: [Placement.HOT], foregroundEligible: true, backgroundEligible: true });
  const task = { taskType: 'CONSOLIDATION', placement: Placement.DEEP, cognitiveLayer: 'L3', resultClass: 'DEFERRED', capabilityRequests: [{ id: Capability.CONSOLIDATION }], metadata: { resourceClass: 'DEEP_BACKGROUND' }, inputRevisionSet: {}, requiredCapabilities: [Capability.CONSOLIDATION] };
  let result;
  try { result = negotiateCapabilities(profiles, task, {}); } catch (error) { result = { error: String(error?.message ?? error) }; }
  assert.ok(!result.error, result.error);
  const eligible = (result.eligibleProfiles ?? result.profiles ?? []).map((p) => p.profileId ?? p);
  assert.ok(eligible.includes('general'), 'the general connected profile serves DEEP_BACKGROUND work: ' + JSON.stringify(Object.keys(result)));
  assert.equal(eligible.includes('hot-only'), false);
});
