import { CoprocessorResourceConnections } from './resource-connections.js';

export const RESOURCE_HOST_ADAPTER_VERSION='1.0.0';

export function createCoprocessorResourceHost({connections=null,...options}={}){
  const registry=connections??new CoprocessorResourceConnections(options);
  return Object.freeze({
    kind:'CoprocessorResourceHostAdapter',
    contractVersion:RESOURCE_HOST_ADAPTER_VERSION,
    actions:Object.freeze({
      addResource:(config)=>registry.addResource(config),
      connectResource:(resourceId,opts)=>registry.connectResource(resourceId,opts),
      disconnectResource:(resourceId,opts)=>registry.disconnectResource(resourceId,opts),
      testResource:(resourceId,opts)=>registry.testResource(resourceId,opts),
    }),
    read:Object.freeze({
      resources:()=>registry.readModel(),
      resource:(resourceId)=>registry.readResource(resourceId),
      capabilityProfiles:()=>Object.freeze(registry.profiles.list()),
    }),
    execution:Object.freeze({
      executeTask:(task,opts)=>registry.executeTask(task,opts),
      executeTaskWithFallback:(task,opts)=>registry.executeTaskWithFallback(task,opts),
      createJevProviderExecutor:(opts)=>registry.createJevProviderExecutor(opts),
    }),
    subscribe:(listener)=>registry.subscribe(listener),
    registry,
    authority:Object.freeze({mutation:false,truth:false,precision:false,settlement:false,contextSeal:false,finalChoice:false}),
  });
}
