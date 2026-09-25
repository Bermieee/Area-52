import {DependencyReadiness} from './dependency-readiness.js';

const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();

export function projectRuntimeDependencyEvaluation(evaluation){
  const missingRequired=uniq(evaluation?.missingRequired),missingOptional=uniq(evaluation?.missingOptional),degradedServices=uniq(evaluation?.degradedServices);
  const blocked=missingRequired.length>0||evaluation?.executable===false;
  const degraded=!blocked&&(missingOptional.length>0||degradedServices.length>0||evaluation?.degraded===true);
  return{
    kind:'DependencyReadiness',
    state:blocked?DependencyReadiness.BLOCKED:degraded?DependencyReadiness.DEGRADED:DependencyReadiness.READY,
    missingRequiredDependencies:missingRequired,
    missingOptionalDependencies:missingOptional,
    missingRequiredCapabilities:[],
    missingOptionalCapabilities:[],
    reasons:[...(blocked?['REQUIRED_DEPENDENCY_MISSING']:[]),...(degraded?['OPTIONAL_DEPENDENCY_OR_SERVICE_DEGRADED']:[])],
    source:'RUNTIME_DEPENDENCY_GRAPH',
  };
}

export function reconcileDependencyProjection(coreReadiness,runtimeEvaluation){
  const runtime=projectRuntimeDependencyEvaluation(runtimeEvaluation);
  return{
    kind:'DependencyReconciliationReceipt',
    compatible:coreReadiness?.state===runtime.state,
    coreState:coreReadiness?.state??null,
    runtimeState:runtime.state,
    serviceDependencyState:runtime.state,
    providerCapabilityState:'SEPARATE_CONTRACT',
    rule:'Service dependency availability and provider capability discovery remain distinct.',
  };
}

function schemaValidator(schema={}){
  const required=[...(schema.required??[])],properties={...(schema.properties??{})},allowUnknown=schema.allowUnknown!==false;
  return(payload)=>{
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return false;
    for(const name of required)if(!(name in payload))return false;
    for(const [name,value] of Object.entries(payload)){
      const type=properties[name];if(!type){if(!allowUnknown)return false;continue;}
      if(type==='any')continue;
      if(type==='array'&&!Array.isArray(value))return false;
      else if(type==='object'&&(value===null||typeof value!=='object'||Array.isArray(value)))return false;
      else if(!['array','object'].includes(type)&&typeof value!==type)return false;
    }
    return true;
  };
}

export function registerRuntimeStyleEventDescriptor(coreRegistry,descriptor,{ownerPrefix='EXTERNAL'}={}){
  const eventVersion=String(descriptor?.eventVersion??descriptor?.schemaVersion??'1.0.0');
  return coreRegistry.registerType({
    eventType:String(descriptor.eventType),
    eventVersion,
    owner:String(descriptor.owner??descriptor.producer??ownerPrefix),
    validatePayload:schemaValidator(descriptor.payloadSchema??{allowUnknown:true}),
  });
}

export function registerRuntimeStyleEventDescriptors(coreRegistry,descriptors=[]){
  const rows=[];
  for(const descriptor of descriptors){
    if(coreRegistry.has(descriptor.eventType)){rows.push({eventType:descriptor.eventType,registered:false,reason:'ALREADY_REGISTERED'});continue;}
    const registered=registerRuntimeStyleEventDescriptor(coreRegistry,descriptor);
    rows.push({eventType:descriptor.eventType,registered:true,registeredDescriptor:registered});
  }
  return rows;
}
