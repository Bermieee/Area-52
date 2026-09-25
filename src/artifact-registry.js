import {CompatibilityStatus,FrameworkFailureCode,createArtifactEnvelope} from './framework-contracts.js';
import {ContractVersionRegistry} from './contract-versioning.js';
import {FrameworkError,clone,req} from './framework-utils.js';

export const BuiltInArtifactTypes=Object.freeze(['Claim','Reflection','Experience','SceneEpisode','Hypothesis','CausalRelation','OntologyConcept','RetrievalRepresentation','CompiledArtifact']);
export class ArtifactTypeRegistry{
  #types=new Map();
  constructor({versionRegistry=null,registerBuiltIns=true}={}){
    this.versionRegistry=versionRegistry??new ContractVersionRegistry();
    if(registerBuiltIns)for(const artifactType of BuiltInArtifactTypes)this.registerType({artifactType,owner:'COGNITIVE_KERNEL',schemaVersion:'1.0.0'});
  }
  registerType({artifactType,schemaVersion='1.0.0',owner='UNOWNED',repositoryDomain='artifacts',validatePayload=()=>true,allowedAuthorities=null}={}){
    req(artifactType,'artifactType');if(this.#types.has(artifactType))throw new FrameworkError('DUPLICATE_ARTIFACT_TYPE',`Artifact type already registered: ${artifactType}`);
    if(typeof validatePayload!=='function')throw new TypeError('validatePayload must be a function');
    const contractId=`artifact:${artifactType}`;this.versionRegistry.registerContract({contractId,currentVersion:schemaVersion,validate:(envelope)=>Boolean(validatePayload(envelope.payload,envelope))});
    const spec={artifactType,schemaVersion,owner,repositoryDomain,validatePayload,allowedAuthorities:allowedAuthorities?[...allowedAuthorities]:null,contractId};this.#types.set(artifactType,spec);return this.inspect(artifactType);
  }
  unregisterType(artifactType){this.#types.delete(artifactType);}
  has(artifactType){return this.#types.has(artifactType);}
  inspect(artifactType){const s=this.#types.get(artifactType);return s?{artifactType:s.artifactType,schemaVersion:s.schemaVersion,owner:s.owner,repositoryDomain:s.repositoryDomain,allowedAuthorities:s.allowedAuthorities?clone(s.allowedAuthorities):null,authorityGranted:false,settlementAuthority:false,contextSealBypass:false}:null;}
  list(){return[...this.#types.keys()].sort().map(x=>this.inspect(x));}
  registerMigration(artifactType,migration){const s=this.#types.get(artifactType);if(!s)throw new FrameworkError(FrameworkFailureCode.UNKNOWN_ARTIFACT_TYPE,`Unknown artifact type: ${artifactType}`);return this.versionRegistry.registerMigration(s.contractId,migration);}
  validateEnvelope(input,{migrate=true}={}){
    let envelope;try{envelope=input?.kind==='ArtifactEnvelope'?clone(input):createArtifactEnvelope(input);}catch(error){return{ok:false,code:'ARTIFACT_ENVELOPE_INVALID',error:String(error.message??error)}}
    const spec=this.#types.get(envelope.artifactType);if(!spec)return{ok:false,code:FrameworkFailureCode.UNKNOWN_ARTIFACT_TYPE,envelope};
    const compatibility=this.versionRegistry.compatibility(spec.contractId,envelope.schemaVersion);
    if(compatibility.status===CompatibilityStatus.MIGRATION_REQUIRED&&migrate){try{envelope=this.versionRegistry.migrate(spec.contractId,envelope,{fromVersion:envelope.schemaVersion});}catch(error){return{ok:false,code:error.code??FrameworkFailureCode.ARTIFACT_VERSION_INCOMPATIBLE,error:String(error.message??error),envelope};}}
    else if(![CompatibilityStatus.EXACT,CompatibilityStatus.COMPATIBLE,CompatibilityStatus.DEPRECATED].includes(compatibility.status))return{ok:false,code:FrameworkFailureCode.ARTIFACT_VERSION_INCOMPATIBLE,compatibility,envelope};
    if(spec.allowedAuthorities&&!spec.allowedAuthorities.includes(envelope.authority))return{ok:false,code:FrameworkFailureCode.UNDECLARED_AUTHORITY,envelope};
    let valid=false;try{valid=spec.validatePayload(envelope.payload,envelope)===true;}catch{}if(!valid)return{ok:false,code:FrameworkFailureCode.ARTIFACT_PAYLOAD_INVALID,envelope};
    return{ok:true,envelope,routing:{repositoryDomain:spec.repositoryDomain,validator:spec.artifactType},compatibility,authorityGranted:false};
  }
}
