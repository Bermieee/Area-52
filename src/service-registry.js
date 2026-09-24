import {AuthorityPermission,CompatibilityStatus,FrameworkContractVersion,FrameworkFailureCode,SubsystemLifecycle,createSubsystemManifest} from './framework-contracts.js';
import {ContractVersionRegistry} from './contract-versioning.js';
import {ServiceDependencyGraph} from './dependency-graph.js';
import {GoldenWorldCertificationMatrix} from './certification-matrix.js';
import {FrameworkError,clone} from './framework-utils.js';
const allowedTransitions={
  [SubsystemLifecycle.EXPERIMENTAL]:new Set([SubsystemLifecycle.SHADOW,SubsystemLifecycle.DEPRECATED]),
  [SubsystemLifecycle.SHADOW]:new Set([SubsystemLifecycle.EXPERIMENTAL,SubsystemLifecycle.ACTIVE,SubsystemLifecycle.DEPRECATED]),
  [SubsystemLifecycle.ACTIVE]:new Set([SubsystemLifecycle.SHADOW,SubsystemLifecycle.DEPRECATED]),
  [SubsystemLifecycle.DEPRECATED]:new Set(),
};

export class ServiceRegistry{
  #services=new Map();
  constructor({artifactRegistry,eventRegistry,versionRegistry=null,dependencyGraph=null,certificationMatrix=null}={}){
    this.artifactRegistry=artifactRegistry;this.eventRegistry=eventRegistry;this.versionRegistry=versionRegistry??new ContractVersionRegistry();this.dependencyGraph=dependencyGraph??new ServiceDependencyGraph();this.certificationMatrix=certificationMatrix??new GoldenWorldCertificationMatrix();
    this.versionRegistry.registerContract({contractId:'SubsystemManifest',currentVersion:FrameworkContractVersion,validate:(m)=>m?.kind==='SubsystemManifest'});
  }
  register(manifestInput){
    let manifest;try{manifest=manifestInput?.kind==='SubsystemManifest'?clone(manifestInput):createSubsystemManifest(manifestInput);}catch(error){throw new FrameworkError(FrameworkFailureCode.MALFORMED_MANIFEST,String(error.message??error));}
    if(this.#services.has(manifest.subsystemId))throw new FrameworkError(FrameworkFailureCode.DUPLICATE_SERVICE,`Service already registered: ${manifest.subsystemId}`);
    const compat=this.versionRegistry.compatibility('SubsystemManifest',manifest.contractVersion);if(![CompatibilityStatus.EXACT,CompatibilityStatus.COMPATIBLE,CompatibilityStatus.DEPRECATED].includes(compat.status))throw new FrameworkError(FrameworkFailureCode.INCOMPATIBLE_CONTRACT,`Manifest contract is incompatible: ${manifest.contractVersion}`,compat);
    this.#services.set(manifest.subsystemId,manifest);this.dependencyGraph.setManifest(manifest);
    const cycle=this.dependencyGraph.findRequiredCycle(manifest.subsystemId);if(cycle){this.#services.delete(manifest.subsystemId);this.dependencyGraph.removeManifest(manifest.subsystemId);throw new FrameworkError(FrameworkFailureCode.DEPENDENCY_CYCLE,`Required dependency cycle: ${cycle.join(' -> ')}`,{cycle});}
    return this.inspect(manifest.subsystemId);
  }
  registerSubsystem({manifest,artifactTypes=[],eventTypes=[]}){
    const registeredArtifacts=[],registeredEvents=[];let serviceId=null;
    try{
      const info=this.register(manifest);serviceId=info.manifest.subsystemId;
      for(const spec of artifactTypes){this.artifactRegistry.registerType(spec);registeredArtifacts.push(spec.artifactType);}
      for(const spec of eventTypes){this.eventRegistry.registerType(spec);registeredEvents.push(spec.eventType);}
      const activeManifest=this.#services.get(serviceId);
      const missingArtifacts=activeManifest.producedArtifactTypes.filter(x=>!this.artifactRegistry.has(x.id)).map(x=>x.id);
      const missingEvents=activeManifest.producedEvents.filter(x=>!this.eventRegistry.has(x.id)).map(x=>x.id);
      if(missingArtifacts.length||missingEvents.length)throw new FrameworkError('DECLARED_TYPE_UNREGISTERED','Manifest declares unregistered produced types',{missingArtifacts,missingEvents});
      return{...this.inspect(serviceId),registeredArtifacts:[...registeredArtifacts],registeredEvents:[...registeredEvents]};
    }catch(error){for(const t of registeredArtifacts)this.artifactRegistry.unregisterType(t);for(const t of registeredEvents)this.eventRegistry.unregisterType(t);if(serviceId)this.unregister(serviceId);throw error;}
  }
  unregister(id){this.#services.delete(id);this.dependencyGraph.removeManifest(id);}
  has(id){return this.#services.has(id);}
  list(){return[...this.#services.keys()].sort().map(id=>this.inspect(id));}
  inspect(id){const manifest=this.#services.get(id);if(!manifest)return null;return{manifest:clone(manifest),dependencies:this.dependencyGraph.resolve(id),capabilities:this.inspectCapabilities(id),certification:this.certificationMatrix.status(id,manifest)};}
  manifest(id){const m=this.#services.get(id);return m?clone(m):null;}
  discoverCapability(capability){return[...this.#services.values()].filter(m=>m.lifecycleState!==SubsystemLifecycle.DEPRECATED&&m.providedCapabilities.includes(capability)).map(m=>({subsystemId:m.subsystemId,lifecycleState:m.lifecycleState,version:m.version})).sort((a,b)=>a.subsystemId.localeCompare(b.subsystemId));}
  inspectCapabilities(id){const m=this.#services.get(id);if(!m)return null;const required=Object.fromEntries(m.requiredCapabilities.map(c=>[c,this.discoverCapability(c)])),optional=Object.fromEntries(m.optionalCapabilities.map(c=>[c,this.discoverCapability(c)]));const missingRequired=Object.entries(required).filter(([,v])=>v.length===0).map(([k])=>k),missingOptional=Object.entries(optional).filter(([,v])=>v.length===0).map(([k])=>k);return{provided:[...m.providedCapabilities],required,optional,missingRequired,missingOptional,degraded:missingOptional.length>0||missingRequired.length>0};}
  transition(id,to,{operatorApproved=false}={}){
    const m=this.#services.get(id);if(!m)throw new FrameworkError('UNKNOWN_SERVICE',`Unknown service: ${id}`);if(!allowedTransitions[m.lifecycleState]?.has(to))throw new FrameworkError(FrameworkFailureCode.LIFECYCLE_TRANSITION_INVALID,`${m.lifecycleState} -> ${to} is not allowed`);
    if(to===SubsystemLifecycle.ACTIVE){const deps=this.dependencyGraph.resolve(id),caps=this.inspectCapabilities(id),cert=this.certificationMatrix.status(id,m);if(!deps.canActivate||caps.missingRequired.length)throw new FrameworkError(FrameworkFailureCode.DEPENDENCY_REQUIRED_MISSING,'Required dependencies/capabilities are not satisfied',{deps,caps});if(!cert.eligible)throw new FrameworkError(FrameworkFailureCode.CERTIFICATION_REQUIRED,'Mandatory certification is incomplete',cert);if(!operatorApproved)throw new FrameworkError(FrameworkFailureCode.CERTIFICATION_REQUIRED,'ACTIVE promotion requires explicit policy/operator action');}
    const next={...m,lifecycleState:to};this.#services.set(id,next);this.dependencyGraph.setManifest(next);return this.inspect(id);
  }
  authorize(id,action){
    const m=this.#services.get(id);if(!m)return{allowed:false,code:'UNKNOWN_SERVICE'};
    if(action==='DIRECT_CANONICAL_MUTATION')return{allowed:false,code:FrameworkFailureCode.SETTLEMENT_REQUIRED,requiresSettlement:true};
    if(action==='DIRECT_PROMPT_INJECTION')return{allowed:false,code:FrameworkFailureCode.CONTEXT_SEAL_REQUIRED,requiresContextSeal:true};
    if(m.lifecycleState!==SubsystemLifecycle.ACTIVE&&[AuthorityPermission.PROPOSE_CANONICAL_MUTATION,AuthorityPermission.AFFECT_FOREGROUND].includes(action))return{allowed:false,code:FrameworkFailureCode.LIFECYCLE_AUTHORITY_BLOCKED,lifecycleState:m.lifecycleState};
    const allowed=m.authorityPermissions.includes(action);return{allowed,code:allowed?null:FrameworkFailureCode.UNDECLARED_AUTHORITY,lifecycleState:m.lifecycleState};
  }
  routeResult(id,result={}){
    const m=this.#services.get(id);if(!m)return{accepted:false,code:'UNKNOWN_SERVICE',destination:'EVALUATION'};
    if([SubsystemLifecycle.EXPERIMENTAL,SubsystemLifecycle.SHADOW].includes(m.lifecycleState))return{accepted:true,destination:'EVALUATION',canonicalMutationAllowed:false,foregroundAllowed:false,requiresSettlement:true,requiresContextSeal:true};
    if(m.lifecycleState===SubsystemLifecycle.DEPRECATED)return{accepted:false,code:'DEPRECATED_SERVICE',destination:'EVALUATION',canonicalMutationAllowed:false,foregroundAllowed:false};
    const foreground=result.destination==='FOREGROUND';const fg=foreground?this.authorize(id,AuthorityPermission.AFFECT_FOREGROUND):{allowed:true};return{accepted:!foreground||fg.allowed,destination:foreground&&fg.allowed?'FOREGROUND':foreground?'EVALUATION':result.destination??'BACKGROUND',canonicalMutationAllowed:false,foregroundAllowed:Boolean(fg.allowed),requiresSettlement:true,requiresContextSeal:true};
  }
}
