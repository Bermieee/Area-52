export const ProviderFailureCode = Object.freeze({
  PROVIDER_FAILURE: 'PROVIDER_FAILURE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_ABORTED: 'PROVIDER_ABORTED',
  MALFORMED_OUTPUT: 'MALFORMED_OUTPUT',
  DEADLINE_EXPIRED: 'DEADLINE_EXPIRED',
});

export class RuntimeProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message ?? code);
    this.name = 'RuntimeProviderError';
    this.code = code;
    this.details = structuredClone(details ?? {});
  }
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function cloneSerializable(value, name = 'provider output') {
  try {
    const cloned = structuredClone(value);
    JSON.stringify(cloned);
    return cloned;
  } catch {
    throw new RuntimeProviderError(ProviderFailureCode.MALFORMED_OUTPUT, `${name} must be structured-cloneable and JSON-serializable`);
  }
}

function validateDeclaredOutput(output, schema = null) {
  if (!schema || typeof schema !== 'object') return { ok: true, reason: 'no-runtime-shape-constraint' };
  const type = schema.type ?? 'any';
  if (type === 'object' && (!output || typeof output !== 'object' || Array.isArray(output))) return { ok: false, reason: 'expected-object' };
  if (type === 'array' && !Array.isArray(output)) return { ok: false, reason: 'expected-array' };
  if (type === 'string' && typeof output !== 'string') return { ok: false, reason: 'expected-string' };
  if (type === 'number' && typeof output !== 'number') return { ok: false, reason: 'expected-number' };
  if (type === 'boolean' && typeof output !== 'boolean') return { ok: false, reason: 'expected-boolean' };
  if (type === 'object' && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (typeof key !== 'string' || !(key in output)) return { ok: false, reason: `missing-required-key:${String(key)}` };
    }
  }
  return { ok: true, reason: 'declared-shape-pass' };
}

function combinedTimeoutMs(task, job, now) {
  const configured = finitePositive(job?.metadata?.providerTimeoutMs ?? job?.providerTimeoutMs ?? task?.payload?.providerTimeoutMs);
  const hardDeadline = finitePositive(task?.payload?.hardDeadline ?? task?.deadline);
  const deadlineRemaining = hardDeadline == null ? null : Math.max(0, hardDeadline - now);
  if (deadlineRemaining === 0) return 0;
  if (configured == null) return deadlineRemaining;
  if (deadlineRemaining == null) return configured;
  return Math.min(configured, deadlineRemaining);
}

export class ProviderExecutionRegistry {
  constructor({ director, now = () => Date.now() } = {}) {
    if (!director) throw new TypeError('ProviderExecutionRegistry requires a WorkerDirector');
    this.director = director;
    this.now = now;
    this.adapters = new Map();
    this.controllers = new Map();
  }

  registerResource({ worker, adapter } = {}) {
    if (!worker?.workerId) throw new TypeError('execution resource workerId is required');
    if (!adapter || typeof adapter.invoke !== 'function') throw new TypeError('execution resource adapter.invoke is required');
    if (this.adapters.has(worker.workerId)) throw new Error(`Provider adapter already registered for ${worker.workerId}`);
    const registered = this.director.registerWorker(worker);
    this.adapters.set(worker.workerId, adapter);
    this.director.telemetry.emit('PROVIDER_ADAPTER_REGISTERED', {
      workerId: registered.workerId,
      provider: registered.provider,
      implementationId: registered.implementationId,
    });
    return registered;
  }

  attachAdapter(workerId, adapter) {
    if (!workerId) throw new TypeError('workerId is required');
    if (!adapter || typeof adapter.invoke !== 'function') throw new TypeError('adapter.invoke is required');
    this.adapters.set(workerId, adapter);
    return true;
  }

  setAvailability(workerId, available) {
    this.director.setWorkerAvailability(workerId, available);
  }

  setHealth(workerId, health) {
    this.director.setWorkerHealth(workerId, health);
  }

  cancelTask(taskId, reason = 'cancelled') {
    const controller = this.controllers.get(taskId);
    if (controller && !controller.signal.aborted) controller.abort(reason);
    return Boolean(controller);
  }

  executorFor(job) {
    const immutableJob = cloneSerializable(job, 'cognitive job');
    return {
      execute: (context) => this.execute(immutableJob, context),
      validate: ({ output }) => output?.kind === 'RuntimeProviderExecution' && output.validation?.ok === true,
      commit: ({ output }) => ({
        providerExecution: structuredClone(output.provenance),
        output: structuredClone(output.output),
        validation: structuredClone(output.validation),
        latencyMs: output.latencyMs,
      }),
    };
  }

  async execute(job, { task, units, sliceId, worker, signal = null } = {}) {
    const workerId = worker?.workerId;
    if (!workerId) throw new RuntimeProviderError(ProviderFailureCode.PROVIDER_UNAVAILABLE, 'Runtime did not supply a selected execution resource');
    const adapter = this.adapters.get(workerId);
    if (!adapter) throw new RuntimeProviderError(ProviderFailureCode.PROVIDER_UNAVAILABLE, `No provider adapter registered for ${workerId}`, { workerId });
    if (signal?.aborted) throw new RuntimeProviderError(ProviderFailureCode.PROVIDER_ABORTED, 'Provider execution aborted before invocation', { workerId, taskId: task?.taskId });

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason ?? 'caller-abort');
    signal?.addEventListener?.('abort', abortFromCaller, { once: true });
    this.controllers.set(task.taskId, controller);
    const startedAt = this.now();
    const timeoutMs = combinedTimeoutMs(task, job, startedAt);
    let timer = null;

    try {
      if (timeoutMs === 0) {
        throw new RuntimeProviderError(ProviderFailureCode.DEADLINE_EXPIRED, 'Provider execution hard deadline already expired', { workerId, taskId: task.taskId });
      }
      this.director.telemetry.emit('PROVIDER_INVOCATION_STARTED', {
        taskId: task.taskId,
        workerId,
        provider: worker.provider ?? null,
        implementationId: worker.implementationId ?? null,
        sliceId,
      });
      const invocation = Promise.resolve().then(() => adapter.invoke({
        task: structuredClone(task),
        job: structuredClone(job),
        units: structuredClone(units ?? []),
        sliceId,
        worker: structuredClone(worker),
        signal: controller.signal,
      }));
      const output = timeoutMs == null
        ? await invocation
        : await Promise.race([
          invocation,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort('provider-timeout');
              reject(new RuntimeProviderError(ProviderFailureCode.PROVIDER_TIMEOUT, `Provider execution timed out after ${timeoutMs}ms`, { workerId, taskId: task.taskId, timeoutMs }));
            }, timeoutMs);
          }),
        ]);
      const serializable = cloneSerializable(output);
      const runtimeValidation = validateDeclaredOutput(serializable, job.outputSchema ?? task.payload?.outputSchema ?? null);
      const adapterValidation = typeof adapter.validate === 'function'
        ? await adapter.validate({ output: structuredClone(serializable), task: structuredClone(task), job: structuredClone(job), worker: structuredClone(worker) })
        : true;
      if (!runtimeValidation.ok || adapterValidation === false || adapterValidation?.ok === false) {
        const reason = runtimeValidation.ok ? (adapterValidation?.reason ?? 'adapter-validation-failed') : runtimeValidation.reason;
        throw new RuntimeProviderError(ProviderFailureCode.MALFORMED_OUTPUT, `Provider output rejected: ${reason}`, { workerId, taskId: task.taskId, reason });
      }
      const completedAt = this.now();
      const result = {
        kind: 'RuntimeProviderExecution',
        output: serializable,
        provenance: {
          workerId,
          providerId: worker.provider ?? null,
          implementationId: worker.implementationId ?? null,
          modelId: worker.model ?? null,
          capabilities: [...(worker.capabilities ?? [])],
        },
        validation: { ok: true, runtime: runtimeValidation.reason, adapter: adapterValidation?.reason ?? (adapterValidation === true ? 'pass' : 'not-supplied') },
        startedAt,
        completedAt,
        latencyMs: Math.max(0, completedAt - startedAt),
      };
      this.director.telemetry.emit('PROVIDER_INVOCATION_COMPLETED', {
        taskId: task.taskId,
        workerId,
        provider: worker.provider ?? null,
        latencyMs: result.latencyMs,
      });
      return result;
    } catch (error) {
      let typed = error;
      if (!(typed instanceof RuntimeProviderError)) {
        const aborted = controller.signal.aborted || typed?.name === 'AbortError';
        typed = new RuntimeProviderError(
          aborted ? ProviderFailureCode.PROVIDER_ABORTED : ProviderFailureCode.PROVIDER_FAILURE,
          typed?.message ?? String(typed),
          { workerId, taskId: task?.taskId },
        );
      }
      this.director.telemetry.emit('PROVIDER_INVOCATION_FAILED', {
        taskId: task?.taskId ?? null,
        workerId,
        provider: worker?.provider ?? null,
        code: typed.code,
        message: typed.message,
      });
      throw typed;
    } finally {
      if (timer != null) clearTimeout(timer);
      signal?.removeEventListener?.('abort', abortFromCaller);
      if (this.controllers.get(task?.taskId) === controller) this.controllers.delete(task.taskId);
    }
  }
}
