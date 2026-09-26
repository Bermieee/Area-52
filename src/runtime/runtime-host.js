import { DeepCognitionRuntime } from './deep-cognition.js';
import { ObligationProducerRegistry } from './obligation-producers.js';
import { CognitiveObligationReconciler } from './obligation-reconciler.js';
import { NativeTurnRuntime } from './native-swarm.js';
import { SleepMaintenanceRuntime } from './sleep-runtime.js';

export class CognitiveRuntimeHost {
  constructor({ director, sleep = {}, native = {} } = {}) {
    if (!director) throw new TypeError('CognitiveRuntimeHost requires a WorkerDirector');
    this.director = director;
    this.deep = new DeepCognitionRuntime({ director });
    this.sleep = new SleepMaintenanceRuntime({ director, ...sleep });
    this.producers = new ObligationProducerRegistry({ director });
    this.obligations = new CognitiveObligationReconciler({ director });
    this.native = new NativeTurnRuntime({ director, ...native });
  }

  registerWorker(worker) { return this.director.registerWorker(worker); }
  registerService(service) { return this.director.registerService(service); }
  registerEventType(eventType) { return this.director.registerEventType(eventType); }
  registerProducer(producer) { return this.producers.register(producer); }
  registerDeepProfile(profile) { return this.deep.registerProfile(profile); }
  registerSleepProfile(profile) { return this.sleep.registerProfile(profile); }
  registerExecutionResource(resource) { return this.native.registerExecutionResource(resource); }
  publishTurn(turn, admittedJobs) { return this.native.publishTurn(turn, admittedJobs); }
}
