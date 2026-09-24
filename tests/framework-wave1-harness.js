import {FrameworkKernel} from '../src/framework-kernel.js';
import {AuthorityPermission,SubsystemLifecycle} from '../src/framework-contracts.js';

export function createEconomyFramework({isCurrentRevision=()=>true}={}){
  const framework=new FrameworkKernel({isCurrentRevision});
  framework.registerSubsystem({
    manifest:{
      subsystemId:'test-world-economy',version:'0.1.0',owner:'TESTS',lifecycleState:SubsystemLifecycle.EXPERIMENTAL,
      producedArtifactTypes:['EconomySignal'],producedEvents:['ECONOMY_SIGNAL_READY'],providedCapabilities:['economy.observe'],
      optionalCapabilities:['market.oracle'],optionalDependencies:['optional-market-oracle'],
      authorityPermissions:[AuthorityPermission.EMIT_EVALUATION,AuthorityPermission.READ_LIVE_EVIDENCE],
      repositoryRequirements:['artifacts'],evaluationRequirements:[
        {id:'truth',mandatory:true,category:'truth'},
        {id:'history',mandatory:true,category:'history'},
        {id:'provenance',mandatory:true,category:'provenance'},
        {id:'stale-revision',mandatory:true,category:'stale-revision'},
        {id:'authority',mandatory:true,category:'authority'},
        {id:'recovery',mandatory:true,category:'recovery'},
        {id:'latency-resource',mandatory:true,category:'latency-resource'},
      ],failureBehavior:{recovery:'REBUILD_FROM_EVIDENCE',diagnostics:true},diagnostics:{snapshot:'available'},
    },
    artifactTypes:[{artifactType:'EconomySignal',owner:'test-world-economy',schemaVersion:'1.0.0',validatePayload:p=>Boolean(p&&typeof p.index==='number')}],
    eventTypes:[{eventType:'ECONOMY_SIGNAL_READY',owner:'test-world-economy',eventVersion:'1.0.0',validatePayload:p=>Boolean(p&&p.artifactId)}],
  });
  return framework;
}

export function economyArtifact({id='economy:1',schemaVersion='1.0.0',authority='INFERRED'}={}){
  return{artifactId:id,artifactType:'EconomySignal',schemaVersion,owner:'test-world-economy',authority,provenance:{sourceRevisionIds:['world@1'],activity:'TEST'},revision:1,dependencies:['world@1'],invalidators:['world@1'],status:'VALID',payload:{index:42}};
}
export function economyEvent({id='event:economy:1',eventVersion='1.0.0'}={}){
  return{eventId:id,eventType:'ECONOMY_SIGNAL_READY',eventVersion,producer:'test-world-economy',correlationId:'corr:1',sourceRevisionSet:['world@1'],worldRevision:1,sceneRevision:1,sequence:1,time:1,dedupeIdentity:id,payload:{artifactId:'economy:1'},payloadSchemaVersion:'1.0.0'};
}

export function runFrameworkWave1GoldenWorld(){
  const framework=createEconomyFramework();
  const registered=framework.services.inspect('test-world-economy');
  framework.services.transition('test-world-economy',SubsystemLifecycle.SHADOW);
  const routed=framework.services.routeResult('test-world-economy',{destination:'FOREGROUND'});
  for(const testId of ['truth','history','provenance','stale-revision','authority','recovery','latency-resource'])
    framework.certification.record('test-world-economy',{testId,pass:true,evidence:'golden-world'});
  const active=framework.services.transition('test-world-economy',SubsystemLifecycle.ACTIVE,{operatorApproved:true});
  const directMutation=framework.services.authorize('test-world-economy','DIRECT_CANONICAL_MUTATION');
  const directPrompt=framework.services.authorize('test-world-economy','DIRECT_PROMPT_INJECTION');
  const deprecated=framework.services.transition('test-world-economy',SubsystemLifecycle.DEPRECATED);
  const metrics={
    unknownServiceRegistered:Boolean(registered),artifactRegistered:framework.artifacts.has('EconomySignal'),eventRegistered:framework.events.has('ECONOMY_SIGNAL_READY'),
    optionalDependencyDegraded:registered.dependencies.degraded===true&&registered.dependencies.missingOptional.includes('optional-market-oracle'),
    shadowEvaluationOnly:routed.destination==='EVALUATION'&&!routed.canonicalMutationAllowed&&!routed.foregroundAllowed,
    activeAfterCertification:active.manifest.lifecycleState===SubsystemLifecycle.ACTIVE,
    settlementFence:directMutation.allowed===false&&directMutation.requiresSettlement===true,
    contextSealFence:directPrompt.allowed===false&&directPrompt.requiresContextSeal===true,
    deprecated:deprecated.manifest.lifecycleState===SubsystemLifecycle.DEPRECATED,
  };
  return{pass:Object.values(metrics).every(Boolean),metrics};
}
