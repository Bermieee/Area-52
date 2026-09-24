import { ObjectPresence, ObservationClass, createFieldState } from './contracts.js';

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
    const unresolved = value.some((item) => item.state === ObjectPresence.UNCERTAIN);
    return createFieldState({ value, confidence: value.length ? Math.min(...value.map((item) => item.confidence)) : 1, evidenceRefs: bounded([...evidenceRefs, ...value.flatMap((x) => x.evidenceRefs)], 64), observationClass: unresolved ? ObservationClass.UNRESOLVED : ObservationClass.OBSERVED, revision });
  }

  mention(objectId, evidenceRef) { return { objectId, state: ObjectPresence.MENTIONED_ONLY, confidence: 1, evidenceRefs: [evidenceRef] }; }
  pickup(objectId, holderId, evidenceRef) { return { objectId, state: ObjectPresence.HELD, holderId, confidence: 1, evidenceRefs: [evidenceRef], durableProposal: { type: 'OBJECT_STATE_CHANGE', objectId, state: 'HELD', holderId } }; }
  drop(objectId, evidenceRef) { return { objectId, state: ObjectPresence.PRESENT, confidence: 1, evidenceRefs: [evidenceRef], durableProposal: { type: 'OBJECT_STATE_CHANGE', objectId, state: 'PRESENT' } }; }
}
