import { BoundaryStatus } from './contracts.js';

export class BoundaryVerifier {
  constructor({ minimumSupport = 1.0, explicitTransitionOverride = .85, rejectThreshold = -.5, debounceEvents = 1, hysteresis = .2 } = {}) {
    this.minimumSupport = minimumSupport; this.explicitTransitionOverride = explicitTransitionOverride; this.rejectThreshold = rejectThreshold; this.debounceEvents = debounceEvents; this.hysteresis = hysteresis;
    this.pending = new Map(); this.lastDecisionAt = new Map(); this.tick = 0;
  }

  submit(candidate) {
    this.tick += 1;
    const record = { candidate: structuredClone(candidate), support: candidate.confidence, contradict: 0, evidenceRefs:[...candidate.evidenceRefs], events:0, status:BoundaryStatus.PENDING, decision:null };
    if (candidate.explicitTransition && candidate.confidence >= this.explicitTransitionOverride) { record.status = BoundaryStatus.CONFIRMED; record.decision = { status:BoundaryStatus.CONFIRMED, reason:'explicit-transition-override', candidateId:candidate.candidateId, confidence:candidate.confidence, boundaryType:candidate.proposedBoundaryType, evidenceRefs:[...record.evidenceRefs] }; this.lastDecisionAt.set(candidate.sceneId, this.tick); return record.decision; }
    this.pending.set(candidate.candidateId, record); return { status:BoundaryStatus.PENDING, candidateId:candidate.candidateId };
  }

  observe(candidateId, { support = 0, contradict = 0, evidenceRefs = [] } = {}) {
    this.tick += 1;
    const record = this.pending.get(candidateId); if (!record) throw new Error(`unknown boundary candidate ${candidateId}`);
    record.support += Math.max(0, Number(support)); record.contradict += Math.max(0, Number(contradict)); record.events += 1; record.evidenceRefs = [...new Set([...record.evidenceRefs, ...evidenceRefs])];
    const net = record.support - record.contradict;
    const last = this.lastDecisionAt.get(record.candidate.sceneId) ?? -Infinity;
    const debounceSatisfied = (this.tick - last) > this.debounceEvents;
    if (net >= this.minimumSupport + this.hysteresis && debounceSatisfied) return this.#finish(record, BoundaryStatus.CONFIRMED, 'confirmation-window-supported');
    if (net <= this.rejectThreshold || (record.events >= 2 && record.contradict > record.support)) return this.#finish(record, BoundaryStatus.REJECTED, 'confirmation-window-contradicted');
    return { status:BoundaryStatus.PENDING, candidateId, netSupport:net, evidenceRefs:[...record.evidenceRefs] };
  }

  recoverFalseCut(candidateId, evidenceRefs = []) {
    const record = this.pending.get(candidateId); if (record) return this.#finish(record, BoundaryStatus.RECOVERED, 'false-cut-recovery', evidenceRefs);
    return { status:BoundaryStatus.RECOVERED, candidateId, reason:'false-cut-recovery', evidenceRefs:[...evidenceRefs] };
  }

  #finish(record, status, reason, extraEvidence = []) {
    this.pending.delete(record.candidate.candidateId); this.lastDecisionAt.set(record.candidate.sceneId, this.tick); record.status = status;
    record.decision = { status, reason, candidateId:record.candidate.candidateId, sceneId:record.candidate.sceneId, boundaryType:record.candidate.proposedBoundaryType, confidence:Math.max(0, Math.min(1, record.support - record.contradict)), evidenceRefs:[...new Set([...record.evidenceRefs, ...extraEvidence])] };
    return record.decision;
  }
}
