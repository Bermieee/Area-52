import { ObservationClass, createFieldState } from './contracts.js';

export class TemporalStateTracker {
  constructor() { this.lastExplicit = new Map(); }

  update({ sceneId, previous, revision, evidenceRefs = [], proposal = {} }) {
    let observationClass = proposal.observationClass ?? ObservationClass.UNKNOWN;
    let confidence = Number(proposal.confidence ?? (observationClass === ObservationClass.UNKNOWN ? 0 : .5));
    const prior = previous?.value ?? {};
    const value = {
      anchor: proposal.anchor ?? prior.anchor ?? null,
      elapsed: proposal.elapsed ?? null,
      mode: proposal.mode ?? 'CONTINUOUS',
      direction: proposal.direction ?? 'FORWARD',
      correctionOf: proposal.correctionOf ?? null,
    };
    let sequenceBroken = Boolean(proposal.sequenceBroken);
    if (proposal.explicit) {
      this.lastExplicit.set(sceneId, { anchor: value.anchor, evidenceRefs: [...evidenceRefs], revision });
      observationClass = ObservationClass.OBSERVED;
      confidence = 1;
    } else if (proposal.derivedFromPriorInference) {
      observationClass = ObservationClass.UNRESOLVED;
      confidence = Math.min(confidence, .49);
      sequenceBroken = true;
    }
    return createFieldState({ value, confidence, evidenceRefs, observationClass, revision, metadata: { explicit: Boolean(proposal.explicit), sequenceBroken, flashback: value.mode === 'FLASHBACK', parallel: value.mode === 'PARALLEL', sleepWake: value.mode === 'SLEEP_WAKE' } });
  }

  correction({ sceneId, previous, revision, evidenceRefs = [], anchor }) {
    this.lastExplicit.set(sceneId, { anchor, evidenceRefs: [...evidenceRefs], revision });
    return createFieldState({ value: { anchor, elapsed: null, mode: 'CORRECTION', direction: 'UNKNOWN', correctionOf: previous?.value?.anchor ?? null }, confidence: 1, evidenceRefs, observationClass: ObservationClass.OBSERVED, revision, metadata: { explicit: true, corrected: true } });
  }
}
