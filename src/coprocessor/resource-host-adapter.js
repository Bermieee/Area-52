import { CoprocessorResourceConnections } from './resource-connections.js';
import { NativeSidecarSwarm, validateCheckpoint } from './native-sidecar-swarm.js';

export const RESOURCE_HOST_ADAPTER_VERSION='1.1.0';

export function createCoprocessorResourceHost({connections=null,swarm=null,planner=null,...options}={}){
  const registry=connections??new CoprocessorResourceConnections(options);
  const coordinator=swarm??new NativeSidecarSwarm({connections:registry,planner,telemetry:options.telemetry,now:options.now});
  return Object.freeze({
    kind:'CoprocessorResourceHostAdapter',
    contractVersion:RESOURCE_HOST_ADAPTER_VERSION,
    actions:Object.freeze({
      addResource:(config)=>registry.addResource(config),
      connectResource:(resourceId,opts)=>registry.connectResource(resourceId,opts),
      disconnectResource:(resourceId,opts)=>registry.disconnectResource(resourceId,opts),
      testResource:(resourceId,opts)=>registry.testResource(resourceId,opts),
      prepareSwarmTurn:(input)=>coordinator.prepareTurn(input),
    }),
    read:Object.freeze({
      resources:()=>registry.readModel(),
      resource:(resourceId)=>registry.readResource(resourceId),
      capabilityProfiles:()=>Object.freeze(registry.profiles.list()),
      swarm:()=>coordinator.readModel(),
      swarmTurn:(turnId)=>coordinator.readTurn(turnId),
    }),
    execution:Object.freeze({
      executeTask:(task,opts)=>registry.executeTask(task,opts),
      executeTaskWithFallback:(task,opts)=>registry.executeTaskWithFallback(task,opts),
      createJevProviderExecutor:(opts)=>registry.createJevProviderExecutor(opts),
      runSwarmTurn:(input)=>coordinator.runTurn(input),
      executeSwarmCheckpoint:(checkpoint,opts)=>coordinator.executeCheckpoint(checkpoint,opts),
    }),
    durability:Object.freeze({
      validateCheckpoint:(checkpoint,maxBytes)=>validateCheckpoint(checkpoint,maxBytes),
    }),
    subscribe:(listener)=>registry.subscribe(listener),
    registry,
    swarm:coordinator,
    authority:Object.freeze({mutation:false,truth:false,precision:false,settlement:false,contextSeal:false,finalChoice:false}),
  });
}
