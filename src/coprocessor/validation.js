import { FailureCode, Freshness, ResultStatus } from './constants.js';
import { createWorkerFailure, createWorkerResult } from './contracts.js';

export async function validateWorkerOutput(raw, task, {
  currentRevisionSet = task.inputRevisionSet,
  semanticValidator = null,
  attempt = 1,
  maxRetries = Number(task.fallbackPolicy?.maxRetries ?? 1),
} = {}) {
  let result;
  try {
    result = createWorkerResult(raw);
  } catch (error) {
    return failed(task, FailureCode.MALFORMED_OUTPUT, error.message, attempt, attempt <= maxRetries);
  }

  if (result.taskId !== task.taskId || result.turnId !== task.turnId || result.correlationId !== task.correlationId) {
    return failed(task, FailureCode.CORRELATION_MISMATCH, 'worker result identity does not match task envelope', attempt, false, { resultId: result.resultId });
  }

  const missingCapabilities = task.requiredCapabilities.filter((capability) => !result.capabilities.includes(capability));
  if (missingCapabilities.length) {
    return failed(task, FailureCode.SCHEMA_VALIDATION_FAILED, 'worker result does not attest required capabilities', attempt, attempt <= maxRetries, { missingCapabilities });
  }

  const freshness = compareRevisionSets(result.freshnessIdentity, currentRevisionSet);
  if (freshness === Freshness.INVALID) {
    return {
      valid: false,
      freshness,
      result,
      failure: createWorkerFailure({
        code: FailureCode.INVALID_REVISION, taskId: task.taskId, turnId: task.turnId, correlationId: task.correlationId,
        providerId: result.providerId, workerId: result.workerId, attempt, retryable: false,
        message: 'worker result references a future revision',
      }),
    };
  }

  if (semanticValidator) {
    let semantic;
    try {
      semantic = await semanticValidator(result, task);
    } catch (error) {
      return failed(task, FailureCode.SEMANTIC_VALIDATION_FAILED, error.message, attempt, attempt <= maxRetries);
    }
    if (semantic !== true) {
      return failed(task, FailureCode.SEMANTIC_VALIDATION_FAILED, 'bounded semantic validation rejected output', attempt, attempt <= maxRetries);
    }
  }

  return {
    valid: true,
    freshness,
    result: {
      ...result,
      validationReceipt: {
        ...result.validationReceipt,
        syntax: 'PASS',
        deterministic: 'PASS',
        semantic: semanticValidator ? 'PASS' : 'NOT_REQUIRED',
        freshness,
      },
    },
    failure: freshness === Freshness.STALE
      ? createWorkerFailure({
          code: FailureCode.STALE_RESULT, taskId: task.taskId, turnId: task.turnId, correlationId: task.correlationId,
          providerId: result.providerId, workerId: result.workerId, attempt, retryable: false,
          message: 'worker result is stale for the current revision fence',
        })
      : null,
  };
}

export function compareRevisionSets(actual, current) {
  for (const key of ['worldRevision', 'sceneRevision', 'characterStateRevision']) {
    const a = Number(actual?.[key] ?? 0);
    const c = Number(current?.[key] ?? 0);
    if (a > c) return Freshness.INVALID;
    if (a < c) return Freshness.STALE;
  }
  const aSources = [...(actual?.sourceRevisionSet ?? [])].sort();
  const cSources = [...(current?.sourceRevisionSet ?? [])].sort();
  if (aSources.length !== cSources.length || aSources.some((value, index) => value !== cSources[index])) return Freshness.STALE;
  return Freshness.FRESH;
}

export function resultSatisfiesForeground(result) {
  return [ResultStatus.SUCCESS, ResultStatus.FALLBACK].includes(result?.status);
}

function failed(task, code, message, attempt, retryable, details = {}) {
  return {
    valid: false,
    freshness: Freshness.INVALID,
    result: null,
    failure: createWorkerFailure({
      code, taskId: task.taskId, turnId: task.turnId, correlationId: task.correlationId,
      attempt, retryable, message, details,
    }),
  };
}
