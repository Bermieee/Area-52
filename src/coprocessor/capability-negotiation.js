import { Placement, ResultClass } from './constants.js';
import { compareCapabilityVersions, toRuntimeCapabilityDescriptor } from './capability-profiles.js';

export const CAPABILITY_NEGOTIATION_VERSION = '1.0.0';

const LATENCY = Object.freeze({ ULTRA_LOW: 0, LOW: 1, MEDIUM: 2, HIGH: 3 });
const COST = Object.freeze({ FREE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 });

export function createCapabilityRequirement(task, options = {}) {
  const contextTokens = Math.max(0, Number(options.contextTokens ?? task.metadata?.contextTokens ?? 0) || 0);
  const expectedOutputTokens = Math.max(0, Number(options.expectedOutputTokens ?? task.metadata?.expectedOutputTokens ?? 0) || 0);
  const requireStructuredOutput = options.requireStructuredOutput ?? task.metadata?.requireStructuredOutput ?? true;
  const foreground = task.resultClass !== ResultClass.DEFERRED;
  return Object.freeze({
    contractVersion: CAPABILITY_NEGOTIATION_VERSION,
    taskId: task.taskId,
    capabilityRequests: structuredClone(task.capabilityRequests ?? []),
    requiredCapabilities: [...(task.requiredCapabilities ?? [])],
    optionalCapabilities: [...(task.optionalCapabilities ?? [])],
    fallbackCapabilities: [...(task.fallbackCapabilities ?? [])],
    fallbackCapabilitySets: structuredClone(task.fallbackCapabilitySets ?? []),
    cognitiveLayer: task.cognitiveLayer,
    placement: task.placement,
    foregroundEligible: foreground,
    backgroundEligible: !foreground || Boolean(task.metadata?.backgroundEligible),
    contextRequirement: Object.freeze({ tokens: contextTokens }),
    outputRequirement: Object.freeze({ tokens: expectedOutputTokens }),
    structuredOutputRequirement: Boolean(requireStructuredOutput),
    latencyBudget: Object.freeze({
      maxClass: options.maxLatencyClass ?? task.metadata?.maxLatencyClass ?? null,
      maxMs: finiteOrNull(options.maxLatencyMs ?? task.metadata?.latencyBudgetMs ?? task.metadata?.maxLatencyMs),
    }),
    costBudget: options.maxCostClass ?? task.metadata?.maxCostClass ?? 'HIGH',
    resourceLimits: structuredClone(options.resourceLimits ?? task.metadata?.resourceLimits ?? task.metadata?.resourceHints ?? {}),
    resourceHints: structuredClone(task.metadata?.resourceHints ?? task.metadata?.resourceLimits ?? {}),
    resourceClass: options.resourceClass ?? task.metadata?.resourceClass ?? null,
    latencyClass: options.latencyClass ?? task.metadata?.latencyClass ?? null,
    resultClass: task.resultClass,
    authorityGranted: false,
    schedulingDecision: null,
  });
}

export function negotiateCapabilities(registry, task, options = {}) {
  if (!registry || typeof registry.discover !== 'function' || typeof registry.list !== 'function') {
    throw new TypeError('negotiateCapabilities requires CapabilityProfileRegistry');
  }
  const requirement = createCapabilityRequirement(task, options);
  const discovery = registry.discover(task, {
    contextTokens: requirement.contextRequirement.tokens,
    expectedOutputTokens: requirement.outputRequirement.tokens,
    requireStructuredOutput: requirement.structuredOutputRequirement,
    maxLatencyClass: requirement.latencyBudget.maxClass,
    maxLatencyMs: requirement.latencyBudget.maxMs,
    maxCostClass: requirement.costBudget,
    preferLocal: Boolean(options.preferLocal ?? task.metadata?.preferLocal),
    resourceLimits: requirement.resourceLimits,
    resourceClass: requirement.resourceClass,
  });
  const requested = discovery.capabilityRequests ?? requirement.capabilityRequests;
  const allProfiles = registry.list();
  const missingCapabilities = requested.filter((request) => !allProfiles.some((profile) =>
    capabilitySatisfied(profile, request))).map((request) => request.id);
  const incompatibilities = [];
  const constraintFailures = [];
  const eligibleIds = new Set(discovery.profiles.map((profile) => profile.profileId));
  for (const profile of allProfiles) {
    if (eligibleIds.has(profile.profileId)) continue;
    const capabilityFailures = requested.filter((request) => !capabilitySatisfied(profile, request)).map((request) => ({
      capability: request.id,
      requiredVersion: request.minVersion ?? 1,
      availableVersion: profile.capabilityDescriptors.find((item) => item.id === request.id)?.version ?? null,
    }));
    if (capabilityFailures.length) {
      incompatibilities.push(Object.freeze({ profileId: profile.profileId, capabilityFailures: Object.freeze(capabilityFailures) }));
      continue;
    }
    const failures = profileConstraintFailures(profile, task, requirement);
    if (failures.length) constraintFailures.push(Object.freeze({ profileId: profile.profileId, failures: Object.freeze(failures) }));
  }
  const optionalCapabilities=requirement.optionalCapabilities;
  const optionalAvailable=optionalCapabilities.filter((capability)=>discovery.profiles.some((profile)=>profile.capabilities.includes(capability)));
  const healthDegraded=discovery.profiles.some((profile)=>String(profile.providerHealth??profile.health).toUpperCase()==='DEGRADED');
  const status=discovery.profiles.length?(discovery.degraded||healthDegraded?'DEGRADED':'SATISFIED'):'UNSATISFIED';
  const missingRequirements=Object.freeze({requiredCapabilities:Object.freeze([...new Set(missingCapabilities)].sort()),constraintFailures:Object.freeze(constraintFailures),optionalCapabilities:Object.freeze(optionalCapabilities.filter((capability)=>!optionalAvailable.includes(capability)))});
  return Object.freeze({
    kind: 'CapabilityNegotiation',
    contractVersion: CAPABILITY_NEGOTIATION_VERSION,
    taskId: task.taskId,
    status,
    requestedCapabilities: structuredClone(requested),
    eligibleImplementations: Object.freeze(discovery.profiles.map(toRuntimeCapabilityDescriptor)),
    eligibleProfiles: Object.freeze(discovery.profiles.map(toRuntimeCapabilityDescriptor)),
    degradedAlternatives: Object.freeze((discovery.degraded||healthDegraded)?discovery.profiles.map(toRuntimeCapabilityDescriptor):[]),
    degraded: Boolean(discovery.degraded||healthDegraded),
    fallbackSetUsed: discovery.degraded ? discovery.fallbackIndex : null,
    missingCapabilities: Object.freeze([...new Set(missingCapabilities)].sort()),
    incompatibilities: Object.freeze(incompatibilities),
    constraintFailures: Object.freeze(constraintFailures),
    missingRequirements,
    optionalCapabilitiesAvailable: Object.freeze(optionalAvailable),
    revision: CAPABILITY_NEGOTIATION_VERSION,
    requirement,
    authorityGranted: false,
    schedulingDecision: null,
  });
}

function capabilitySatisfied(profile, request) {
  const descriptor = profile.capabilityDescriptors.find((item) => item.id === request.id);
  return Boolean(descriptor && compareCapabilityVersions(descriptor.version, request.minVersion ?? 1) >= 0);
}

function profileConstraintFailures(profile, task, requirement) {
  const failures = [];
  if (!profile.available) failures.push('UNAVAILABLE');
  if (!['HEALTHY','DEGRADED'].includes(String(profile.providerHealth??profile.health).toUpperCase())) failures.push('UNHEALTHY');
  if (profile.currentLoad >= profile.concurrencyCapacity) failures.push('CONCURRENCY_FULL');
  if (task.resultClass === ResultClass.DEFERRED ? !profile.backgroundEligible : !profile.foregroundEligible) {
    failures.push(task.resultClass === ResultClass.DEFERRED ? 'BACKGROUND_INELIGIBLE' : 'FOREGROUND_INELIGIBLE');
  }
  if (!profile.supportedLayers.includes(task.cognitiveLayer)) failures.push('COGNITIVE_LAYER_UNSUPPORTED');
  if (!profile.placements.includes(task.placement ?? Placement.HOT)) failures.push('PLACEMENT_UNSUPPORTED');
  if (requirement.structuredOutputRequirement && !profile.structuredOutput) failures.push('STRUCTURED_OUTPUT_UNAVAILABLE');
  if (requirement.contextRequirement.tokens > profile.maxContextTokens) failures.push('CONTEXT_TOO_LARGE');
  if (requirement.outputRequirement.tokens > profile.maxOutputTokens) failures.push('OUTPUT_TOO_LARGE');
  if (requirement.resourceClass != null && profile.resourceClass !== requirement.resourceClass) failures.push('RESOURCE_CLASS_MISMATCH');
  if (!resourcesWithinLimits(profile.resourceProfile, requirement.resourceLimits)) failures.push('RESOURCE_LIMIT_EXCEEDED');
  if ((COST[profile.costClass] ?? 99) > (COST[requirement.costBudget] ?? 99)) failures.push('COST_BUDGET_EXCEEDED');
  if (requirement.latencyBudget.maxClass != null && (LATENCY[profile.latencyClass] ?? 99) > (LATENCY[requirement.latencyBudget.maxClass] ?? 99)) failures.push('LATENCY_CLASS_EXCEEDED');
  if (requirement.latencyBudget.maxMs != null && latencyScore(profile.latencyClass) > requirement.latencyBudget.maxMs) failures.push('LATENCY_BUDGET_EXCEEDED');
  return failures;
}

function finiteOrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function latencyScore(value) { return ({ ULTRA_LOW: 10, LOW: 25, MEDIUM: 100, HIGH: 300 })[value] ?? 100; }

function resourcesWithinLimits(profileResources={}, limits={}) {
  for (const [resource, rawLimit] of Object.entries(limits ?? {})) {
    const limit=Number(rawLimit);
    if (Number.isFinite(limit) && Number(profileResources?.[resource] ?? 0) > limit) return false;
  }
  return true;
}
