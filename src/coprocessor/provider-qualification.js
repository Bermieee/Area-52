import { FailureCode } from './constants.js';
import { negotiateCapabilities } from './capability-negotiation.js';

export async function runProviderQualification({ registry, executionLayer, task, input, constraints = {}, signal = null, maxProviders = 2 } = {}) {
  if (!executionLayer || typeof executionLayer.execute !== 'function') throw new TypeError('executionLayer.execute is required');
  const negotiation = negotiateCapabilities(registry, task, constraints);
  const attempts = [];
  const profiles = negotiation.eligibleImplementations.slice(0, Math.max(1, Number(maxProviders) || 2));
  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    try {
      const result = await executionLayer.execute(task, { input, attempt: index + 1, signal, profileId: profile.profileId });
      attempts.push(Object.freeze({ profileId: profile.profileId ?? null, providerId: result.providerId, status: 'SUCCESS', failureCode: null }));
      return Object.freeze({ status: index === 0 ? 'SUCCESS' : 'FALLBACK', negotiation, attempts: Object.freeze(attempts), result });
    } catch (error) {
      attempts.push(Object.freeze({ profileId: profile.profileId ?? null, providerId: profile.provider ?? error.providerId ?? null, status: 'FAILED', failureCode: error.code ?? FailureCode.PROVIDER_FAILURE }));
      if (signal?.aborted) break;
    }
  }
  return Object.freeze({ status: 'FAILED', negotiation, attempts: Object.freeze(attempts), result: null });
}
