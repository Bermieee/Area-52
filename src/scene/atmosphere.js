import { ObservationClass, createFieldState } from './contracts.js';

const DIMENSIONS = Object.freeze(['tension','danger','intimacy','urgency','uncertainty','humor','grief','hostility']);

export class AtmosphereTracker {
  nextScene({ revision, evidenceRefs = [], dimensions = {} } = {}) { return this.update({ revision, evidenceRefs, dimensions }); }
  update({ revision, evidenceRefs = [], dimensions = {} }) {
    const value = {};
    let minConfidence = 1;
    for (const name of DIMENSIONS) {
      if (!(name in dimensions)) continue;
      const input = dimensions[name];
      const score = Math.max(0, Math.min(1, Number(input.score ?? input.value ?? 0)));
      const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? .5)));
      const refs = [...new Set([...(input.evidenceRefs ?? []), ...evidenceRefs])];
      value[name] = { score, confidence, evidenceRefs: refs };
      minConfidence = Math.min(minConfidence, confidence);
    }
    return createFieldState({ value, confidence: Object.keys(value).length ? minConfidence : 0, evidenceRefs: [...new Set([...evidenceRefs, ...Object.values(value).flatMap((x) => x.evidenceRefs)])], observationClass: Object.keys(value).length ? ObservationClass.INFERRED : ObservationClass.UNKNOWN, revision, metadata: { sceneScoped: true, canonical: false, dimensions: DIMENSIONS } });
  }
}

export { DIMENSIONS as AtmosphereDimensions };
