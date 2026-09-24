import {AuthorityClass} from './contracts.js';
import {CandidateTruthStatus} from './candidate-bus-contracts.js';
import {stableHash} from './browser-runtime-utils.js';

const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()))].sort();
const req=(v,n)=>{if(typeof v!=='string'||!v.trim())throw new RetrievalIndexContractError('INDEX_FIELD_REQUIRED',n+' must be a non-empty string',{field:n});return v.trim();};
const pos=(v,n)=>{const x=Number(v);if(!Number.isInteger(x)||x<1)throw new RetrievalIndexContractError('INDEX_FIELD_INVALID',n+' must be a positive integer',{field:n});return x;};
function freezeDeep(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))freezeDeep(x);Object.freeze(v);}return v;}
const frozen=(v)=>freezeDeep(clone(v));

export const RETRIEVAL_INDEX_CONTRACT_VERSION='1.0.0';
export const REPRESENTATION_PROVIDER_CONTRACT_VERSION='1.0.0';

export const RetrievalIndexFamily=Object.freeze({
  SPARSE:'SPARSE',DENSE:'DENSE',LATE_INTERACTION:'LATE_INTERACTION',SPECIALIZED:'SPECIALIZED',
});
export const IndexResidencyState=Object.freeze({
  ACTIVE:'ACTIVE',INVALIDATED:'INVALIDATED',TOMBSTONED:'TOMBSTONED',MISSING:'MISSING',ORPHAN:'ORPHAN',STALE:'STALE',TORN:'TORN',
});
export const IndexLifecycleOperation=Object.freeze({
  INSERT:'INSERT',UPDATE:'UPDATE',REINDEX:'REINDEX',DELETE:'DELETE',TOMBSTONE:'TOMBSTONE',INVALIDATE:'INVALIDATE',
  REBUILD:'REBUILD',COMPACT:'COMPACT',VERIFY:'VERIFY',MIGRATE:'MIGRATE',
});
export const IndexVerifyStatus=Object.freeze({
  FRESH:'FRESH',STALE:'STALE',MISSING:'MISSING',ORPHAN:'ORPHAN',WRONG_REVISION:'WRONG_REVISION',
  TOMBSTONED:'TOMBSTONED',INVALIDATED:'INVALIDATED',ADAPTER_VERSION_MISMATCH:'ADAPTER_VERSION_MISMATCH',TORN:'TORN',
});

const FAMILIES=new Set(Object.values(RetrievalIndexFamily));
const RESIDENCY=new Set(Object.values(IndexResidencyState));
const OPERATIONS=new Set(Object.values(IndexLifecycleOperation));
const VERIFY=new Set(Object.values(IndexVerifyStatus));
const AUTHORITY=new Set([...Object.values(AuthorityClass),'UNKNOWN','DERIVED']);
const TRUTH=new Set(Object.values(CandidateTruthStatus));

export class RetrievalIndexContractError extends Error{
  constructor(code,message,details={}){super(message);this.name='RetrievalIndexContractError';this.code=code;this.details=clone(details);}
}

export function createOwnerRetrievalArtifact({
  artifactId,artifactRevision,artifactType='UNKNOWN',sourceId,sourceRevision,claimRefs=[],eventRefs=[],entityRefs=[],relationshipRefs=[],
  authorityClass='UNKNOWN',truthStatusHint=CandidateTruthStatus.UNKNOWN,provenanceRefs=[],dependencyInvalidators=[],
  semanticKey=null,text=null,metadata={},
}={}){
  if(!AUTHORITY.has(authorityClass))throw new RetrievalIndexContractError('INDEX_AUTHORITY_INVALID','unsupported authority: '+authorityClass);
  if(!TRUTH.has(truthStatusHint))throw new RetrievalIndexContractError('INDEX_TRUTH_STATUS_INVALID','unsupported truth status: '+truthStatusHint);
  return frozen({
    kind:'OwnerRetrievalArtifact',contractVersion:RETRIEVAL_INDEX_CONTRACT_VERSION,
    artifactId:req(artifactId,'OwnerRetrievalArtifact.artifactId'),artifactRevision:pos(artifactRevision,'OwnerRetrievalArtifact.artifactRevision'),
    artifactType:req(artifactType,'OwnerRetrievalArtifact.artifactType'),sourceId:req(sourceId,'OwnerRetrievalArtifact.sourceId'),
    sourceRevision:req(sourceRevision,'OwnerRetrievalArtifact.sourceRevision'),claimRefs:uniq(claimRefs),eventRefs:uniq(eventRefs),
    entityRefs:uniq(entityRefs),relationshipRefs:uniq(relationshipRefs),authorityClass,truthStatusHint,
    provenanceRefs:uniq(provenanceRefs),dependencyInvalidators:uniq(dependencyInvalidators),semanticKey:semanticKey==null?null:String(semanticKey),
    text:text==null?null:String(text),metadata:clone(metadata??{}),
  });
}

export function stableRepresentationId({adapterId,indexFamily,artifactId,semanticKey=null,claimRefs=[],eventRefs=[]}={}){
  return 'representation:'+stableHash({adapterId,indexFamily,artifactId,semanticKey,claimRefs:uniq(claimRefs),eventRefs:uniq(eventRefs)},{length:32});
}

export function createIndexedArtifactRepresentation({
  representationId,representationRevision,indexFamily,ownerArtifactId,ownerArtifactRevision,sourceId,sourceRevision,
  entityRefs=[],conceptRefs=[],claimRefs=[],eventRefs=[],relationshipRefs=[],authorityClass='UNKNOWN',
  truthStatusHint=CandidateTruthStatus.UNKNOWN,provenanceRefs=[],dependencyInvalidators=[],indexAdapter,indexVersion,
  residencyState=IndexResidencyState.ACTIVE,representationData=null,representationText=null,semanticKey=null,metadata={},
}={}){
  if(!FAMILIES.has(indexFamily))throw new RetrievalIndexContractError('INDEX_FAMILY_INVALID','unsupported index family: '+indexFamily);
  if(!RESIDENCY.has(residencyState))throw new RetrievalIndexContractError('INDEX_RESIDENCY_INVALID','unsupported residency state: '+residencyState);
  if(!AUTHORITY.has(authorityClass))throw new RetrievalIndexContractError('INDEX_AUTHORITY_INVALID','unsupported authority: '+authorityClass);
  if(!TRUTH.has(truthStatusHint))throw new RetrievalIndexContractError('INDEX_TRUTH_STATUS_INVALID','unsupported truth status: '+truthStatusHint);
  return frozen({
    kind:'IndexedArtifactRepresentation',contractVersion:RETRIEVAL_INDEX_CONTRACT_VERSION,
    representationId:req(representationId,'IndexedArtifactRepresentation.representationId'),
    representationRevision:pos(representationRevision,'IndexedArtifactRepresentation.representationRevision'),
    indexFamily,ownerArtifactId:req(ownerArtifactId,'IndexedArtifactRepresentation.ownerArtifactId'),
    ownerArtifactRevision:pos(ownerArtifactRevision,'IndexedArtifactRepresentation.ownerArtifactRevision'),
    sourceId:req(sourceId,'IndexedArtifactRepresentation.sourceId'),sourceRevision:req(sourceRevision,'IndexedArtifactRepresentation.sourceRevision'),
    entityRefs:uniq(entityRefs),conceptRefs:uniq(conceptRefs),claimRefs:uniq(claimRefs),eventRefs:uniq(eventRefs),relationshipRefs:uniq(relationshipRefs),
    authorityClass,truthStatusHint,provenanceRefs:uniq(provenanceRefs),dependencyInvalidators:uniq(dependencyInvalidators),
    indexAdapter:req(indexAdapter,'IndexedArtifactRepresentation.indexAdapter'),indexVersion:req(indexVersion,'IndexedArtifactRepresentation.indexVersion'),
    residencyState,representationData:clone(representationData),representationText:representationText==null?null:String(representationText),
    semanticKey:semanticKey==null?null:String(semanticKey),metadata:clone(metadata??{}),
    authorityGranted:false,settlementAuthority:false,canonicalMutationAuthority:false,derivedRepresentation:true,
  });
}

export function createIndexLifecycleReceipt({
  receiptId,operation,artifactId=null,adapterId=null,beforeRevision=null,afterRevision=null,representationIds=[],
  affectedRepresentationIds=[],preservedRepresentationIds=[],status='APPLIED',reason=null,transactionId=null,details={},
}={}){
  if(!OPERATIONS.has(operation))throw new RetrievalIndexContractError('INDEX_OPERATION_INVALID','unsupported lifecycle operation: '+operation);
  return frozen({
    kind:'IndexLifecycleReceipt',contractVersion:RETRIEVAL_INDEX_CONTRACT_VERSION,receiptId:req(receiptId,'IndexLifecycleReceipt.receiptId'),
    operation,artifactId:artifactId==null?null:String(artifactId),adapterId:adapterId==null?null:String(adapterId),
    beforeRevision:beforeRevision==null?null:Number(beforeRevision),afterRevision:afterRevision==null?null:Number(afterRevision),
    representationIds:uniq(representationIds),affectedRepresentationIds:uniq(affectedRepresentationIds),
    preservedRepresentationIds:uniq(preservedRepresentationIds),status:req(status,'IndexLifecycleReceipt.status'),
    reason:reason==null?null:String(reason),transactionId:transactionId==null?null:String(transactionId),details:clone(details??{}),
    authorityGranted:false,settlementAuthority:false,
  });
}

export function createIndexVerifyReceipt({
  verificationId,adapterId,indexVersion,statusCounts={},entries=[],tornArtifacts=[],missingArtifacts=[],orphanRepresentationIds=[],
  checkedAtRevision=null,details={},
}={}){
  for(const row of entries??[])if(!VERIFY.has(row.status))throw new RetrievalIndexContractError('INDEX_VERIFY_STATUS_INVALID','unsupported verify status: '+row.status);
  return frozen({
    kind:'IndexVerifyReceipt',contractVersion:RETRIEVAL_INDEX_CONTRACT_VERSION,
    verificationId:req(verificationId,'IndexVerifyReceipt.verificationId'),adapterId:req(adapterId,'IndexVerifyReceipt.adapterId'),
    indexVersion:req(indexVersion,'IndexVerifyReceipt.indexVersion'),statusCounts:clone(statusCounts??{}),entries:clone(entries??[]),
    tornArtifacts:uniq(tornArtifacts),missingArtifacts:uniq(missingArtifacts),orphanRepresentationIds:uniq(orphanRepresentationIds),
    checkedAtRevision:checkedAtRevision==null?null:Number(checkedAtRevision),details:clone(details??{}),
    authorityGranted:false,settlementAuthority:false,
  });
}

export function validateIndexAdapter(adapter){
  if(!adapter||typeof adapter!=='object')throw new RetrievalIndexContractError('INDEX_ADAPTER_INVALID','index adapter must be an object');
  for(const method of ['putRepresentation','invalidateRepresentation','tombstoneRepresentation','query','verify','rebuild','compact'])
    if(typeof adapter[method]!=='function')throw new RetrievalIndexContractError('INDEX_ADAPTER_INVALID','index adapter missing '+method+'()');
  if(!FAMILIES.has(adapter.indexFamily))throw new RetrievalIndexContractError('INDEX_FAMILY_INVALID','adapter has unsupported indexFamily: '+adapter.indexFamily);
  req(adapter.adapterId,'IndexAdapter.adapterId');req(adapter.indexVersion,'IndexAdapter.indexVersion');
  return true;
}
