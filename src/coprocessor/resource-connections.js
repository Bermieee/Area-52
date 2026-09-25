import { Capability, FailureCode, TelemetryEvent } from './constants.js';
import { CapabilityProfileRegistry } from './capability-profiles.js';
import { ProviderHealthModel } from './provider-health.js';
import {
  DeterministicProviderAdapter, OpenAICompatibleProviderAdapter, ProviderAdapterRegistry, ProviderInvocationError,
} from './provider-adapters.js';
import { SpecialistExecutionLayer } from './provider-execution.js';
import { JevProviderExecutor } from './jev-decision-core.js';
import { emitTelemetry } from './telemetry.js';

export const RESOURCE_CONNECTION_VERSION='1.0.0';

export const ResourceConnectionState=Object.freeze({
  CONFIGURED:'CONFIGURED',
  CONNECTING:'CONNECTING',
  READY:'READY',
  DEGRADED:'DEGRADED',
  UNAVAILABLE:'UNAVAILABLE',
  DISCONNECTED:'DISCONNECTED',
});

export const ResourceKind=Object.freeze({
  DETERMINISTIC_LOCAL:'DETERMINISTIC_LOCAL',
  OPENAI_COMPATIBLE:'OPENAI_COMPATIBLE',
});

export const ResourceMeasurementClass=Object.freeze({
  MEASURED_LIVE:'MEASURED_LIVE',
  LOCAL_DETERMINISTIC:'LOCAL_DETERMINISTIC',
  SIMULATED:'SIMULATED',
});

export const ResourceConnectionReason=Object.freeze({
  CONFIGURED:'CONFIGURED',
  CONNECT_REQUESTED:'CONNECT_REQUESTED',
  HEALTH_CHECK_PASSED:'HEALTH_CHECK_PASSED',
  HEALTH_CHECK_FAILED:'HEALTH_CHECK_FAILED',
  OPERATOR_DISCONNECT:'OPERATOR_DISCONNECT',
  NOT_READY:'NOT_READY',
  CAPACITY_EXHAUSTED:'CAPACITY_EXHAUSTED',
  EXECUTION_SUCCEEDED:'EXECUTION_SUCCEEDED',
  EXECUTION_FAILED:'EXECUTION_FAILED',
  PROVIDER_TIMEOUT:'PROVIDER_TIMEOUT',
  PROVIDER_UNAVAILABLE:'PROVIDER_UNAVAILABLE',
  PROVIDER_ABORTED:'PROVIDER_ABORTED',
  MALFORMED_OUTPUT:'MALFORMED_OUTPUT',
  TEST_PASSED:'TEST_PASSED',
  TEST_FAILED:'TEST_FAILED',
});

const RESOURCE_STATES=new Set(Object.values(ResourceConnectionState));
const RESOURCE_KINDS=new Set(Object.values(ResourceKind));
const MEASUREMENT_CLASSES=new Set(Object.values(ResourceMeasurementClass));
const KNOWN_CAPABILITIES=new Set(Object.values(Capability));

export class CoprocessorResourceConnections{
  constructor({
    profiles=null,adapters=null,health=null,telemetry=null,fetchImpl=globalThis.fetch,now=()=>Date.now(),
    maxResources=16,diagnosticLimit=64,
  }={}){
    this.profiles=profiles??new CapabilityProfileRegistry();
    this.adapters=adapters??new ProviderAdapterRegistry();
    this.health=health??new ProviderHealthModel({telemetry});
    this.telemetry=telemetry;
    this.fetchImpl=fetchImpl;
    this.now=now;
    this.maxResources=Math.max(1,Number(maxResources)||16);
    this.diagnosticLimit=Math.max(8,Number(diagnosticLimit)||64);
    this.resources=new Map();
    this.privateConfig=new Map();
    this.controllers=new Map();
    this.subscribers=new Set();
    this.sequence=0;
    this.executionLayer=new SpecialistExecutionLayer({profiles:this.profiles,adapters:this.adapters,telemetry:this.telemetry});
  }

  addResource(input={}){
    if(this.resources.size>=this.maxResources)throw new RangeError('resource connection limit reached');
    const resourceId=req(input.resourceId,'resourceId');
    if(this.resources.has(resourceId))throw new Error('resource already configured: '+resourceId);
    const kind=input.kind??ResourceKind.OPENAI_COMPATIBLE;
    if(!RESOURCE_KINDS.has(kind))throw new TypeError('unsupported resource kind: '+kind);
    const capabilities=normalizeCapabilities(input.capabilities);
    const providerProfileId=req(input.providerProfileId??('profile:'+resourceId),'providerProfileId');
    const providerId=req(input.providerId??('provider:'+resourceId),'providerId');
    const modelId=req(input.modelId??(kind===ResourceKind.DETERMINISTIC_LOCAL?'local-deterministic':'model'),'modelId');
    const workerId=req(input.workerId??('resource:'+resourceId),'workerId');
    const maxConcurrency=positiveInt(input.maxConcurrency??input.concurrencyCapacity??1,'maxConcurrency');
    const measurementClass=normalizeMeasurementClass(input.measurementClass??(kind===ResourceKind.DETERMINISTIC_LOCAL?ResourceMeasurementClass.LOCAL_DETERMINISTIC:ResourceMeasurementClass.MEASURED_LIVE));
    if(measurementClass===ResourceMeasurementClass.SIMULATED)throw new TypeError('SIMULATED resources cannot be connected as execution resources');

    const adapter=input.adapter??createAdapter(kind,{
      ...input,providerId,modelId,capabilities,measurementClass,fetchImpl:this.fetchImpl,
    });
    if(typeof adapter?.invoke!=='function')throw new TypeError('resource adapter requires invoke()');
    if(typeof adapter?.probe!=='function')throw new TypeError('resource adapter requires probe() so READY corresponds to a callable resource');
    if(adapter.providerId!==providerId)throw new TypeError('adapter.providerId must match configured providerId');
    const adapterCapabilities=new Set(adapter.capabilities??[]);
    for(const capability of capabilities)if(!adapterCapabilities.has(capability))throw new TypeError('adapter does not advertise configured capability: '+capability);

    this.adapters.register(adapter);
    this.profiles.register({
      profileId:providerProfileId,workerId,providerId,modelId,capabilities,
      capabilityVersions:input.capabilityVersions??{},capabilityQuality:input.capabilityQuality??{},
      resourceProfile:input.resourceProfile??{CPU:1},resourceClass:input.resourceClass??'STANDARD',
      supportedLayers:input.supportedLayers??['L0','L1','L2','L3','L4'],placements:input.placements??['HOT','DEEP'],
      latencyClass:input.latencyClass??'MEDIUM',reliability:Number(input.reliability??1),
      structuredOutputSupport:input.structuredOutputSupport??true,streamingSupport:Boolean(input.streamingSupport),
      abortSupport:input.abortSupport!==false,maxContextTokens:Number(input.maxContextTokens??input.contextLimit??Number.MAX_SAFE_INTEGER),
      maxOutputTokens:Number(input.maxOutputTokens??input.outputLimit??Number.MAX_SAFE_INTEGER),local:Boolean(input.local??kind===ResourceKind.DETERMINISTIC_LOCAL),
      costMetadata:input.costMetadata??{},estimatedCostClass:input.estimatedCostClass??input.costClass??'MEDIUM',
      maxConcurrency,currentLoad:0,health:'UNAVAILABLE',availability:'UNAVAILABLE',available:false,
      foregroundEligible:input.foregroundEligible!==false,backgroundEligible:input.backgroundEligible!==false,
      profileMetadata:{...(input.profileMetadata??{}),resourceId,connectionManaged:true,measurementClass},
    });
    this.health.register(providerProfileId,{maxConcurrency,manualDisabled:true});
    const at=this.now();
    const row={
      resourceId,kind,displayName:String(input.displayName??resourceId),providerProfileId,providerId,modelId,workerId,
      declaredCapabilities:capabilities,measurementClass,maxConcurrency,activeExecutions:0,state:ResourceConnectionState.CONFIGURED,
      reasonCode:ResourceConnectionReason.CONFIGURED,reason:'Resource configured but not connected.',configuredAt:at,connectedAt:null,disconnectedAt:null,
      lastHealthCheckAt:null,lastHealthLatencyMs:null,lastHealthResult:null,lastTest:null,lastExecution:null,lastFailure:null,
      endpoint:safeEndpoint(input.endpoint),credentialConfigured:Boolean(input.apiKey),local:Boolean(input.local??kind===ResourceKind.DETERMINISTIC_LOCAL),
      diagnostics:[],
    };
    this.resources.set(resourceId,row);
    this.privateConfig.set(resourceId,sanitizePrivateConfig(input));
    this.#diagnostic(row,'CONFIGURED','Resource configuration accepted.');
    emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_CONFIGURED,this.#telemetryRow(row));
    this.#notify('RESOURCE_CONFIGURED',row);
    return this.readResource(resourceId);
  }

  async connectResource(resourceId,{signal=null}={}){
    const row=this.#row(resourceId);
    if([ResourceConnectionState.READY,ResourceConnectionState.DEGRADED].includes(row.state))return this.readResource(resourceId);
    row.state=ResourceConnectionState.CONNECTING;row.reasonCode=ResourceConnectionReason.CONNECT_REQUESTED;row.reason='Health probe in progress.';
    row.lastFailure=null;this.profiles.setAvailability(row.providerProfileId,false);this.profiles.setHealth(row.providerProfileId,'PROBE');
    this.health.setManualDisabled(row.providerProfileId,false,{now:this.now()});this.health.beginProbe(row.providerProfileId,{now:this.now()});
    this.#diagnostic(row,'CONNECTING','Connection health probe started.');
    emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_CONNECTING,this.#telemetryRow(row));this.#notify('RESOURCE_CONNECTING',row);
    const started=this.now();
    try{
      const adapter=this.adapters.get(row.providerId);const probe=await adapter.probe({signal,timeoutMs:this.privateConfig.get(row.resourceId)?.healthTimeoutMs});
      row.lastHealthCheckAt=this.now();row.lastHealthLatencyMs=finiteOrNull(probe?.latencyMs??(this.now()-started));row.lastHealthResult='PASS';
      row.connectedAt=this.now();row.disconnectedAt=null;row.state=probe?.degraded?ResourceConnectionState.DEGRADED:ResourceConnectionState.READY;
      row.reasonCode=ResourceConnectionReason.HEALTH_CHECK_PASSED;row.reason=probe?.degraded?'Health probe passed in degraded mode.':'Health probe passed.';
      this.profiles.setAvailability(row.providerProfileId,true);this.profiles.setHealth(row.providerProfileId,probe?.degraded?'DEGRADED':'HEALTHY');
      this.health.completeProbe(row.providerProfileId,{success:true,now:this.now()});
      this.#diagnostic(row,'HEALTH_CHECK_PASSED',row.reason,{latencyMs:row.lastHealthLatencyMs,modelAvailable:probe?.modelAvailable??null});
      emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_READY,this.#telemetryRow(row));this.#notify('RESOURCE_READY',row);return this.readResource(resourceId);
    }catch(error){
      row.lastHealthCheckAt=this.now();row.lastHealthLatencyMs=Math.max(0,this.now()-started);row.lastHealthResult='FAIL';row.state=ResourceConnectionState.UNAVAILABLE;
      row.reasonCode=reasonFromError(error);row.reason=safeMessage(error?.message??'Health probe failed.');row.lastFailure={code:error?.code??FailureCode.PROVIDER_UNAVAILABLE,message:row.reason,at:this.now()};
      this.profiles.setAvailability(row.providerProfileId,false);this.profiles.setHealth(row.providerProfileId,'UNAVAILABLE');this.health.markUnavailable(row.providerProfileId,{now:this.now()});
      this.#diagnostic(row,'HEALTH_CHECK_FAILED',row.reason,{code:row.lastFailure.code,latencyMs:row.lastHealthLatencyMs});
      emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_READY,{...this.#telemetryRow(row),ready:false});this.#notify('RESOURCE_UNAVAILABLE',row);return this.readResource(resourceId);
    }
  }

  disconnectResource(resourceId,{reason='Operator disconnected resource.'}={}){
    const row=this.#row(resourceId);
    for(const controller of this.controllers.get(resourceId)??[])if(!controller.signal.aborted)controller.abort('resource-disconnected');
    this.controllers.delete(resourceId);
    row.state=ResourceConnectionState.DISCONNECTED;row.reasonCode=ResourceConnectionReason.OPERATOR_DISCONNECT;row.reason=safeMessage(reason);row.disconnectedAt=this.now();
    row.activeExecutions=0;this.profiles.setLoad(row.providerProfileId,0);this.profiles.setAvailability(row.providerProfileId,false);this.profiles.setHealth(row.providerProfileId,'UNAVAILABLE');
    this.health.setManualDisabled(row.providerProfileId,true,{now:this.now()});
    this.#diagnostic(row,'DISCONNECTED',row.reason);emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_DISCONNECTED,this.#telemetryRow(row));this.#notify('RESOURCE_DISCONNECTED',row);
    return this.readResource(resourceId);
  }

  async testResource(resourceId,{mode='PROBE',task=null,input=null,signal=null}={}){
    const row=this.#row(resourceId);const started=this.now();let result;
    try{
      if(String(mode).toUpperCase()==='EXECUTION'){
        if(!task)throw new TypeError('execution test requires task');
        result=await this.executeTask(task,{input,profileId:row.providerProfileId,signal});
      }else{
        const adapter=this.adapters.get(row.providerId);const probe=await adapter.probe({signal,timeoutMs:this.privateConfig.get(row.resourceId)?.healthTimeoutMs});
        result={kind:'ResourceProbeResult',ok:true,latencyMs:finiteOrNull(probe?.latencyMs),modelAvailable:probe?.modelAvailable??null,measurementClass:row.measurementClass};
      }
      row.lastTest={status:'PASS',mode:String(mode).toUpperCase(),at:this.now(),latencyMs:Math.max(0,this.now()-started),failureCode:null};
      this.#diagnostic(row,'TEST_PASSED','Resource test passed.',{mode:row.lastTest.mode,latencyMs:row.lastTest.latencyMs});
      emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_TESTED,{...this.#telemetryRow(row),testStatus:'PASS',testMode:row.lastTest.mode,latencyMs:row.lastTest.latencyMs});
      this.#notify('RESOURCE_TESTED',row);return Object.freeze({resource:this.readResource(resourceId),result});
    }catch(error){
      row.lastTest={status:'FAIL',mode:String(mode).toUpperCase(),at:this.now(),latencyMs:Math.max(0,this.now()-started),failureCode:error?.code??FailureCode.PROVIDER_FAILURE};
      this.#observeFailure(row,error);this.#diagnostic(row,'TEST_FAILED',safeMessage(error?.message??'Resource test failed.'),{mode:row.lastTest.mode,code:row.lastTest.failureCode});
      emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_TESTED,{...this.#telemetryRow(row),testStatus:'FAIL',testMode:row.lastTest.mode,failureCode:row.lastTest.failureCode});
      this.#notify('RESOURCE_TESTED',row);return Object.freeze({resource:this.readResource(resourceId),result:null,failure:Object.freeze({code:row.lastTest.failureCode,message:safeMessage(error?.message??String(error))})});
    }
  }

  async executeTask(task,{input={},profileId=null,signal=null,attempt=1,maxCostClass='HIGH'}={}){
    const eligible=this.profiles.eligibleProfiles(task,{contextTokens:0,maxCostClass,requireStructuredOutput:true,expectedOutputTokens:Number(task?.metadata?.expectedOutputTokens??0)})
      .filter(profile=>this.adapters.get(profile.providerId)&&this.#resourceByProfile(profile.profileId)&&this.#isExecutable(this.#resourceByProfile(profile.profileId)));
    const profile=profileId==null?eligible[0]:eligible.find(x=>x.profileId===profileId);
    if(!profile)throw new ProviderInvocationError(FailureCode.CAPABILITY_UNAVAILABLE,'No connected resource satisfies task capabilities',{providerId:null});
    const row=this.#resourceByProfile(profile.profileId);
    if(row.activeExecutions>=row.maxConcurrency)throw new ProviderInvocationError(FailureCode.CAPABILITY_UNAVAILABLE,'Resource capacity exhausted',{providerId:row.providerId});
    const controller=new AbortController();const detach=linkAbort(signal,controller);const set=this.controllers.get(row.resourceId)??new Set();set.add(controller);this.controllers.set(row.resourceId,set);
    row.activeExecutions+=1;this.profiles.setLoad(row.providerProfileId,row.activeExecutions);this.health.setConcurrency(row.providerProfileId,row.activeExecutions,{now:this.now()});
    const started=this.now();
    try{
      const result=await this.executionLayer.execute(task,{input,attempt,signal:controller.signal,maxCostClass,profileId:row.providerProfileId});
      const latency=Math.max(0,this.now()-started);row.lastExecution={status:'SUCCESS',taskId:task.taskId,taskType:task.taskType,at:this.now(),latencyMs:latency,providerId:result.providerId,workerId:result.workerId,measurementClass:row.measurementClass};
      this.health.observe(row.providerProfileId,{outcome:'SUCCESS',activeConcurrency:Math.max(0,row.activeExecutions-1),latencyMs:latency,now:this.now()});
      if(row.state===ResourceConnectionState.DEGRADED&&this.health.snapshot(row.providerProfileId).health==='HEALTHY'){row.state=ResourceConnectionState.READY;row.reasonCode=ResourceConnectionReason.EXECUTION_SUCCEEDED;row.reason='Execution succeeded and health recovered.';}
      emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_EXECUTION,{...this.#telemetryRow(row),taskId:task.taskId,taskType:task.taskType,status:'SUCCESS',latencyMs:latency,workerId:result.workerId,providerId:result.providerId});
      return result;
    }catch(error){
      row.lastExecution={status:'FAIL',taskId:task.taskId,taskType:task.taskType,at:this.now(),latencyMs:Math.max(0,this.now()-started),providerId:row.providerId,workerId:row.workerId,measurementClass:row.measurementClass,failureCode:error?.code??FailureCode.PROVIDER_FAILURE};
      this.#observeFailure(row,error);emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_EXECUTION,{...this.#telemetryRow(row),taskId:task.taskId,taskType:task.taskType,status:'FAIL',failureCode:row.lastExecution.failureCode,latencyMs:row.lastExecution.latencyMs});
      throw error;
    }finally{
      detach();set.delete(controller);if(!set.size)this.controllers.delete(row.resourceId);row.activeExecutions=Math.max(0,row.activeExecutions-1);
      this.profiles.setLoad(row.providerProfileId,row.activeExecutions);this.health.setConcurrency(row.providerProfileId,row.activeExecutions,{now:this.now()});
      this.#notify('RESOURCE_EXECUTION',row);
    }
  }

  async executeTaskWithFallback(task,{input={},signal=null,attempt=1,maxCostClass='HIGH',maxProviders=2}={}){
    const eligible=this.profiles.eligibleProfiles(task,{contextTokens:0,maxCostClass,requireStructuredOutput:true,expectedOutputTokens:Number(task?.metadata?.expectedOutputTokens??0)})
      .filter(profile=>this.adapters.get(profile.providerId)&&this.#resourceByProfile(profile.profileId)&&this.#isExecutable(this.#resourceByProfile(profile.profileId)))
      .slice(0,Math.max(1,Number(maxProviders)||1));
    const attempts=[];let lastError=null;
    for(let index=0;index<eligible.length;index+=1){
      const profile=eligible[index];
      try{
        const result=await this.executeTask(task,{input,profileId:profile.profileId,signal,attempt:attempt+index,maxCostClass});
        attempts.push(Object.freeze({profileId:profile.profileId,providerId:profile.providerId,status:'SUCCESS',failureCode:null}));
        return Object.freeze({kind:'ConnectedResourceFallbackExecution',status:index?'FALLBACK':'SUCCESS',result,attempts:Object.freeze(attempts),authority:'NONE'});
      }catch(error){
        lastError=error;attempts.push(Object.freeze({profileId:profile.profileId,providerId:profile.providerId,status:'FAIL',failureCode:error?.code??FailureCode.PROVIDER_FAILURE}));
      }
    }
    return Object.freeze({kind:'ConnectedResourceFallbackExecution',status:'FAILED',result:null,attempts:Object.freeze(attempts),failure:Object.freeze({code:lastError?.code??FailureCode.CAPABILITY_UNAVAILABLE,message:safeMessage(lastError?.message??'No connected provider succeeded.')}),authority:'NONE'});
  }

  createJevProviderExecutor(options={}){
    return new JevProviderExecutor({profiles:this.profiles,adapters:this.adapters,...options});
  }

  listResources(){
    return Object.freeze([...this.resources.keys()].sort().map(id=>this.readResource(id)));
  }

  readResource(resourceId){
    const row=this.#row(resourceId);const profile=this.profiles.get(row.providerProfileId);const health=this.health.snapshot(row.providerProfileId);
    return deepFreeze({
      kind:'CoprocessorResourceReadModel',contractVersion:RESOURCE_CONNECTION_VERSION,resourceId:row.resourceId,displayName:row.displayName,kind:row.kind,
      state:row.state,reasonCode:row.reasonCode,reason:row.reason,providerProfileId:row.providerProfileId,providerId:row.providerId,modelId:row.modelId,workerId:row.workerId,
      declaredCapabilities:[...row.declaredCapabilities],activeCapabilities:this.#isExecutable(row)?[...row.declaredCapabilities]:[],
      measurementClass:row.measurementClass,configuredAt:row.configuredAt,connectedAt:row.connectedAt,disconnectedAt:row.disconnectedAt,
      lastHealthCheckAt:row.lastHealthCheckAt,lastHealthLatencyMs:row.lastHealthLatencyMs,lastHealthResult:row.lastHealthResult,
      endpoint:row.endpoint,credentialConfigured:row.credentialConfigured,local:row.local,maxConcurrency:row.maxConcurrency,activeExecutions:row.activeExecutions,
      health:health.health,availability:profile?.availability??'UNAVAILABLE',currentLoad:profile?.currentLoad??row.activeExecutions,
      lastTest:clone(row.lastTest),lastExecution:clone(row.lastExecution),lastFailure:clone(row.lastFailure),diagnostics:deepFreeze(row.diagnostics.map(clone)),
      callable:Boolean(this.adapters.get(row.providerId)&&this.#isExecutable(row)),authority:'NONE',truthAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    });
  }

  readModel(){
    const resources=this.listResources();const counts=Object.fromEntries(Object.values(ResourceConnectionState).map(x=>[x,0]));for(const row of resources)counts[row.state]+=1;
    const capabilities=[...new Set(resources.flatMap(x=>x.activeCapabilities))].sort();
    return deepFreeze({
      kind:'CoprocessorResourceConnectionReadModel',contractVersion:RESOURCE_CONNECTION_VERSION,sequence:this.sequence,resources,counts:deepFreeze(counts),
      activeCapabilities:capabilities,hasOptionalResources:resources.length>0,readyResourceCount:resources.filter(x=>[ResourceConnectionState.READY,ResourceConnectionState.DEGRADED].includes(x.state)).length,
      nativePathRequired:resources.every(x=>![ResourceConnectionState.READY,ResourceConnectionState.DEGRADED].includes(x.state)),
      mutationAuthority:false,truthAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    });
  }

  subscribe(listener){
    if(typeof listener!=='function')throw new TypeError('listener must be a function');this.subscribers.add(listener);return()=>this.subscribers.delete(listener);
  }

  #observeFailure(row,error){
    const code=error?.code??FailureCode.PROVIDER_FAILURE;const timeout=code===FailureCode.PROVIDER_TIMEOUT,transport=[FailureCode.PROVIDER_UNAVAILABLE,FailureCode.PROVIDER_FAILURE].includes(code),validation=[FailureCode.MALFORMED_OUTPUT,FailureCode.SCHEMA_INVALID,FailureCode.SCHEMA_VALIDATION_FAILED,FailureCode.SEMANTIC_VALIDATION_FAILED].includes(code);
    const snapshot=this.health.observe(row.providerProfileId,{outcome:'FAIL',timeout,transportFailure:transport,validationFailure:validation,activeConcurrency:Math.max(0,row.activeExecutions-1),latencyMs:row.lastExecution?.latencyMs??row.lastTest?.latencyMs??null,now:this.now()});
    row.lastFailure={code,message:safeMessage(error?.message??String(error)),at:this.now()};
    if(row.state!==ResourceConnectionState.DISCONNECTED){
      if(['UNAVAILABLE','COOLDOWN'].includes(snapshot.health)){row.state=ResourceConnectionState.UNAVAILABLE;this.profiles.setAvailability(row.providerProfileId,false);this.profiles.setHealth(row.providerProfileId,'UNAVAILABLE');}
      else{row.state=ResourceConnectionState.DEGRADED;this.profiles.setAvailability(row.providerProfileId,true);this.profiles.setHealth(row.providerProfileId,'DEGRADED');}
      row.reasonCode=reasonFromError(error);row.reason=row.lastFailure.message;
    }
    this.#diagnostic(row,'EXECUTION_FAILED',row.lastFailure.message,{code});
  }

  #resourceByProfile(profileId){for(const row of this.resources.values())if(row.providerProfileId===profileId)return row;return null;}
  #isExecutable(row){return Boolean(row&&[ResourceConnectionState.READY,ResourceConnectionState.DEGRADED].includes(row.state));}
  #row(resourceId){const row=this.resources.get(String(resourceId));if(!row)throw new Error('Unknown resource: '+resourceId);return row;}
  #diagnostic(row,code,message,details={}){
    row.diagnostics.push({sequence:++this.sequence,at:this.now(),code:String(code),message:safeMessage(message),details:safeDetails(details)});if(row.diagnostics.length>this.diagnosticLimit)row.diagnostics.splice(0,row.diagnostics.length-this.diagnosticLimit);
  }
  #telemetryRow(row){return{resourceId:row.resourceId,providerProfileId:row.providerProfileId,providerId:row.providerId,modelId:row.modelId,state:row.state,reasonCode:row.reasonCode,measurementClass:row.measurementClass,capabilities:[...row.declaredCapabilities],activeExecutions:row.activeExecutions,maxConcurrency:row.maxConcurrency,local:row.local};}
  #notify(type,row){const event=deepFreeze({kind:'CoprocessorResourceConnectionEvent',sequence:++this.sequence,type,resource:this.readResource(row.resourceId)});for(const listener of this.subscribers){try{listener(event);}catch{}}}
}

function createAdapter(kind,input){
  if(kind===ResourceKind.DETERMINISTIC_LOCAL)return new DeterministicProviderAdapter({
    providerId:input.providerId,modelId:input.modelId,capabilities:input.capabilities,handler:input.handler,handlers:input.handlers??{},measurementClass:input.measurementClass,
  });
  return new OpenAICompatibleProviderAdapter({
    providerId:input.providerId,modelId:input.modelId,endpoint:req(input.endpoint,'endpoint'),apiKey:input.apiKey??null,headers:input.headers??{},fetchImpl:input.fetchImpl,
    timeoutMs:input.timeoutMs??30000,contextLimit:input.contextLimit??input.maxContextTokens??null,outputLimit:input.outputLimit??input.maxOutputTokens??null,
    capabilities:input.capabilities,local:Boolean(input.local),costMetadata:input.costMetadata??null,healthCheckPath:input.healthCheckPath??'/models',measurementClass:input.measurementClass,
  });
}

function sanitizePrivateConfig(input){return{healthTimeoutMs:Math.max(1,Number(input.healthTimeoutMs??input.timeoutMs??10000)||10000),hasCredential:Boolean(input.apiKey)};}
function normalizeCapabilities(values){
  if(!Array.isArray(values)||!values.length)throw new TypeError('capabilities must be a non-empty array');const out=[...new Set(values.map(String))].sort();
  for(const capability of out)if(!KNOWN_CAPABILITIES.has(capability))throw new TypeError('unknown capability: '+capability);return Object.freeze(out);
}
function normalizeMeasurementClass(value){const v=String(value);if(!MEASUREMENT_CLASSES.has(v))throw new TypeError('unsupported measurement class: '+v);return v;}
function reasonFromError(error){const code=error?.code;return code===FailureCode.PROVIDER_TIMEOUT?ResourceConnectionReason.PROVIDER_TIMEOUT:code===FailureCode.PROVIDER_ABORTED?ResourceConnectionReason.PROVIDER_ABORTED:code===FailureCode.MALFORMED_OUTPUT||code===FailureCode.SCHEMA_INVALID||code===FailureCode.SCHEMA_VALIDATION_FAILED||code===FailureCode.SEMANTIC_VALIDATION_FAILED?ResourceConnectionReason.MALFORMED_OUTPUT:code===FailureCode.PROVIDER_UNAVAILABLE||code===FailureCode.CAPABILITY_UNAVAILABLE?ResourceConnectionReason.PROVIDER_UNAVAILABLE:ResourceConnectionReason.EXECUTION_FAILED;}
function safeEndpoint(value){
  if(value==null)return null;try{const url=new URL(String(value));return url.protocol+'//'+url.host+url.pathname.replace(/\/+$/,'');}catch{return String(value).replace(/[?#].*$/,'').slice(0,512);}
}
function safeMessage(value){return String(value??'').replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED]').replace(/api[_-]?key\s*[:=]\s*[^\s,;]+/gi,'apiKey=[REDACTED]').slice(0,600);}
function safeDetails(value){const out={};for(const[k,v]of Object.entries(value??{}).slice(0,16)){if(/key|token|secret|prompt|response|payload|message/i.test(k))continue;if(v==null||typeof v==='number'||typeof v==='boolean')out[k]=v;else if(typeof v==='string')out[k]=v.slice(0,240);}return Object.freeze(out);}
function linkAbort(signal,controller){if(!signal)return()=>{};const abort=()=>controller.abort(signal.reason??'caller-abort');if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});return()=>signal.removeEventListener?.('abort',abort);}
function req(value,name){if(typeof value!=='string'||!value.trim())throw new TypeError(name+' must be a non-empty string');return value.trim();}
function positiveInt(value,name){const n=Number(value);if(!Number.isInteger(n)||n<1)throw new TypeError(name+' must be a positive integer');return n;}
function finiteOrNull(value){if(value==null)return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function clone(value){return value==null?value:structuredClone(value);}
function deepFreeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);return value;}
