import { ObservationClass, createFieldState } from './contracts.js';

export const SceneTemporalIntent=Object.freeze({
  CONTINUOUS:'CONTINUOUS',FLASHBACK:'FLASHBACK',TIME_SKIP:'TIME_SKIP',PARALLEL:'PARALLEL',RESUMED:'RESUMED',
  RECALLED:'RECALLED',HYPOTHETICAL:'HYPOTHETICAL',SLEEP_WAKE:'SLEEP_WAKE',CORRECTION:'CORRECTION',UNKNOWN:'UNKNOWN',
});
const aliases=new Map([['TIMESKIP','TIME_SKIP'],['TIMEJUMP','TIME_SKIP'],['RESUME','RESUMED'],['RECALL','RECALLED'],['HYPOTHESIS','HYPOTHETICAL']]);
export function normalizeSceneTemporalIntent(value){
  const raw=String(value??'CONTINUOUS').trim().toUpperCase().replace(/[ -]+/g,'_');
  const normalized=aliases.get(raw)??raw;
  return Object.values(SceneTemporalIntent).includes(normalized)?normalized:SceneTemporalIntent.UNKNOWN;
}
function intentMetadata(intent){
  const historicalOrCounterfactual=[SceneTemporalIntent.FLASHBACK,SceneTemporalIntent.PARALLEL,SceneTemporalIntent.RECALLED,SceneTemporalIntent.HYPOTHETICAL].includes(intent);
  const currentWorldApplicable=[SceneTemporalIntent.CONTINUOUS,SceneTemporalIntent.TIME_SKIP,SceneTemporalIntent.SLEEP_WAKE].includes(intent);
  return{intentClass:intent,historicalOrCounterfactual,currentWorldApplicable,flashback:intent===SceneTemporalIntent.FLASHBACK,parallel:intent===SceneTemporalIntent.PARALLEL,resumed:intent===SceneTemporalIntent.RESUMED,recalled:intent===SceneTemporalIntent.RECALLED,hypothetical:intent===SceneTemporalIntent.HYPOTHETICAL,timeSkip:intent===SceneTemporalIntent.TIME_SKIP,sleepWake:intent===SceneTemporalIntent.SLEEP_WAKE};
}

export class TemporalStateTracker {
  constructor() { this.lastExplicit = new Map(); }

  update({ sceneId, previous, revision, evidenceRefs = [], proposal = {} }) {
    let observationClass = proposal.observationClass ?? ObservationClass.UNKNOWN;
    let confidence = Number(proposal.confidence ?? (observationClass === ObservationClass.UNKNOWN ? 0 : .5));
    const prior = previous?.value ?? {};
    const intent=normalizeSceneTemporalIntent(proposal.mode??prior.mode??SceneTemporalIntent.CONTINUOUS);
    const value = {
      anchor: proposal.anchor ?? prior.anchor ?? null,
      elapsed: proposal.elapsed ?? null,
      mode: intent,
      direction: proposal.direction ?? (intent===SceneTemporalIntent.FLASHBACK?'BACKWARD':'FORWARD'),
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
    return createFieldState({ value, confidence, evidenceRefs, observationClass, revision, metadata: { explicit: Boolean(proposal.explicit), sequenceBroken, ...intentMetadata(intent) } });
  }

  correction({ sceneId, previous, revision, evidenceRefs = [], anchor }) {
    this.lastExplicit.set(sceneId, { anchor, evidenceRefs: [...evidenceRefs], revision });
    return createFieldState({ value: { anchor, elapsed: null, mode: SceneTemporalIntent.CORRECTION, direction: 'UNKNOWN', correctionOf: previous?.value?.anchor ?? null }, confidence: 1, evidenceRefs, observationClass: ObservationClass.OBSERVED, revision, metadata: { explicit: true, corrected: true, ...intentMetadata(SceneTemporalIntent.CORRECTION) } });
  }
}
