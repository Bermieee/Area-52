import { EXECUTION_STATUS, LIFECYCLE_STATUS } from './constants.js';
import { sanitizeObligationCause } from './obligation-cause.js';

// Owners declare expected steps; Runtime checks durable task evidence and only schedules supplied executors.
export class CognitiveObligationReconciler {
  constructor({ director } = {}) {
    if (!director) throw new TypeError('CognitiveObligationReconciler requires a WorkerDirector');
    this.director = director;
  }

  inspect(expected) { return this.#evaluate(expected, false); }
  reconcile(expected) { return this.#evaluate(expected, true); }

  #evaluate(expected, submitDue) {
    if (!Array.isArray(expected)) throw new TypeError('expected steps must be an array');
    const seen = new Set();
    const steps = [];
    for (const step of expected) {
      if (!step?.stepId || seen.has(step.stepId)) throw new TypeError('stepId must be unique and nonempty');
      if (!step.obligation?.dedupeKey) throw new TypeError('each expected obligation requires a dedupeKey');
      seen.add(step.stepId);
      const dependency = (step.dependsOn ?? []).find((id) => steps.find((item) => item.stepId === id)?.state !== 'DONE');
      let record = this.director.ledger.list().find((item) => item.obligation.dedupeKey === step.obligation.dedupeKey && item.lifecycleStatus !== LIFECYCLE_STATUS.CANCELLED);
      let why = null;
      if (!record && submitDue && !dependency && typeof step.executor?.execute === 'function') {
        const admitted = this.director.submit({ ...step.obligation, cause: step.cause ?? null }, step.executor);
        if (admitted.accepted) {
          record = this.director.ledger.get(admitted.task.taskId);
          why = admitted.deduped ? 'already-admitted' : 'admitted-for-execution';
        } else why = admitted.reason;
      }
      const explained = record ? this.director.explainObligation(record.taskId) : null;
      let state = 'MISSING';
      if (record?.lifecycleStatus === LIFECYCLE_STATUS.SATISFIED && record.executionStatus === EXECUTION_STATUS.COMPLETE) state = 'DONE';
      else if (record?.lifecycleStatus === LIFECYCLE_STATUS.SUPERSEDED) state = 'BLOCKED';
      else if (record?.executionStatus === EXECUTION_STATUS.BLOCKED || record?.executionStatus === EXECUTION_STATUS.FAILED) state = 'BLOCKED';
      else if (record) state = 'DUE';
      else if (dependency || submitDue && typeof step.executor?.execute !== 'function') state = 'BLOCKED';
      why ??= explained?.why ?? (dependency ? `dependency-not-done:${dependency}` : state === 'BLOCKED' ? 'executor-not-provided' : state === 'MISSING' ? 'obligation-not-created' : state === 'DONE' ? 'completed-and-satisfied' : 'awaiting-execution');
      steps.push({ stepId: step.stepId, state, why, taskId: record?.taskId ?? null,
        producer: step.obligation.owner, cause: sanitizeObligationCause(explained?.cause ?? step.cause),
        communications: explained?.communications ?? [] });
    }
    return { kind: 'CognitiveObligationReconciliation', steps,
      complete: steps.every((step) => step.state === 'DONE') };
  }
}
