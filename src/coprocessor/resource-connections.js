import { Capability, FailureCode, TelemetryEvent } from './constants.js';
import { CapabilityProfileRegistry } from './capability-profiles.js';
import { ProviderHealthModel } from './provider-health.js';
import {
  DeterministicProviderAdapter, OpenAICompatibleProviderAdapter, ProviderAdapterRegistry, ProviderInvocationError,
  ProviderTransportMode, ProviderModelDiscoveryState,
} from './provider-adapters.js';
import { SpecialistExecutionLayer } from './provider-execution.js';
import { JevProviderExecutor, createJevCognitiveTask, createJevProviderInput } from './jev-decision-core.js';
import { emitTelemetry } from './telemetry.js';
import { normalizeProviderUsageReceipt } from './usage-receipt.js';

export const RESOURCE_CONNECTION_VERSION='1.2.0';

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

export const ResourceModelDiscoveryState=Object.freeze({
  IDLE:'IDLE',
  LOADING:'LOADING',
  READY:'READY',
  EMPTY:'EMPTY',
  UNSUPPORTED:'UNSUPPORTED',
  UNAUTHORIZED:'UNAUTHORIZED',
  UNREACHABLE:'UNREACHABLE',
  FAILED:'FAILED',
});

export const ResourceCredentialStorage=Object.freeze({
  SESSION_MEMORY_ONLY:'SESSION_MEMORY_ONLY',
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
  CREDENTIAL_REQUIRED:'CREDENTIAL_REQUIRED',
  CREDENTIAL_UPDATED:'CREDENTIAL_UPDATED',
  CREDENTIAL_REVOKED:'CREDENTIAL_REVOKED',
  MODEL_DISCOVERY_LOADING:'MODEL_DISCOVERY_LOADING',
  MODEL_DISCOVERY_READY:'MODEL_DISCOVERY_READY',
  MODEL_DISCOVERY_EMPTY:'MODEL_DISCOVERY_EMPTY',
  MODEL_DISCOVERY_UNSUPPORTED:'MODEL_DISCOVERY_UNSUPPORTED',
  MODEL_DISCOVERY_UNAUTHORIZED:'MODEL_DISCOVERY_UNAUTHORIZED',
  MODEL_DISCOVERY_UNREACHABLE:'MODEL_DISCOVERY_UNREACHABLE',
  MODEL_DISCOVERY_FAILED:'MODEL_DISCOVERY_FAILED',
  MODEL_SELECTED:'MODEL_SELECTED',
  MODEL_UNAVAILABLE:'MODEL_UNAVAILABLE',
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
    const declaredCapabilities=normalizeCapabilities(input.capabilities);
    const endpoint=kind===ResourceKind.OPENAI_COMPATIBLE?validatedEndpoint(input.endpoint):null;
    const identity=classifyProviderIdentity(endpoint,kind);
    const transportMode=normalizeTransportMode(input.transportMode,declaredCapabilities,kind);
    const routableCapabilities=qualifiedTransportCapabilities(declaredCapabilities,transportMode,kind);
    const providerProfileId=req(input.providerProfileId??('profile:'+resourceId),'providerProfileId');
    const providerId=req(input.providerId??('provider:'+resourceId),'providerId');
    const modelId=req(input.modelId??(kind===ResourceKind.DETERMINISTIC_LOCAL?'local-deterministic':'model'),'modelId');
    const workerId=req(input.workerId??('resource:'+resourceId),'workerId');
    const maxConcurrency=positiveInt(input.maxConcurrency??input.concurrencyCapacity??1,'maxConcurrency');
    const measurementClass=normalizeMeasurementClass(input.measurementClass??(kind===ResourceKind.DETERMINISTIC_LOCAL?ResourceMeasurementClass.LOCAL_DETERMINISTIC:ResourceMeasurementClass.MEASURED_LIVE));
    if(measurementClass===ResourceMeasurementClass.SIMULATED)throw new TypeError('SIMULATED resources cannot be connected as execution resources');
    const local=kind===ResourceKind.DETERMINISTIC_LOCAL?true:isLocalEndpoint(endpoint);
    const credentialRequired=kind===ResourceKind.OPENAI_COMPATIBLE&&Boolean(input.credentialRequired??identity.family==='OPENROUTER');

    const adapter=input.adapter??createAdapter(kind,{
      ...input,endpoint,providerId,modelId,capabilities:routableCapabilities,measurementClass,fetchImpl:this.fetchImpl,local,transportMode,
    });
    if(typeof adapter?.invoke!=='function')throw new TypeError('resource adapter requires invoke()');
    if(typeof adapter?.probe!=='function')throw new TypeError('resource adapter requires probe() so READY corresponds to a callable resource');
    if(adapter.providerId!==providerId)throw new TypeError('adapter.providerId must match configured providerId');
    const adapterCapabilities=new Set(adapter.capabilities??[]);
    for(const capability of routableCapabilities)if(!adapterCapabilities.has(capability))throw new TypeError('adapter does not advertise configured capability: '+capability);

    this.adapters.register(adapter);
    this.profiles.register({
      profileId:providerProfileId,workerId,providerId,modelId,capabilities:routableCapabilities,
      capabilityVersions:input.capabilityVersions??{},capabilityQuality:input.capabilityQuality??{},
      resourceProfile:input.resourceProfile??{CPU:1},resourceClass:input.resourceClass??'STANDARD',
      supportedLayers:input.supportedLayers??['L0','L1','L2','L3','L4'],placements:input.placements??['HOT','DEEP'],
      latencyClass:input.latencyClass??'MEDIUM',reliability:Number(input.reliability??1),
      structuredOutputSupport:transportMode===ProviderTransportMode.EMBEDDINGS?false:(input.structuredOutputSupport??true),streamingSupport:Boolean(input.streamingSupport),
      abortSupport:input.abortSupport!==false,maxContextTokens:Number(input.maxContextTokens??input.contextLimit??Number.MAX_SAFE_INTEGER),
      maxOutputTokens:Number(input.maxOutputTokens??input.outputLimit??Number.MAX_SAFE_INTEGER),local,
      costMetadata:input.costMetadata??{},estimatedCostClass:input.estimatedCostClass??input.costClass??'MEDIUM',
      maxConcurrency,currentLoad:0,health:'UNAVAILABLE',availability:'UNAVAILABLE',available:false,
      foregroundEligible:input.foregroundEligible!==false,backgroundEligible:input.backgroundEligible!==false,
      profileMetadata:{...(input.profileMetadata??{}),resourceId,connectionManaged:true,measurementClass,transportMode,providerFamily:identity.family},
    });
    this.health.register(providerProfileId,{maxConcurrency,manualDisabled:true});
    const at=this.now();
    const row={
      resourceId,kind,displayName:String(input.displayName??resourceId),providerProfileId,providerId,modelId,workerId,
      declaredCapabilities:declaredCapabilities,routableCapabilities,transportMode,providerIdentity:identity,measurementClass,maxConcurrency,activeExecutions:0,state:ResourceConnectionState.CONFIGURED,
      reasonCode:ResourceConnectionReason.CONFIGURED,reason:'Resource configured but not connected.',configuredAt:at,connectedAt:null,disconnectedAt:null,
      lastHealthCheckAt:null,lastHealthLatencyMs:null,lastHealthResult:null,lastTest:null,lastExecution:null,lastFailure:null,
      endpoint:safeEndpoint(endpoint),credentialConfigured:Boolean(input.apiKey),credentialRequired,credentialStorage:ResourceCredentialStorage.SESSION_MEMORY_ONLY,credentialVersion:Boolean(input.apiKey)?1:0,
      local,selectedModelQualified:kind===ResourceKind.DETERMINISTIC_LOCAL,qualifiedAt:kind===ResourceKind.DETERMINISTIC_LOCAL?at:null,actualModelId:kind===ResourceKind.DETERMINISTIC_LOCAL?modelId:null,actualProvider:null,
      modelSelectionMode:kind===ResourceKind.DETERMINISTIC_LOCAL?'LOCAL_DETERMINISTIC':'LEGACY_UNVERIFIED',
      modelDiscovery:createDiscoveryReadModel(ResourceModelDiscoveryState.IDLE,{transportMode}),
      diagnostics:[],
    };
    this.resources.set(resourceId,row);
    this.privateConfig.set(resourceId,sanitizePrivateConfig({...input,credentialRequired}));
    this.#diagnostic(row,'CONFIGURED','Resource configuration accepted.',{transportMode,providerFamily:identity.family,credentialRequired,local});
    emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_CONFIGURED,this.#telemetryRow(row));
    this.#notify('RESOURCE_CONFIGURED',row);
    return this.readResource(resourceId);
  }

  async discoverModels(input={}, {signal=null}={}){
    const kind=input.kind??ResourceKind.OPENAI_COMPATIBLE;
    if(kind!==ResourceKind.OPENAI_COMPATIBLE)return deepFreeze({kind:'ResourceModelDiscoveryResult',state:ResourceModelDiscoveryState.UNSUPPORTED,models:[],manualModelEntryAllowed:true,reasonCode:ResourceConnectionReason.MODEL_DISCOVERY_UNSUPPORTED,reason:'Deterministic local resources do not use remote model discovery.',credentialStorage:ResourceCredentialStorage.SESSION_MEMORY_ONLY});
    const endpoint=validatedEndpoint(input.endpoint);
    const identity=classifyProviderIdentity(endpoint,kind);
    const declared=normalizeCapabilities(input.capabilities?.length?input.capabilities:[Capability.SEMANTIC_JUDGMENT]);
    const transportMode=normalizeTransportMode(input.transportMode,declared,kind);
    const credentialRequired=Boolean(input.credentialRequired??identity.family==='OPENROUTER');
    if(credentialRequired&&!input.apiKey)return deepFreeze({
      kind:'ResourceModelDiscoveryResult',state:ResourceModelDiscoveryState.UNAUTHORIZED,models:[],manualModelEntryAllowed:false,
      reasonCode:ResourceConnectionReason.CREDENTIAL_REQUIRED,reason:'A session credential is required before model discovery.',endpoint:safeEndpoint(endpoint),
      providerIdentity:identity,transportMode,local:isLocalEndpoint(endpoint),credentialConfigured:false,credentialStorage:ResourceCredentialStorage.SESSION_MEMORY_ONLY,
    });
    const adapter=new OpenAICompatibleProviderAdapter({
      providerId:'discovery-probe',modelId:'__area52_discovery__',endpoint,apiKey:input.apiKey??null,headers:input.headers??{},fetchImpl:this.fetchImpl,
      timeoutMs:input.timeoutMs??10000,capabilities:qualifiedTransportCapabilities(declared,transportMode,kind),local:isLocalEndpoint(endpoint),
      healthCheckPath:input.healthCheckPath??'/models',modelListPath:input.modelListPath??(transportMode===ProviderTransportMode.EMBEDDINGS?'/embeddings/models':'/models'),
      measurementClass:input.measurementClass??ResourceMeasurementClass.MEASURED_LIVE,transportMode,
    });
    try{
      const discovery=await adapter.discoverModels({signal,timeoutMs:input.timeoutMs??10000});
      return deepFreeze(discoveryResultFromAdapter(discovery,{endpoint,identity,transportMode,credentialConfigured:Boolean(input.apiKey)}));
    }catch(error){
      return deepFreeze(discoveryFailure(error,{endpoint,identity,transportMode,credentialConfigured:Boolean(input.apiKey)}));
    }
  }

  async refreshResourceModels(resourceId,{signal=null}={}){
    const row=this.#row(resourceId);
    if(row.kind!==ResourceKind.OPENAI_COMPATIBLE){
      row.modelDiscovery=createDiscoveryReadModel(ResourceModelDiscoveryState.UNSUPPORTED,{transportMode:row.transportMode,reasonCode:ResourceConnectionReason.MODEL_DISCOVERY_UNSUPPORTED,reason:'Deterministic local resources do not use remote model discovery.',manualModelEntryAllowed:true});
      return clone(row.modelDiscovery);
    }
    if(row.credentialRequired&&!row.credentialConfigured){
      row.modelDiscovery=createDiscoveryReadModel(ResourceModelDiscoveryState.UNAUTHORIZED,{transportMode:row.transportMode,reasonCode:ResourceConnectionReason.CREDENTIAL_REQUIRED,reason:'A session credential is required before model discovery.',manualModelEntryAllowed:false});
      this.#diagnostic(row,'MODEL_DISCOVERY_UNAUTHORIZED',row.modelDiscovery.reason);
      emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_DISCOVERY,{...this.#telemetryRow(row),discoveryState:row.modelDiscovery.state});
      this.#notify('RESOURCE_DISCOVERY',row);return clone(row.modelDiscovery);
    }
    row.modelDiscovery=createDiscoveryReadModel(ResourceModelDiscoveryState.LOADING,{transportMode:row.transportMode,reasonCode:ResourceConnectionReason.MODEL_DISCOVERY_LOADING,reason:'Model discovery in progress.',manualModelEntryAllowed:false});
    this.#notify('RESOURCE_DISCOVERY',row);
    try{
      const adapter=this.adapters.get(row.providerId);const discovery=await adapter.discoverModels({signal,timeoutMs:this.privateConfig.get(row.resourceId)?.healthTimeoutMs});
      const result=discoveryResultFromAdapter(discovery,{endpoint:row.endpoint,identity:row.providerIdentity,transportMode:row.transportMode,credentialConfigured:row.credentialConfigured});
      row.modelDiscovery=createDiscoveryReadModel(result.state,{...result,models:result.models});
      this.#diagnostic(row,'MODEL_DISCOVERY_'+result.state,result.reason??'Model discovery completed.',{modelCount:result.models.length});
    }catch(error){
      const result=discoveryFailure(error,{endpoint:row.endpoint,identity:row.providerIdentity,transportMode:row.transportMode,credentialConfigured:row.credentialConfigured});
      row.modelDiscovery=createDiscoveryReadModel(result.state,result);
      this.#diagnostic(row,'MODEL_DISCOVERY_'+result.state,row.modelDiscovery.reason,{code:error?.code??FailureCode.PROVIDER_FAILURE});
    }
    emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_DISCOVERY,{...this.#telemetryRow(row),discoveryState:row.modelDiscovery.state,modelCount:row.modelDiscovery.models.length});
    this.#notify('RESOURCE_DISCOVERY',row);
    return clone(row.modelDiscovery);
  }

  setResourceCredential(resourceId,credential){
    const row=this.#row(resourceId);if(row.kind!==ResourceKind.OPENAI_COMPATIBLE)throw new TypeError('remote credential action requires an OpenAI-compatible resource');
    const value=typeof credential==='string'?credential:credential?.apiKey;
    if(typeof value!=='string'||!value.trim())throw new ProviderInvocationError(FailureCode.CREDENTIAL_REQUIRED,'credential must be a non-empty string',{providerId:row.providerId});
    const adapter=this.adapters.get(row.providerId);if(typeof adapter?.setCredential!=='function')throw new TypeError('resource adapter does not support session credentials');
    adapter.setCredential(value);row.credentialConfigured=true;row.credentialVersion+=1;
    this.#invalidateQualification(row,{reasonCode:ResourceConnectionReason.CREDENTIAL_UPDATED,reason:'Session credential replaced; model qualification must be repeated.'});
    this.#diagnostic(row,'CREDENTIAL_UPDATED','Session credential replaced.',{credentialVersion:row.credentialVersion,storage:row.credentialStorage});
    emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_CREDENTIAL,{...this.#telemetryRow(row),credentialConfigured:true,credentialVersion:row.credentialVersion,action:'REPLACED'});
    this.#notify('RESOURCE_CREDENTIAL',row);return this.readResource(resourceId);
  }

  clearResourceCredential(resourceId,{reason='Session credential revoked.'}={}){
    const row=this.#row(resourceId);if(row.kind!==ResourceKind.OPENAI_COMPATIBLE)return this.readResource(resourceId);
    const adapter=this.adapters.get(row.providerId);adapter?.clearCredential?.();
    for(const controller of this.controllers.get(resourceId)??[])if(!controller.signal.aborted)controller.abort('credential-revoked');
    this.controllers.delete(resourceId);row.credentialConfigured=false;row.credentialVersion+=1;
    this.#invalidateQualification(row,{reasonCode:ResourceConnectionReason.CREDENTIAL_REVOKED,reason:safeMessage(reason),unavailable:row.credentialRequired});
    this.#diagnostic(row,'CREDENTIAL_REVOKED','Session credential revoked.',{credentialVersion:row.credentialVersion,storage:row.credentialStorage});
    emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_CREDENTIAL,{...this.#telemetryRow(row),credentialConfigured:false,credentialVersion:row.credentialVersion,action:'REVOKED'});
    this.#notify('RESOURCE_CREDENTIAL',row);return this.readResource(resourceId);
  }

  revokeResourceCredential(resourceId,options={}){return this.clearResourceCredential(resourceId,options);}

  selectResourceModel(resourceId,modelId){
    const row=this.#row(resourceId);const value=req(modelId,'modelId');
    const discovery=row.modelDiscovery??createDiscoveryReadModel(ResourceModelDiscoveryState.IDLE,{transportMode:row.transportMode});
    const found=(discovery.models??[]).find(model=>model.id===value);
    if([ResourceModelDiscoveryState.READY,ResourceModelDiscoveryState.EMPTY].includes(discovery.state)&&!found){
      throw new ProviderInvocationError(FailureCode.MODEL_UNAVAILABLE,'Selected model is not present in the discovered provider model list',{providerId:row.providerId,status:404});
    }
    if(discovery.state===ResourceModelDiscoveryState.EMPTY)throw new ProviderInvocationError(FailureCode.MODEL_UNAVAILABLE,'Provider model discovery returned no selectable models',{providerId:row.providerId});
    const adapter=this.adapters.get(row.providerId);adapter?.setModelId?.(value);this.profiles.setModelId(row.providerProfileId,value);row.modelId=value;
    row.modelSelectionMode=found?'DISCOVERED':discovery.state===ResourceModelDiscoveryState.UNSUPPORTED?'MANUAL_FALLBACK':'LEGACY_UNVERIFIED';
    this.#invalidateQualification(row,{reasonCode:ResourceConnectionReason.MODEL_SELECTED,reason:'Model selected; authenticated qualification is required.'});
    this.#diagnostic(row,'MODEL_SELECTED','Model selection updated.',{selectionMode:row.modelSelectionMode});
    emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_MODEL_SELECTED,{...this.#telemetryRow(row),selectionMode:row.modelSelectionMode});
    this.#notify('RESOURCE_MODEL_SELECTED',row);return this.readResource(resourceId);
  }

  async connectResource(resourceId,{signal=null}={}){
    const row=this.#row(resourceId);
    if(this.#isExecutable(row)&&row.selectedModelQualified)return this.readResource(resourceId);
    if(row.credentialRequired&&!row.credentialConfigured){
      row.state=ResourceConnectionState.UNAVAILABLE;row.reasonCode=ResourceConnectionReason.CREDENTIAL_REQUIRED;row.reason='A session credential is required before this resource can connect.';
      row.lastFailure={code:FailureCode.CREDENTIAL_REQUIRED,message:row.reason,at:this.now()};this.profiles.setAvailability(row.providerProfileId,false);this.profiles.setHealth(row.providerProfileId,'UNAVAILABLE');
      this.#diagnostic(row,'CREDENTIAL_REQUIRED',row.reason);emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_READY,{...this.#telemetryRow(row),ready:false});this.#notify('RESOURCE_UNAVAILABLE',row);return this.readResource(resourceId);
    }
    row.state=ResourceConnectionState.CONNECTING;row.reasonCode=ResourceConnectionReason.CONNECT_REQUESTED;row.reason='Authenticated model qualification in progress.';
    row.lastFailure=null;row.selectedModelQualified=false;row.qualifiedAt=null;this.profiles.setAvailability(row.providerProfileId,false);this.profiles.setHealth(row.providerProfileId,'PROBE');
    this.health.setManualDisabled(row.providerProfileId,false,{now:this.now()});this.health.beginProbe(row.providerProfileId,{now:this.now()});
    this.#diagnostic(row,'CONNECTING','Authenticated selected-model qualification started.');
    emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_CONNECTING,this.#telemetryRow(row));this.#notify('RESOURCE_CONNECTING',row);
    const started=this.now();
    try{
      const adapter=this.adapters.get(row.providerId);const probe=await adapter.probe({signal,timeoutMs:this.privateConfig.get(row.resourceId)?.healthTimeoutMs});
      row.lastHealthCheckAt=this.now();row.lastHealthLatencyMs=finiteOrNull(probe?.latencyMs??(this.now()-started));row.lastHealthResult='PASS';
      row.connectedAt=this.now();row.disconnectedAt=null;row.selectedModelQualified=true;row.qualifiedAt=this.now();row.actualModelId=probe?.modelId??row.modelId;row.actualProvider=probe?.actualProvider??null;
      row.state=probe?.degraded?ResourceConnectionState.DEGRADED:ResourceConnectionState.READY;
      row.reasonCode=ResourceConnectionReason.HEALTH_CHECK_PASSED;row.reason=probe?.degraded?'Authenticated model qualification passed in degraded mode.':'Authenticated model qualification passed.';
      this.profiles.setAvailability(row.providerProfileId,true);this.profiles.setHealth(row.providerProfileId,probe?.degraded?'DEGRADED':'HEALTHY');
      this.health.completeProbe(row.providerProfileId,{success:true,now:this.now()});
      this.#diagnostic(row,'HEALTH_CHECK_PASSED',row.reason,{latencyMs:row.lastHealthLatencyMs,modelAvailable:probe?.modelAvailable??null,transportMode:row.transportMode});
      emitTelemetry(this.telemetry,TelemetryEvent.RESOURCE_READY,this.#telemetryRow(row));this.#notify('RESOURCE_READY',row);return this.readResource(resourceId);
    }catch(error){
      row.lastHealthCheckAt=this.now();row.lastHealthLatencyMs=Math.max(0,this.now()-started);row.lastHealthResult='FAIL';row.state=ResourceConnectionState.UNAVAILABLE;row.selectedModelQualified=false;row.qualifiedAt=null;
      row.reasonCode=reasonFromError(error);row.reason=safeMessage(error?.message??'Authenticated model qualification failed.');row.lastFailure={code:error?.code??FailureCode.PROVIDER_UNAVAILABLE,message:row.reason,at:this.now()};
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
        if(row.credentialRequired&&!row.credentialConfigured)throw new ProviderInvocationError(FailureCode.CREDENTIAL_REQUIRED,'A session credential is required before testing this resource',{providerId:row.providerId});
        const adapter=this.adapters.get(row.providerId);const probe=await adapter.probe({signal,timeoutMs:this.privateConfig.get(row.resourceId)?.healthTimeoutMs});
        row.selectedModelQualified=true;row.qualifiedAt=this.now();row.actualModelId=probe?.modelId??row.modelId;row.actualProvider=probe?.actualProvider??null;
        result={kind:'ResourceProbeResult',ok:true,latencyMs:finiteOrNull(probe?.latencyMs),modelAvailable:probe?.modelAvailable??null,measurementClass:row.measurementClass,transportMode:row.transportMode,actualModelId:row.actualModelId,actualProvider:row.actualProvider};
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

  async executeEmbedding(resourceId,{input,signal=null,dimensions=null,inputType=null,encodingFormat='float'}={}){
    const row=this.#row(resourceId);
    if(row.transportMode!==ProviderTransportMode.EMBEDDINGS)throw new ProviderInvocationError(FailureCode.CAPABILITY_UNAVAILABLE,'Resource is not configured for embeddings transport',{providerId:row.providerId});
    if(!this.#isExecutable(row)||!row.selectedModelQualified)throw new ProviderInvocationError(FailureCode.CAPABILITY_UNAVAILABLE,'Embedding resource is not connected and qualified',{providerId:row.providerId});
    if(row.activeExecutions>=row.maxConcurrency)throw new ProviderInvocationError(FailureCode.CAPABILITY_UNAVAILABLE,'Embedding resource capacity exhausted',{providerId:row.providerId});
    const adapter=this.adapters.get(row.providerId);if(typeof adapter?.embed!=='function')throw new ProviderInvocationError(FailureCode.CAPABILITY_UNAVAILABLE,'Resource adapter does not expose embeddings creation',{providerId:row.providerId});
    const controller=new AbortController();const detach=linkAbort(signal,controller);const set=this.controllers.get(row.resourceId)??new Set();set.add(controller);this.controllers.set(row.resourceId,set);
    row.activeExecutions+=1;this.profiles.setLoad(row.providerProfileId,row.activeExecutions);this.health.setConcurrency(row.providerProfileId,row.activeExecutions,{now:this.now()});
    const started=this.now();
    try{
      const execution=await adapter.embed(input,{signal:controller.signal,timeoutMs:this.privateConfig.get(row.resourceId)?.timeoutMs,dimensions,inputType,encodingFormat});
      const latency=Math.max(0,this.now()-started);const profile=this.profiles.get(row.providerProfileId);
      const usageReceipt=normalizeProviderUsageReceipt({usage:execution.usage??{},providerProfileId:row.providerProfileId,capability:Capability.EMBED,latencyMs:execution.latencyMs,pricing:profile?.costMetadata});
      row.actualModelId=execution.modelId??row.actualModelId??row.modelId;row.actualProvider=execution.metadata?.actualProvider??row.actualProvider;
      row.lastExecution={status:'SUCCESS',taskId:null,taskType:'EMBEDDING',at:this.now(),latencyMs:latency,providerId:row.providerId,workerId:row.workerId,measurementClass:row.measurementClass,vectorCount:execution.vectors.length,dimensions:execution.dimensions};
      this.health.observe(row.providerProfileId,{outcome:'SUCCESS',activeConcurrency:Math.max(0,row.activeExecutions-1),latencyMs:latency,now:this.now()});
      emitTelemetry(this.telemetry,TelemetryEvent.EMBEDDING_EXECUTION,{...this.#telemetryRow(row),status:'SUCCESS',latencyMs:latency,vectorCount:execution.vectors.length,dimensions:execution.dimensions,actualModelId:row.actualModelId,actualProvider:row.actualProvider});
      emitTelemetry(this.telemetry,TelemetryEvent.PROVIDER_INVOKED,{providerId:row.providerId,modelId:row.actualModelId,taskClass:'EMBEDDING',executionLatency:execution.latencyMs,validationLatency:0,attempt:1,measurementClass:row.measurementClass});
      emitTelemetry(this.telemetry,TelemetryEvent.PROVIDER_USAGE,{providerId:row.providerId,providerProfileId:row.providerProfileId,measurementClass:row.measurementClass,usageReceipt});
      return deepFreeze({kind:'ResourceEmbeddingResult',resourceId:row.resourceId,providerProfileId:row.providerProfileId,providerId:row.providerId,workerId:row.workerId,requestedModelId:row.modelId,actualModelId:row.actualModelId,actualProvider:row.actualProvider,embeddings:execution.vectors,vectorCount:execution.vectors.length,dimensions:execution.dimensions,usageReceipt,latencyMs:execution.latencyMs,measurementClass:row.measurementClass,authority:'NONE'});
    }catch(error){
      row.lastExecution={status:'FAIL',taskId:null,taskType:'EMBEDDING',at:this.now(),latencyMs:Math.max(0,this.now()-started),providerId:row.providerId,workerId:row.workerId,measurementClass:row.measurementClass,failureCode:error?.code??FailureCode.PROVIDER_FAILURE};
      this.#observeFailure(row,error);emitTelemetry(this.telemetry,TelemetryEvent.EMBEDDING_EXECUTION,{...this.#telemetryRow(row),status:'FAIL',failureCode:row.lastExecution.failureCode,latencyMs:row.lastExecution.latencyMs});throw error;
    }finally{
      detach();set.delete(controller);if(!set.size)this.controllers.delete(row.resourceId);row.activeExecutions=Math.max(0,row.activeExecutions-1);
      this.profiles.setLoad(row.providerProfileId,row.activeExecutions);this.health.setConcurrency(row.providerProfileId,row.activeExecutions,{now:this.now()});this.#notify('RESOURCE_EXECUTION',row);
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
      const result=await this.executionLayer.execute(task,{input,attempt,signal:controller.signal,maxCostClass,profileId:row.providerProfileId,leaseHeld:true});
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
    const owner=this;
    const base=new JevProviderExecutor({profiles:this.profiles,adapters:this.adapters,...options});
    return Object.freeze({
      hasEligibleProvider(request,prefilter){
        return base.hasEligibleProvider(request,prefilter);
      },
      async execute(request,{prefilter=null,signal=null,attempt=1,profileId=null}={}){
        const task=createJevCognitiveTask(request,{prefilter});
        const input=createJevProviderInput(request,prefilter);
        const contextTokens=Math.max(1,Math.ceil(new TextEncoder().encode(JSON.stringify(input)).length/4));
        const candidates=owner.profiles.eligibleProfiles(task,{
          contextTokens,maxCostClass:options.maxCostClass??'HIGH',requireStructuredOutput:true,expectedOutputTokens:700,
        }).filter(profile=>owner.adapters.get(profile.providerId)&&owner.#resourceByProfile(profile.profileId)&&owner.#isExecutable(owner.#resourceByProfile(profile.profileId)));
        const profile=profileId==null?candidates[Math.min(Math.max(0,Number(attempt??1)-1),Math.max(0,candidates.length-1))]:candidates.find(x=>x.profileId===profileId);
        if(!profile)throw new ProviderInvocationError(FailureCode.PROVIDER_UNAVAILABLE,'No connected resource satisfies Jev',{providerId:null});
        const row=owner.#resourceByProfile(profile.profileId);
        if(row.activeExecutions>=row.maxConcurrency)throw new ProviderInvocationError(FailureCode.CAPABILITY_UNAVAILABLE,'Jev resource capacity exhausted',{providerId:row.providerId});
        const controller=new AbortController();const detach=linkAbort(signal,controller);const set=owner.controllers.get(row.resourceId)??new Set();set.add(controller);owner.controllers.set(row.resourceId,set);
        row.activeExecutions+=1;owner.profiles.setLoad(row.providerProfileId,row.activeExecutions);owner.health.setConcurrency(row.providerProfileId,row.activeExecutions,{now:owner.now()});
        const started=owner.now();
        try{
          const execution=await base.execute(request,{prefilter,signal:controller.signal,attempt,profileId:profile.profileId,leaseHeld:true});
          const latency=Math.max(0,owner.now()-started);
          row.lastExecution={status:'SUCCESS',taskId:task.taskId,taskType:'JEV_DECISION',at:owner.now(),latencyMs:latency,providerId:profile.providerId,workerId:profile.workerId,measurementClass:row.measurementClass};
          owner.health.observe(row.providerProfileId,{outcome:'SUCCESS',activeConcurrency:Math.max(0,row.activeExecutions-1),latencyMs:latency,now:owner.now()});
          emitTelemetry(owner.telemetry,TelemetryEvent.RESOURCE_EXECUTION,{...owner.#telemetryRow(row),taskId:task.taskId,taskType:'JEV_DECISION',status:'SUCCESS',latencyMs:latency,workerId:profile.workerId,providerId:profile.providerId});
          emitTelemetry(owner.telemetry,TelemetryEvent.PROVIDER_INVOKED,{taskId:task.taskId,turnId:task.turnId,providerId:profile.providerId,modelId:profile.modelId,taskClass:'JEV_DECISION',executionLatency:execution.latencyMetadata?.providerLatencyMs??latency,validationLatency:execution.latencyMetadata?.validationLatencyMs??0,attempt,measurementClass:execution.providerProvenance?.measurementClass??row.measurementClass});
          emitTelemetry(owner.telemetry,TelemetryEvent.PROVIDER_USAGE,{taskId:task.taskId,turnId:task.turnId,providerId:profile.providerId,providerProfileId:profile.profileId,measurementClass:execution.providerProvenance?.measurementClass??row.measurementClass,usageReceipt:execution.providerProvenance?.usageReceipt??null});
          return execution;
        }catch(error){
          row.lastExecution={status:'FAIL',taskId:task.taskId,taskType:'JEV_DECISION',at:owner.now(),latencyMs:Math.max(0,owner.now()-started),providerId:row.providerId,workerId:row.workerId,measurementClass:row.measurementClass,failureCode:error?.code??FailureCode.PROVIDER_FAILURE};
          owner.#observeFailure(row,error);
          emitTelemetry(owner.telemetry,TelemetryEvent.RESOURCE_EXECUTION,{...owner.#telemetryRow(row),taskId:task.taskId,taskType:'JEV_DECISION',status:'FAIL',failureCode:row.lastExecution.failureCode,latencyMs:row.lastExecution.latencyMs});
          throw error;
        }finally{
          detach();set.delete(controller);if(!set.size)owner.controllers.delete(row.resourceId);row.activeExecutions=Math.max(0,row.activeExecutions-1);
          owner.profiles.setLoad(row.providerProfileId,row.activeExecutions);owner.health.setConcurrency(row.providerProfileId,row.activeExecutions,{now:owner.now()});
          owner.#notify('RESOURCE_EXECUTION',row);
        }
      },
    });
  }

  listResources(){
    return Object.freeze([...this.resources.keys()].sort().map(id=>this.readResource(id)));
  }

  readResource(resourceId){
    const row=this.#row(resourceId);const profile=this.profiles.get(row.providerProfileId);const health=this.health.snapshot(row.providerProfileId);
    const callable=Boolean(this.adapters.get(row.providerId)&&this.#isExecutable(row)&&row.selectedModelQualified);
    return deepFreeze({
      kind:'CoprocessorResourceReadModel',contractVersion:RESOURCE_CONNECTION_VERSION,resourceId:row.resourceId,displayName:row.displayName,kind:row.kind,
      state:row.state,reasonCode:row.reasonCode,reason:row.reason,providerProfileId:row.providerProfileId,providerId:row.providerId,modelId:row.modelId,actualModelId:row.actualModelId,actualProvider:row.actualProvider,workerId:row.workerId,
      transportMode:row.transportMode,providerIdentity:clone(row.providerIdentity),declaredCapabilities:[...row.declaredCapabilities],routableCapabilities:[...row.routableCapabilities],activeCapabilities:callable?[...(profile?.capabilities??row.routableCapabilities)]:[],
      measurementClass:row.measurementClass,configuredAt:row.configuredAt,connectedAt:row.connectedAt,disconnectedAt:row.disconnectedAt,qualifiedAt:row.qualifiedAt,selectedModelQualified:Boolean(row.selectedModelQualified),modelSelectionMode:row.modelSelectionMode,
      lastHealthCheckAt:row.lastHealthCheckAt,lastHealthLatencyMs:row.lastHealthLatencyMs,lastHealthResult:row.lastHealthResult,
      endpoint:row.endpoint,credentialConfigured:row.credentialConfigured,credentialRequired:row.credentialRequired,credentialStorage:row.credentialStorage,credentialVersion:row.credentialVersion,
      modelDiscovery:clone(row.modelDiscovery),local:row.local,maxConcurrency:row.maxConcurrency,activeExecutions:row.activeExecutions,
      health:health.health,availability:profile?.availability??'UNAVAILABLE',currentLoad:profile?.currentLoad??row.activeExecutions,
      lastTest:clone(row.lastTest),lastExecution:clone(row.lastExecution),lastFailure:clone(row.lastFailure),diagnostics:deepFreeze(row.diagnostics.map(clone)),
      callable,authority:'NONE',truthAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    });
  }

  readModel(){
    const resources=this.listResources();const counts=Object.fromEntries(Object.values(ResourceConnectionState).map(x=>[x,0]));for(const row of resources)counts[row.state]+=1;
    const callableResources=resources.filter(x=>x.callable);const capabilities=[...new Set(callableResources.flatMap(x=>x.activeCapabilities))].sort();
    return deepFreeze({
      kind:'CoprocessorResourceConnectionReadModel',contractVersion:RESOURCE_CONNECTION_VERSION,sequence:this.sequence,resources,counts:deepFreeze(counts),
      activeCapabilities:capabilities,hasOptionalResources:resources.length>0,readyResourceCount:callableResources.length,
      nativePathRequired:callableResources.length===0,credentialStorage:ResourceCredentialStorage.SESSION_MEMORY_ONLY,
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
  #isExecutable(row){return Boolean(row&&row.selectedModelQualified&&[ResourceConnectionState.READY,ResourceConnectionState.DEGRADED].includes(row.state));}
  #invalidateQualification(row,{reasonCode=ResourceConnectionReason.NOT_READY,reason='Resource qualification invalidated.',unavailable=false}={}){
    row.selectedModelQualified=false;row.qualifiedAt=null;row.actualModelId=null;row.actualProvider=null;row.connectedAt=null;
    row.state=unavailable?ResourceConnectionState.UNAVAILABLE:ResourceConnectionState.CONFIGURED;row.reasonCode=reasonCode;row.reason=reason;row.lastHealthResult=null;
    this.profiles.setAvailability(row.providerProfileId,false);this.profiles.setHealth(row.providerProfileId,'UNAVAILABLE');this.health.setManualDisabled(row.providerProfileId,true,{now:this.now()});
  }
  #row(resourceId){const row=this.resources.get(String(resourceId));if(!row)throw new Error('Unknown resource: '+resourceId);return row;}
  #diagnostic(row,code,message,details={}){
    row.diagnostics.push({sequence:++this.sequence,at:this.now(),code:String(code),message:safeMessage(message),details:safeDetails(details)});if(row.diagnostics.length>this.diagnosticLimit)row.diagnostics.splice(0,row.diagnostics.length-this.diagnosticLimit);
  }
  #telemetryRow(row){return{resourceId:row.resourceId,providerProfileId:row.providerProfileId,providerId:row.providerId,modelId:row.modelId,actualModelId:row.actualModelId??null,providerFamily:row.providerIdentity?.family??null,transportMode:row.transportMode,state:row.state,reasonCode:row.reasonCode,measurementClass:row.measurementClass,capabilities:[...row.routableCapabilities],activeExecutions:row.activeExecutions,maxConcurrency:row.maxConcurrency,local:row.local,credentialConfigured:row.credentialConfigured,selectedModelQualified:Boolean(row.selectedModelQualified)};}
  #notify(type,row){const event=deepFreeze({kind:'CoprocessorResourceConnectionEvent',sequence:++this.sequence,type,resource:this.readResource(row.resourceId)});for(const listener of this.subscribers){try{listener(event);}catch{}}}
}

function createAdapter(kind,input){
  if(kind===ResourceKind.DETERMINISTIC_LOCAL)return new DeterministicProviderAdapter({
    providerId:input.providerId,modelId:input.modelId,capabilities:input.capabilities,handler:input.handler,handlers:input.handlers??{},measurementClass:input.measurementClass,
  });
  const endpoint=validatedEndpoint(input.endpoint);
  return new OpenAICompatibleProviderAdapter({
    providerId:input.providerId,modelId:input.modelId,endpoint,apiKey:input.apiKey??null,headers:input.headers??{},fetchImpl:input.fetchImpl,
    timeoutMs:input.timeoutMs??30000,contextLimit:input.contextLimit??input.maxContextTokens??null,outputLimit:input.outputLimit??input.maxOutputTokens??null,
    capabilities:input.capabilities,local:Boolean(input.local),costMetadata:input.costMetadata??null,healthCheckPath:input.healthCheckPath??'/models',
    modelListPath:input.modelListPath??(input.transportMode===ProviderTransportMode.EMBEDDINGS?'/embeddings/models':'/models'),measurementClass:input.measurementClass,transportMode:input.transportMode,
  });
}

function sanitizePrivateConfig(input){return{
  healthTimeoutMs:Math.max(1,Number(input.healthTimeoutMs??input.timeoutMs??10000)||10000),
  timeoutMs:Math.max(1,Number(input.timeoutMs??30000)||30000),hasCredential:Boolean(input.apiKey),credentialRequired:Boolean(input.credentialRequired),
};}
function normalizeCapabilities(values){
  if(!Array.isArray(values)||!values.length)throw new TypeError('capabilities must be a non-empty array');const out=[...new Set(values.map(String))].sort();
  for(const capability of out)if(!KNOWN_CAPABILITIES.has(capability))throw new TypeError('unknown capability: '+capability);return Object.freeze(out);
}
function normalizeMeasurementClass(value){const v=String(value);if(!MEASUREMENT_CLASSES.has(v))throw new TypeError('unsupported measurement class: '+v);return v;}
function reasonFromError(error){
  const code=error?.code;
  if(code===FailureCode.CREDENTIAL_REQUIRED)return ResourceConnectionReason.CREDENTIAL_REQUIRED;
  if(code===FailureCode.PROVIDER_UNAUTHORIZED)return ResourceConnectionReason.MODEL_DISCOVERY_UNAUTHORIZED;
  if(code===FailureCode.MODEL_UNAVAILABLE)return ResourceConnectionReason.MODEL_UNAVAILABLE;
  if(code===FailureCode.PROVIDER_TIMEOUT)return ResourceConnectionReason.PROVIDER_TIMEOUT;
  if(code===FailureCode.PROVIDER_ABORTED)return ResourceConnectionReason.PROVIDER_ABORTED;
  if([FailureCode.MALFORMED_OUTPUT,FailureCode.SCHEMA_INVALID,FailureCode.SCHEMA_VALIDATION_FAILED,FailureCode.SEMANTIC_VALIDATION_FAILED].includes(code))return ResourceConnectionReason.MALFORMED_OUTPUT;
  if([FailureCode.PROVIDER_UNAVAILABLE,FailureCode.CAPABILITY_UNAVAILABLE].includes(code))return ResourceConnectionReason.PROVIDER_UNAVAILABLE;
  return ResourceConnectionReason.EXECUTION_FAILED;
}
function normalizeTransportMode(value,capabilities,kind){
  if(kind===ResourceKind.DETERMINISTIC_LOCAL)return'DETERMINISTIC';
  if(value!=null){
    const v=String(value).toUpperCase();if(!Object.values(ProviderTransportMode).includes(v))throw new TypeError('unsupported provider transport mode: '+v);return v;
  }
  const set=new Set(capabilities);const vectorOnly=[...set].every(cap=>VECTOR_CAPABILITIES.has(cap));
  return set.has(Capability.EMBED)&&vectorOnly?ProviderTransportMode.EMBEDDINGS:ProviderTransportMode.CHAT_COMPLETIONS;
}
const VECTOR_CAPABILITIES=new Set([Capability.EMBED,Capability.RETRIEVAL,Capability.RETRIEVAL_QUALITY,Capability.RERANK,Capability.LATE_INTERACTION,Capability.CROSS_ENCODER_RERANK]);
function qualifiedTransportCapabilities(declared,transportMode,kind){
  if(kind===ResourceKind.DETERMINISTIC_LOCAL)return Object.freeze([...declared]);
  if(transportMode===ProviderTransportMode.EMBEDDINGS)return Object.freeze(declared.includes(Capability.EMBED)?[Capability.EMBED]:[]);
  return Object.freeze(declared.filter(cap=>cap!==Capability.EMBED));
}
function classifyProviderIdentity(endpoint,kind){
  if(kind===ResourceKind.DETERMINISTIC_LOCAL)return deepFreeze({family:'DETERMINISTIC_LOCAL',remote:false});
  const url=new URL(endpoint);const host=url.hostname.toLowerCase();const openrouter=host==='openrouter.ai'||host.endsWith('.openrouter.ai');
  return deepFreeze({family:openrouter?'OPENROUTER':isLocalHostname(host)?'LOCAL_OPENAI_COMPATIBLE':'OPENAI_COMPATIBLE',remote:!isLocalHostname(host)});
}
function isLocalEndpoint(endpoint){if(!endpoint)return false;try{return isLocalHostname(new URL(endpoint).hostname.toLowerCase());}catch{return false;}}
function isLocalHostname(host){return host==='localhost'||host==='::1'||host.endsWith('.local')||host==='127.0.0.1'||host.startsWith('127.');}
function createDiscoveryReadModel(state,input={}){
  return deepFreeze({kind:'ResourceModelDiscoveryReadModel',state,models:Object.freeze((input.models??[]).map(clone)),manualModelEntryAllowed:Boolean(input.manualModelEntryAllowed??state===ResourceModelDiscoveryState.UNSUPPORTED),
    reasonCode:input.reasonCode??discoveryReasonCode(state),reason:input.reason??discoveryReason(state),transportMode:input.transportMode??null,at:input.at??Date.now()});
}
function discoveryResultFromAdapter(discovery,{endpoint=null,identity=null,transportMode=null,credentialConfigured=false}={}){
  const state=discovery?.state===ProviderModelDiscoveryState.UNSUPPORTED?ResourceModelDiscoveryState.UNSUPPORTED
    :discovery?.state===ProviderModelDiscoveryState.EMPTY?ResourceModelDiscoveryState.EMPTY:ResourceModelDiscoveryState.READY;
  const models=(discovery?.models??[]).map(model=>deepFreeze({...clone(model),capabilities:transportMode===ProviderTransportMode.EMBEDDINGS?[Capability.EMBED]:Object.freeze([...(model.capabilities??[])])}));
  return {kind:'ResourceModelDiscoveryResult',state,models,manualModelEntryAllowed:state===ResourceModelDiscoveryState.UNSUPPORTED,reasonCode:discoveryReasonCode(state),reason:discoveryReason(state),
    endpoint:safeEndpoint(endpoint),providerIdentity:clone(identity),transportMode,local:isLocalEndpoint(endpoint),credentialConfigured,credentialStorage:ResourceCredentialStorage.SESSION_MEMORY_ONLY,latencyMs:finiteOrNull(discovery?.latencyMs)};
}
function discoveryFailure(error,{endpoint=null,identity=null,transportMode=null,credentialConfigured=false}={}){
  const state=error?.code===FailureCode.PROVIDER_UNAUTHORIZED||error?.code===FailureCode.CREDENTIAL_REQUIRED?ResourceModelDiscoveryState.UNAUTHORIZED
    :[FailureCode.PROVIDER_UNAVAILABLE,FailureCode.PROVIDER_TIMEOUT,FailureCode.PROVIDER_ABORTED].includes(error?.code)?ResourceModelDiscoveryState.UNREACHABLE
    :ResourceModelDiscoveryState.FAILED;
  return {kind:'ResourceModelDiscoveryResult',state,models:[],manualModelEntryAllowed:false,reasonCode:discoveryReasonCode(state),reason:safeMessage(error?.message??discoveryReason(state)),
    endpoint:safeEndpoint(endpoint),providerIdentity:clone(identity),transportMode,local:isLocalEndpoint(endpoint),credentialConfigured,credentialStorage:ResourceCredentialStorage.SESSION_MEMORY_ONLY};
}
function discoveryReasonCode(state){return({
  [ResourceModelDiscoveryState.LOADING]:ResourceConnectionReason.MODEL_DISCOVERY_LOADING,[ResourceModelDiscoveryState.READY]:ResourceConnectionReason.MODEL_DISCOVERY_READY,
  [ResourceModelDiscoveryState.EMPTY]:ResourceConnectionReason.MODEL_DISCOVERY_EMPTY,[ResourceModelDiscoveryState.UNSUPPORTED]:ResourceConnectionReason.MODEL_DISCOVERY_UNSUPPORTED,
  [ResourceModelDiscoveryState.UNAUTHORIZED]:ResourceConnectionReason.MODEL_DISCOVERY_UNAUTHORIZED,[ResourceModelDiscoveryState.UNREACHABLE]:ResourceConnectionReason.MODEL_DISCOVERY_UNREACHABLE,
  [ResourceModelDiscoveryState.FAILED]:ResourceConnectionReason.MODEL_DISCOVERY_FAILED,[ResourceModelDiscoveryState.IDLE]:ResourceConnectionReason.CONFIGURED,
})[state]??ResourceConnectionReason.MODEL_DISCOVERY_FAILED;}
function discoveryReason(state){return({
  [ResourceModelDiscoveryState.IDLE]:'Model discovery has not run.',[ResourceModelDiscoveryState.LOADING]:'Model discovery in progress.',[ResourceModelDiscoveryState.READY]:'Provider models loaded.',
  [ResourceModelDiscoveryState.EMPTY]:'Provider model discovery returned no models.',[ResourceModelDiscoveryState.UNSUPPORTED]:'Provider does not support model discovery; manual model entry is allowed as a fallback.',
  [ResourceModelDiscoveryState.UNAUTHORIZED]:'Provider rejected model discovery authorization.',[ResourceModelDiscoveryState.UNREACHABLE]:'Provider model discovery was unreachable or timed out.',
  [ResourceModelDiscoveryState.FAILED]:'Provider model discovery failed.',
})[state]??'Provider model discovery failed.';}

function validatedEndpoint(value){
  const raw=req(value,'endpoint');let url;
  try{url=new URL(raw);}catch{throw new TypeError('endpoint must be an absolute http(s) URL');}
  if(!['http:','https:'].includes(url.protocol))throw new TypeError('endpoint must use http or https');
  if(url.username||url.password||url.search||url.hash)throw new TypeError('endpoint must not contain credentials, query parameters, or fragments');
  return url.toString().replace(/\/$/,'');
}
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
