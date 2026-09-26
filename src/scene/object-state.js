import { ObjectPresence, ObservationClass, createFieldState } from './contracts.js';
import { createObjectStateTransitionProposal } from './integration-contracts.js';

const clone = (value) => structuredClone(value);
const bounded = (items, limit = 32) => [...new Set(items)].slice(-limit);
const weakMention = (state) => state === ObjectPresence.MENTIONED_ONLY;

export class ObjectStateTracker {
  constructor({ maxEntries = 96, maxMentionedOnly = 32 } = {}) { this.maxEntries = maxEntries; this.maxMentionedOnly = maxMentionedOnly; }
  update({ previous = [], observations = [], revision, evidenceRefs = [] }) {
    const map = new Map(previous.map((item) => [item.objectId, clone(item)]));
    for (const obs of observations) {
      if (!obs.objectId) continue;
      const existing = map.get(obs.objectId);
      const state = obs.state ?? ObjectPresence.UNCERTAIN;
      const next = {
        objectId: obs.objectId,
        state,
        holderId: [ObjectPresence.HELD, ObjectPresence.CARRIED, ObjectPresence.WORN].includes(state) ? (obs.holderId ?? null) : null,
        containerId: state === ObjectPresence.CONTAINED ? (obs.containerId ?? null) : null,
        confidence: Number(obs.confidence ?? .5),
        observationClass: obs.observationClass ?? (state === ObjectPresence.UNCERTAIN ? ObservationClass.UNRESOLVED : ObservationClass.OBSERVED),
        evidenceRefs: bounded([...(existing?.evidenceRefs ?? []), ...(obs.evidenceRefs ?? [])]),
        durableProposal: obs.durableProposal ? structuredClone(obs.durableProposal) : null,
        seenRevision: revision,
      };
      if (state === ObjectPresence.MENTIONED_ONLY) { next.holderId = null; next.containerId = null; }
      if (existing && weakMention(state) && !weakMention(existing.state) && existing.state !== ObjectPresence.UNCERTAIN) { existing.evidenceRefs = bounded([...(existing.evidenceRefs ?? []), ...(obs.evidenceRefs ?? [])]); map.set(obs.objectId, existing); continue; }
      map.set(obs.objectId, next);
    }
    const all = [...map.values()];
    const stronger = all.filter((x) => x.state !== ObjectPresence.MENTIONED_ONLY);
    const mentioned = all.filter((x) => x.state === ObjectPresence.MENTIONED_ONLY).sort((a,b)=>(b.seenRevision??0)-(a.seenRevision??0)).slice(0,this.maxMentionedOnly);
    const value = [...stronger, ...mentioned].sort((a,b)=>(b.seenRevision??0)-(a.seenRevision??0)).slice(0,this.maxEntries).sort((a, b) => a.objectId.localeCompare(b.objectId));
    const unresolved = value.some((item) => item.state === ObjectPresence.UNCERTAIN || item.observationClass === ObservationClass.UNRESOLVED);
    const inferred = value.some((item) => item.observationClass === ObservationClass.INFERRED);
    return createFieldState({ value, confidence: value.length ? Math.min(...value.map((item) => item.confidence)) : 1, evidenceRefs: bounded([...evidenceRefs, ...value.flatMap((x) => x.evidenceRefs)], 64), observationClass: unresolved ? ObservationClass.UNRESOLVED : inferred ? ObservationClass.INFERRED : ObservationClass.OBSERVED, revision });
  }

  mention(objectId, evidenceRef) { return { objectId, state: ObjectPresence.MENTIONED_ONLY, confidence: 1, observationClass: ObservationClass.OBSERVED, evidenceRefs: [evidenceRef], durableProposal:null }; }

  proposalObservation({sceneId,sceneRevision,objectId,before=null,after,evidenceRefs=[],sourceRevisionRefs=[],confidence=1,observationClass=ObservationClass.OBSERVED}){
    const proposal=createObjectStateTransitionProposal({proposalId:`object-transition:${sceneId}:${sceneRevision}:${objectId}:${after?.state??'UNKNOWN'}`,sceneId,sceneRevision,objectRef:objectId,before,after,evidenceRefs,sourceRevisionRefs,confidence,observationClass});
    return {objectId,state:after?.state??ObjectPresence.UNCERTAIN,holderId:after?.holderId??null,containerId:after?.containerId??null,confidence,observationClass,evidenceRefs:[...evidenceRefs],durableProposal:proposal};
  }

  pickup(objectId, holderId, evidenceRef, context={}) {
    if(context.sceneId&&context.sceneRevision)return this.proposalObservation({sceneId:context.sceneId,sceneRevision:context.sceneRevision,objectId,before:context.before??null,after:{state:ObjectPresence.HELD,holderId},evidenceRefs:[evidenceRef],sourceRevisionRefs:context.sourceRevisionRefs??[]});
    return { objectId, state: ObjectPresence.HELD, holderId, confidence: 1, observationClass:ObservationClass.OBSERVED, evidenceRefs: [evidenceRef], durableProposal: { type: 'OBJECT_STATE_CHANGE', objectId, state: 'HELD', holderId } };
  }
  drop(objectId, evidenceRef, context={}) {
    if(context.sceneId&&context.sceneRevision)return this.proposalObservation({sceneId:context.sceneId,sceneRevision:context.sceneRevision,objectId,before:context.before??null,after:{state:ObjectPresence.PRESENT},evidenceRefs:[evidenceRef],sourceRevisionRefs:context.sourceRevisionRefs??[]});
    return { objectId, state: ObjectPresence.PRESENT, confidence: 1, observationClass:ObservationClass.OBSERVED, evidenceRefs: [evidenceRef], durableProposal: { type: 'OBJECT_STATE_CHANGE', objectId, state: 'PRESENT' } };
  }
  transfer({sceneId,sceneRevision,objectId,fromHolderId,toHolderId,evidenceRef,sourceRevisionRefs=[]}){return this.proposalObservation({sceneId,sceneRevision,objectId,before:{state:ObjectPresence.HELD,holderId:fromHolderId},after:{state:ObjectPresence.HELD,holderId:toHolderId},evidenceRefs:[evidenceRef],sourceRevisionRefs});}
  destroy({sceneId,sceneRevision,objectId,before=null,evidenceRef,sourceRevisionRefs=[]}){return this.proposalObservation({sceneId,sceneRevision,objectId,before,after:{state:ObjectPresence.DESTROYED},evidenceRefs:[evidenceRef],sourceRevisionRefs});}
  damage({sceneId,sceneRevision,objectId,before=null,evidenceRef,sourceRevisionRefs=[]}){return this.proposalObservation({sceneId,sceneRevision,objectId,before,after:{state:ObjectPresence.DAMAGED},evidenceRefs:[evidenceRef],sourceRevisionRefs});}
  remove({sceneId,sceneRevision,objectId,before=null,evidenceRef,sourceRevisionRefs=[]}){return this.proposalObservation({sceneId,sceneRevision,objectId,before,after:{state:ObjectPresence.REMOVED},evidenceRefs:[evidenceRef],sourceRevisionRefs});}
  hide({sceneId,sceneRevision,objectId,before=null,evidenceRef,sourceRevisionRefs=[],confidence=1,observationClass=ObservationClass.OBSERVED}){return this.proposalObservation({sceneId,sceneRevision,objectId,before,after:{state:ObjectPresence.HIDDEN},evidenceRefs:[evidenceRef],sourceRevisionRefs,confidence,observationClass});}
  uncertain({sceneId,sceneRevision,objectId,before=null,evidenceRef,sourceRevisionRefs=[],confidence=.5}){return this.proposalObservation({sceneId,sceneRevision,objectId,before,after:{state:ObjectPresence.UNCERTAIN},evidenceRefs:[evidenceRef],sourceRevisionRefs,confidence,observationClass:ObservationClass.UNRESOLVED});}
}
