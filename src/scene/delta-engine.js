import { DeltaReason, ObservationClass, RefreshReason, createSceneDelta, createFieldState } from './contracts.js';

const clone = (value) => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergeEvidence(...groups) { return [...new Set(groups.flat().filter(Boolean))]; }
function boundedEvidence(items, limit = 64) { return mergeEvidence(items).slice(-limit); }

export class SceneDeltaEngine {
  constructor({ maxUncertainChain = 3, castChurnThreshold = 8, sourceEditFanoutThreshold = 5 } = {}) {
    this.maxUncertainChain = maxUncertainChain;
    this.castChurnThreshold = castChurnThreshold;
    this.sourceEditFanoutThreshold = sourceEditFanoutThreshold;
    this.uncertainChains = new Map();
  }

  evaluateDrift(scene, proposal) {
    const reasons = [];
    const location = proposal.fields.location;
    if (location?.metadata?.impossibleTransition) reasons.push(RefreshReason.IMPOSSIBLE_TRANSITION);
    if (location?.metadata?.contradictsAccumulatedLocation) reasons.push(RefreshReason.CONTRADICTORY_LOCATION);
    const time = proposal.fields.narrativeTime;
    if (time?.metadata?.sequenceBroken) reasons.push(RefreshReason.TEMPORAL_SEQUENCE_BROKEN);
    const cast = proposal.fields.activeCast;
    if (cast && Array.isArray(cast.value)) {
      const old = Array.isArray(scene.fields.activeCast?.value) ? scene.fields.activeCast.value : [];
      const changed = new Set([...old, ...cast.value]).size - new Set(old.filter((x) => cast.value.includes(x))).size;
      if (changed >= this.castChurnThreshold && cast.observationClass !== ObservationClass.OBSERVED) reasons.push(RefreshReason.CAST_CHURN);
    }
    if (proposal.reason === DeltaReason.SOURCE_EDIT && Object.keys(proposal.fields).length >= this.sourceEditFanoutThreshold) reasons.push(RefreshReason.SOURCE_EDIT_FANOUT);

    for (const [name, field] of Object.entries(proposal.fields)) {
      const key = `${scene.sceneId}:${name}`;
      const uncertain = field.observationClass === ObservationClass.INFERRED || field.observationClass === ObservationClass.UNRESOLVED;
      const count = uncertain ? (this.uncertainChains.get(key) ?? 0) + 1 : 0;
      this.uncertainChains.set(key, count);
      if (count > this.maxUncertainChain) reasons.push(RefreshReason.LOW_CONFIDENCE_CHAIN);
    }
    return [...new Set(reasons)];
  }

  buildDelta(scene, proposal) {
    if (proposal.sceneId !== scene.sceneId) throw new Error('proposal sceneId does not match CurrentScene');
    if (proposal.baseRevision !== scene.revision) throw new Error(`stale proposal: expected base revision ${scene.revision}, got ${proposal.baseRevision}`);
    const changedFields = {};
    let minConfidence = 1;
    for (const [name, proposed] of Object.entries(proposal.fields)) {
      const current = scene.fields[name];
      if (current && same(current.value, proposed.value) && current.observationClass === proposed.observationClass && current.confidence === proposed.confidence) continue;
      changedFields[name] = { before: current ? clone(current) : null, after: clone(proposed) };
      minConfidence = Math.min(minConfidence, proposed.confidence);
    }
    const refreshReasons = this.evaluateDrift(scene, proposal);
    return createSceneDelta({
      sceneId: scene.sceneId,
      fromRevision: scene.revision,
      toRevision: scene.revision + 1,
      changedFields,
      evidenceRefs: mergeEvidence(proposal.evidenceRefs, ...Object.values(proposal.fields).map((x) => x.evidenceRefs)),
      confidence: Object.keys(changedFields).length ? minConfidence : 1,
      reason: proposal.reason,
      fullRefreshRequired: refreshReasons.length > 0,
      refreshReasons,
    });
  }

  apply(scene, proposal, { allowWhenRefreshRequired = false } = {}) {
    const delta = this.buildDelta(scene, proposal);
    if (delta.fullRefreshRequired && !allowWhenRefreshRequired) return { scene: clone(scene), delta, applied: false };
    const next = clone(scene);
    next.revision = delta.toRevision;
    next.updatedAt = Date.now();
    next.sourceRevisionRefs = boundedEvidence([...next.sourceRevisionRefs, ...proposal.sourceRevisionRefs], 128);
    next.provenance = boundedEvidence([...next.provenance, proposal.proposalId, ...proposal.evidenceRefs], 128);
    for (const [name, change] of Object.entries(delta.changedFields)) {
      next.fields[name] = createFieldState({ ...change.after, revision: delta.toRevision });
      next.fieldEvidence[name] = boundedEvidence([...(next.fieldEvidence[name] ?? []), ...change.after.evidenceRefs]);
      const unresolved = [ObservationClass.UNRESOLVED, ObservationClass.UNKNOWN].includes(change.after.observationClass);
      next.unresolvedFields = unresolved ? [...new Set([...next.unresolvedFields, name])] : next.unresolvedFields.filter((x) => x !== name);
    }
    next.health = delta.fullRefreshRequired ? { status: 'warning', reasons: delta.refreshReasons } : { status: 'ready', reasons: [] };
    next.warnings = delta.fullRefreshRequired ? delta.refreshReasons.map((reason) => ({ reason, revision: next.revision })) : [];
    return { scene: next, delta, applied: true };
  }
}
