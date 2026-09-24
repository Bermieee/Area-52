import { normalizePrefetchRecommendation } from './speculative-warmer.js';

export const SUPPORTED_SCENE_EVENTS = Object.freeze([
  'SCENE_STATE_DELTA',
  'LOCATION_CHANGED',
  'TIME_SHIFT_DETECTED',
  'ACTIVE_CAST_CHANGED',
  'SCENE_BOUNDARY_CANDIDATE',
  'SCENE_BOUNDARY_CONFIRMED',
  'SCENE_OPENED',
  'SCENE_CLOSED',
  'PREFETCH_RECOMMENDED',
  'RELATIONSHIP_SIGNAL',
  'VIBE_CHANGED',
  'OBJECT_TRANSITION',
]);

export function adaptScenePublicSignals(input = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('Scene public signal artifact is required');
  return Object.freeze({
    sceneRevision: finiteOrNull(input.sceneRevision),
    sceneEntities: Object.freeze(entityRefs(input)),
    activeCast: Object.freeze([...(input.activeCast ?? [])]),
    location: structuredClone(input.location ?? null),
    activeThreads: Object.freeze([...(input.activeThreads ?? [])]),
    uncertainSceneFields: Object.freeze([...(input.uncertainFields ?? [])]),
    conflictSignals: Object.freeze([...(input.conflictSignals ?? [])]),
    sceneTransitionType: input.sceneRelationship ?? input.boundaryState?.type ?? null,
    retrievalQuality: input.retrievalQuality ?? null,
    prefetchRecommendations: Object.freeze((input.prefetchRecommendations ?? []).map(normalizePrefetchRecommendation)),
    sceneHealth: structuredClone(input.health ?? null),
    episodeRefs: Object.freeze([...(input.episodeRefs ?? [])]),
    authorityGranted: false,
  });
}

export function adaptSceneEvent(input = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('Scene event is required');
  if (!SUPPORTED_SCENE_EVENTS.includes(input.eventType)) throw new TypeError(`Unsupported Scene event: ${input.eventType}`);
  const payload = input.payload ?? {};
  const base = {
    eventType: input.eventType,
    sceneId: input.sceneId ?? null,
    sceneRevision: finiteOrNull(input.sceneRevision),
    sourceRevisionSet: Object.freeze(Object.keys(input.sourceRevisions ?? input.revisionFences?.sourceRevisions ?? {}).length
      ? Object.keys(input.sourceRevisions ?? input.revisionFences?.sourceRevisions ?? {}).sort()
      : [...(input.sourceRevisionRefs ?? [])].sort()),
    correlationId: input.correlationId ?? null,
    causationId: input.causationId ?? null,
    turnId: input.turnId ?? null,
    dedupeKey: input.dedupeKey ?? null,
    activeCast: null,
    location: null,
    uncertainSceneFields: [],
    conflictSignals: [],
    sceneTransitionType: null,
    retrievalQuality: null,
    prefetchRecommendations: [],
    sceneClosed: false,
    sceneOpened: false,
    majorTimeShift: false,
    authorityGranted: false,
  };

  if (input.eventType === 'PREFETCH_RECOMMENDED') {
    base.prefetchRecommendations = [normalizePrefetchRecommendation(payload.recommendation ?? payload)];
  } else if (input.eventType === 'LOCATION_CHANGED') {
    base.location = extractChangedValue(payload.change ?? payload);
    base.sceneTransitionType = 'LOCATION';
  } else if (input.eventType === 'TIME_SHIFT_DETECTED') {
    base.sceneTransitionType = 'TIME_SHIFT';
    base.majorTimeShift = true;
  } else if (input.eventType === 'ACTIVE_CAST_CHANGED') {
    base.activeCast = extractChangedValue(payload.change ?? payload) ?? [];
  } else if (input.eventType === 'SCENE_BOUNDARY_CANDIDATE') {
    base.sceneTransitionType = payload.candidate?.proposedBoundaryType ?? 'BOUNDARY_CANDIDATE';
    base.uncertainSceneFields = ['boundaryState'];
  } else if (input.eventType === 'SCENE_BOUNDARY_CONFIRMED') {
    base.sceneTransitionType = payload.boundaryType ?? payload.candidate?.proposedBoundaryType ?? 'BOUNDARY_CONFIRMED';
  } else if (input.eventType === 'SCENE_CLOSED') {
    base.sceneClosed = true;
    base.sceneTransitionType = 'SCENE_CLOSED';
  } else if (input.eventType === 'SCENE_OPENED') {
    base.sceneOpened = true;
    base.sceneTransitionType = payload.relationshipToPrior ?? 'SCENE_OPENED';
  } else if (input.eventType === 'SCENE_STATE_DELTA') {
    const delta = payload.delta ?? {};
    base.uncertainSceneFields = [...(delta.refreshReasons ?? [])];
    if (delta.changedFields?.location) base.location = extractChangedValue(delta.changedFields.location);
    if (delta.changedFields?.activeCast) base.activeCast = extractChangedValue(delta.changedFields.activeCast) ?? [];
  }
  return deepFreeze(base);
}

export function plannerInputFromScene({ publicSignals = null, events = [], base = {} } = {}) {
  const output = { ...structuredClone(base) };
  if (publicSignals) Object.assign(output, adaptScenePublicSignals(publicSignals));
  for (const event of events) {
    const patch = adaptSceneEvent(event);
    if (patch.activeCast != null) output.activeCast = patch.activeCast;
    if (patch.location != null) output.location = patch.location;
    if (patch.sceneTransitionType != null) output.sceneTransitionType = patch.sceneTransitionType;
    if (patch.retrievalQuality != null) output.retrievalQuality = patch.retrievalQuality;
    output.uncertainSceneFields = unique([...(output.uncertainSceneFields ?? []), ...(patch.uncertainSceneFields ?? [])]);
    output.conflictSignals = unique([...(output.conflictSignals ?? []), ...(patch.conflictSignals ?? [])]);
    output.prefetchRecommendations = dedupeRecommendations([...(output.prefetchRecommendations ?? []), ...(patch.prefetchRecommendations ?? [])]);
    output.sceneClosed = Boolean(output.sceneClosed || patch.sceneClosed);
    output.sceneOpened = Boolean(output.sceneOpened || patch.sceneOpened);
    output.majorTimeShift = Boolean(output.majorTimeShift || patch.majorTimeShift);
    if (patch.sceneRevision != null) output.sceneRevision = patch.sceneRevision;
  }
  return deepFreeze(output);
}

function entityRefs(input) {
  const refs = [];
  for (const item of input.activeCast ?? []) {
    const ref = typeof item === 'string' ? item : item.characterRef ?? item.characterId ?? item.ref;
    if (typeof ref === 'string') refs.push(ref);
  }
  for (const item of input.objects ?? []) {
    const ref = typeof item === 'string' ? item : item.objectRef ?? item.ref;
    if (typeof ref === 'string') refs.push(ref);
  }
  return unique(refs);
}
function extractChangedValue(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return structuredClone(value);
  if ('value' in value) return structuredClone(value.value);
  if ('to' in value) return structuredClone(value.to?.value ?? value.to);
  if ('after' in value) return structuredClone(value.after?.value ?? value.after);
  return structuredClone(value);
}
function dedupeRecommendations(values) { const seen = new Set(); const out = []; for (const value of values) { const normalized = normalizePrefetchRecommendation(value); if (seen.has(normalized.recommendationId)) continue; seen.add(normalized.recommendationId); out.push(normalized); } return out; }
function unique(values) { return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))]; }
function finiteOrNull(value) { if (value == null) return null; const n = Number(value); if (!Number.isFinite(n)) throw new TypeError('scene revision must be finite'); return n; }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
