import { DeepCognitionRuntime } from './deep-cognition.js';
import { ObligationProducerRegistry } from './obligation-producers.js';
import { SleepMaintenanceRuntime } from './sleep-runtime.js';

export class CognitiveRuntimeHost {
  constructor({ director, sleep = {} } = {}) {
    if (!director) throw new TypeError('CognitiveRuntimeHost requires a WorkerDirector');
    this.director = director;
    this.deep = new DeepCognitionRuntime({ director });
    this.sleep = new SleepMaintenanceRuntime({ director, ...sleep });
    this.producers = new ObligationProducerRegistry({ director });
  }

  registerWorker(worker) { return this.director.registerWorker(worker); }
  registerService(service) { return this.director.registerService(service); }
  registerEventType(eventType) { return this.director.registerEventType(eventType); }
  registerProducer(producer) { return this.producers.register(producer); }
  registerDeepProfile(profile) { return this.deep.registerProfile(profile); }
  registerSleepProfile(profile) { return this.sleep.registerProfile(profile); }
}
