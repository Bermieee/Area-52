import {CompatibilityStatus,FrameworkFailureCode} from './framework-contracts.js';
import {FrameworkError,clone,equal,req} from './framework-utils.js';

export function parseContractVersion(value){
  if(typeof value!=='string'||!/^\d+(?:\.\d+){0,2}$/.test(value))return null;
  const [major=0,minor=0,patch=0]=value.split('.').map(Number);return{raw:value,major,minor,patch};
}
const cmp=(a,b)=>a.major-b.major||a.minor-b.minor||a.patch-b.patch;
const key=(a,b)=>`${a}->${b}`;
const DEFAULT_PROTECTED=['artifactId','id','eventId','subsystemId','owner','producer','authority','authorityPermissions','provenance','revision','temporal','temporalStatus','status','sourceRevisionSet','sourceRevisionIds','worldRevision','sceneRevision','turnId','taskId','causationId','correlationId','dedupeIdentity'];

export class ContractVersionRegistry{
  #contracts=new Map();
  registerContract({contractId,currentVersion,supportedVersions=[],deprecatedVersions=[],validate=()=>true,preserveFields=DEFAULT_PROTECTED}={}){
    req(contractId,'contractId');const current=parseContractVersion(currentVersion);if(!current)throw new TypeError(`Invalid currentVersion: ${currentVersion}`);
    const supported=new Set([currentVersion,...supportedVersions]);for(const v of supported)if(!parseContractVersion(v))throw new TypeError(`Invalid supported version: ${v}`);
    this.#contracts.set(contractId,{contractId,currentVersion,supported,deprecated:new Set(deprecatedVersions),validate,migrations:new Map(),preserveFields:[...preserveFields]});return this.describe(contractId);
  }
  registerMigration(contractId,{fromVersion,toVersion,migrate,validate=null}){
    const c=this.#contracts.get(contractId);if(!c)throw new FrameworkError('UNKNOWN_CONTRACT',`Unknown contract: ${contractId}`);
    if(!parseContractVersion(fromVersion)||!parseContractVersion(toVersion)||typeof migrate!=='function')throw new TypeError('migration requires valid versions and migrate function');
    c.migrations.set(key(fromVersion,toVersion),{fromVersion,toVersion,migrate,validate});return this.describe(contractId);
  }
  describe(contractId){const c=this.#contracts.get(contractId);return c?{contractId:c.contractId,currentVersion:c.currentVersion,supportedVersions:[...c.supported].sort(),deprecatedVersions:[...c.deprecated].sort(),migrations:[...c.migrations.keys()].sort()}:null;}
  compatibility(contractId,version){
    const c=this.#contracts.get(contractId);if(!c)throw new FrameworkError('UNKNOWN_CONTRACT',`Unknown contract: ${contractId}`);
    const v=parseContractVersion(version),current=parseContractVersion(c.currentVersion);if(!v)return{status:CompatibilityStatus.INVALID_VERSION,contractId,version};
    if(version===c.currentVersion)return{status:CompatibilityStatus.EXACT,contractId,version,currentVersion:c.currentVersion};
    if(cmp(v,current)===0)return{status:CompatibilityStatus.COMPATIBLE,contractId,version,currentVersion:c.currentVersion};
    if(c.deprecated.has(version))return{status:CompatibilityStatus.DEPRECATED,contractId,version,currentVersion:c.currentVersion};
    if(c.supported.has(version)||v.major===current.major&&cmp(v,current)<0)return{status:CompatibilityStatus.COMPATIBLE,contractId,version,currentVersion:c.currentVersion};
    if(cmp(v,current)>0)return{status:CompatibilityStatus.UNSUPPORTED_FUTURE,contractId,version,currentVersion:c.currentVersion};
    const path=this.#migrationPath(c,version,c.currentVersion);return{status:path?CompatibilityStatus.MIGRATION_REQUIRED:CompatibilityStatus.INCOMPATIBLE,contractId,version,currentVersion:c.currentVersion,path:path?.map(x=>[x.fromVersion,x.toVersion])??[]};
  }
  migrate(contractId,value,{fromVersion,toVersion=null}={}){
    const c=this.#contracts.get(contractId);if(!c)throw new FrameworkError('UNKNOWN_CONTRACT',`Unknown contract: ${contractId}`);
    const target=toVersion??c.currentVersion;const path=this.#migrationPath(c,fromVersion,target);if(!path)throw new FrameworkError(FrameworkFailureCode.MIGRATION_MISSING,`No migration path for ${contractId} ${fromVersion} -> ${target}`);
    const original=clone(value);let current=clone(value);
    for(const step of path){
      current=step.migrate(clone(current));
      if(!current||typeof current!=='object')throw new FrameworkError(FrameworkFailureCode.MIGRATION_OUTPUT_INVALID,`Migration ${step.fromVersion} -> ${step.toVersion} returned invalid output`);
      if(step.validate&&step.validate(current)!==true)throw new FrameworkError(FrameworkFailureCode.MIGRATION_OUTPUT_INVALID,`Migration ${step.fromVersion} -> ${step.toVersion} failed validation`);
      current.schemaVersion=step.toVersion;
    }
    for(const field of c.preserveFields){if(field in original&&!equal(original[field],current[field]))throw new FrameworkError(FrameworkFailureCode.MIGRATION_PROTECTED_FIELD_CHANGED,`Migration changed protected field ${field}`,{field});}
    if(c.validate(current)!==true)throw new FrameworkError(FrameworkFailureCode.MIGRATION_OUTPUT_INVALID,`Migrated ${contractId} failed current validation`);
    return current;
  }
  #migrationPath(c,from,to){
    if(from===to)return[];const queue=[{v:from,path:[]}],seen=new Set([from]);
    while(queue.length){const row=queue.shift();for(const step of c.migrations.values()){if(step.fromVersion!==row.v||seen.has(step.toVersion))continue;const path=[...row.path,step];if(step.toVersion===to)return path;seen.add(step.toVersion);queue.push({v:step.toVersion,path});}}
    return null;
  }
}
