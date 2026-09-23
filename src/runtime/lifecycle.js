import { COGNITIVE_LAYERS, LIFECYCLE_STATUS, assertLayer, isForegroundLayer } from './constants.js';
import { compareRevision, deepClone, makeSequenceId, normalizeCapabilities } from './utils.js';

const OPEN = new Set([LIFECYCLE_STATUS.PENDING, LIFECYCLE_STATUS.ELIGIBLE]);

export class LifecycleCore {
  constructor({ ledger, maxOutstanding = 1000 } = {}) {
    if (!ledger) throw new TypeError('LifecycleCore requires a WorkLedger');
    this.ledger = ledger;
    this.maxOutstanding = maxOutstanding;
    this.sequence = this.#recoverSequence();
  }

  #recoverSequence() {
    let max = 0;
    for (const record of this.ledger.list()) {
      const match = String(record.taskId).match(/task-(\d+)/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return max;
  }

  create(input) {
    const layer = assertLayer(input.layer);
    const requiredCapabilities = normalizeCapabilities(input.requiredCapabilities);
    if (!input.taskType) throw new TypeError('taskType is required');
    if (!input.owner) throw new TypeError('owner is required');
    if (!requiredCapabilities.length) throw new TypeError('requiredCapabilities must not be empty');

    const dedupeKey = input.dedupeKey ?? `${input.owner}:${input.taskType}:${input.revision ?? 'none'}`;
    const existing = this.#findByDedupe(dedupeKey);
    if (existing) return { accepted: true, deduped: true, task: existing.obligation };

    const coalesced = input.coalescible && input.coalesceKey
      ? this.#findCoalescible(input.coalesceKey, input.taskType)
      : null;
    if (coalesced) {
      const patch = {
        revision: this.#newerRevision(coalesced.obligation.revision, input.revision),
        sourceRevisions: { ...(coalesced.obligation.sourceRevisions ?? {}), ...(input.sourceRevisions ?? {}) },
        payload: { ...(coalesced.obligation.payload ?? {}), ...(input.payload ?? {}) },
        coalescedCount: (coalesced.obligation.coalescedCount ?? 0) + 1,
      };
      this.ledger.updateObligation(coalesced.taskId, patch);
      return { accepted: true, coalesced: true, task: this.ledger.get(coalesced.taskId).obligation };
    }

    if (this.#openCount() >= this.maxOutstanding) {
      const shed = isForegroundLayer(layer) ? this.#shedOneSpeculative() : null;
      if (!shed) return { accepted: false, reason: 'backpressure' };
    }

    const taskId = input.taskId ?? makeSequenceId('task', ++this.sequence);
    const obligation = {
      taskId,
      taskType: input.taskType,
      layer,
      owner: input.owner,
      requiredCapabilities,
      resourceClass: input.resourceClass ?? null,
      sourceRevisions: deepClone(input.sourceRevisions ?? {}),
      worldRevision: input.worldRevision ?? null,
      sceneRevision: input.sceneRevision ?? null,
      revision: input.revision ?? input.worldRevision ?? 0,
      dependencies: [...(input.dependencies ?? [])],
      priority: Number.isFinite(input.priority) ? input.priority : 50,
      deadline: input.deadline ?? null,
      foreground: input.foreground ?? isForegroundLayer(layer),
      speculative: Boolean(input.speculative),
      dedupeKey,
      conflictKey: input.conflictKey ?? null,
      coalesceKey: input.coalesceKey ?? null,
      coalescible: Boolean(input.coalescible),
      lifecycleStatus: LIFECYCLE_STATUS.PENDING,
      createdSequence: this.ledger.sequence + 1,
      eligibleSequence: null,
      payload: deepClone(input.payload ?? {}),
      coalescedCount: 0,
    };
    this.ledger.createTask(obligation);
    this.#applySupersession(obligation);
    return { accepted: true, task: this.ledger.get(taskId).obligation };
  }

  markEligible(taskId) {
    const record = this.ledger.get(taskId);
    if (!record || !OPEN.has(record.lifecycleStatus)) return record;
    this.ledger.updateObligation(taskId, { eligibleSequence: this.ledger.sequence + 1 });
    return this.ledger.setLifecycle(taskId, LIFECYCLE_STATUS.ELIGIBLE);
  }

  satisfy(taskId) {
    return this.ledger.setLifecycle(taskId, LIFECYCLE_STATUS.SATISFIED);
  }

  cancel(taskId, reason = 'cancelled') {
    return this.ledger.setLifecycle(taskId, LIFECYCLE_STATUS.CANCELLED, reason);
  }

  supersede(taskId, reason = 'superseded') {
    return this.ledger.setLifecycle(taskId, LIFECYCLE_STATUS.SUPERSEDED, reason);
  }

  isFresh(taskId) {
    const record = this.ledger.get(taskId);
    return Boolean(record && OPEN.has(record.lifecycleStatus) && !record.supersession?.requested);
  }

  listOpen() {
    return this.ledger.list().filter((record) => OPEN.has(record.lifecycleStatus));
  }

  #findByDedupe(dedupeKey) {
    return this.ledger.list().find((record) => record.obligation.dedupeKey === dedupeKey && record.lifecycleStatus !== LIFECYCLE_STATUS.CANCELLED) ?? null;
  }

  #findCoalescible(coalesceKey, taskType) {
    return this.ledger.list().find((record) =>
      OPEN.has(record.lifecycleStatus)
      && record.obligation.coalescible
      && record.obligation.coalesceKey === coalesceKey
      && record.obligation.taskType === taskType
      && !['ACTIVE', 'YIELDING'].includes(record.executionStatus)
    ) ?? null;
  }

  #openCount() {
    return this.listOpen().length;
  }

  #shedOneSpeculative() {
    const candidates = this.listOpen()
      .filter((record) => record.obligation.speculative && !['ACTIVE', 'YIELDING'].includes(record.executionStatus))
      .sort((a, b) => {
        const layer = COGNITIVE_LAYERS[b.obligation.layer] - COGNITIVE_LAYERS[a.obligation.layer];
        return layer || b.obligation.priority - a.obligation.priority || b.createdSequence - a.createdSequence;
      });
    if (!candidates.length) return null;
    this.cancel(candidates[0].taskId, 'backpressure-shed');
    return candidates[0].taskId;
  }

  #applySupersession(newObligation) {
    if (!newObligation.conflictKey) return;
    for (const record of this.listOpen()) {
      if (record.taskId === newObligation.taskId) continue;
      if (record.obligation.conflictKey !== newObligation.conflictKey) continue;
      if (compareRevision(record.obligation.revision, newObligation.revision) >= 0) continue;
      if (['ACTIVE', 'YIELDING'].includes(record.executionStatus)) {
        this.ledger.requestSupersession(record.taskId, newObligation.taskId, newObligation.revision);
        this.ledger.requestYield(record.taskId);
      } else {
        this.supersede(record.taskId, `superseded-by:${newObligation.taskId}`);
      }
    }
  }

  #newerRevision(a, b) {
    return compareRevision(a, b) >= 0 ? a : b;
  }
}
