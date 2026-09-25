import { immutableCopy, makeSequenceId } from './utils.js';

export class RuntimeTelemetry {
  constructor({ limit = 1000, sink = null } = {}) {
    this.limit = limit;
    this.sink = sink;
    this.sequence = 0;
    this.signals = [];
    this.sinkFailures = 0;
  }

  emit(type, data = {}) {
    const signal = immutableCopy({
      id: makeSequenceId('sig', ++this.sequence),
      type,
      sequence: this.sequence,
      ...data,
    });
    this.signals.push(signal);
    if (this.signals.length > this.limit) this.signals.shift();
    if (this.sink) {
      try {
        this.sink(signal);
      } catch {
        this.sinkFailures += 1;
      }
    }
    return signal;
  }

  list({ type = null } = {}) {
    return this.signals.filter((signal) => !type || signal.type === type);
  }

  snapshot() {
    return {
      retainedSignals: this.signals.length,
      sinkFailures: this.sinkFailures,
      latestSequence: this.sequence,
    };
  }
}
