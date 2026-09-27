import {AuthorityClass,MEMORY_LIMITS,deepClone,stableHash,stableStringify,uniqStrings} from './memory-contracts.js';

export const MEMORY_PLASTICITY_VERSION='1.1.0';
export const MemoryMaturityStage=Object.freeze({
  FRESH_DERIVED:'FRESH_DERIVED',
  EPISODIC:'EPISODIC',
  SUPPORTED_PATTERN:'SUPPORTED_PATTERN',
  REFLECTION:'REFLECTION',
  DURABLE_LEARNED:'DURABLE_LEARNED',
});
export const MemoryReorganizationKind=Object.freeze({
  SPLIT:'SPLIT',
  MERGE:'MERGE',
  PROMOTE_REPRESENTATION:'PROMOTE_REPRESENTATION',
});
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const keyOf=(id,rev)=>String(id)+'@'+String(Number(rev)||1);
const refs=(a,key,limit)=>uniqStrings(a?.[key]??[],limit);
const pairKey=(left,right)=>[left,right].sort().join('<->');
const artifactRefKey=(value)=>typeof value==='string'?value:keyOf(value?.artifactId??value?.id,value?.artifactRevision??value?.revision??1);
const artifactRefLimits=(artifact)=>{
  const type=String(artifact?.artifactType??artifact?.kind??'').toUpperCase();
  const summary=type.includes('SUMMARY')||type==='MEMORYSUMMARYARTIFACT';
  return summary
    ? {evidence:MEMORY_LIMITS.maxSummaryEvidenceRefs,source:MEMORY_LIMITS.maxSummarySourceRevisionRefs}
    : {evidence:MEMORY_LIMITS.maxEvidenceRefsPerArtifact,source:MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact};
};

export class MemoryPlasticityManager{
  constructor({graph,snapshot=null,maxRecords=4096,maxAssociations=4096,maxReceipts=128,maxProposals=256}={}){
    if(!graph)throw new TypeError('MemoryPlasticityManager requires graph');
    this.graph=graph;this.maxRecords=maxRecords;this.maxAssociations=maxAssociations;this.maxReceipts=maxReceipts;this.maxProposals=maxProposals;
    this.records=new Map();this.currentByArtifact=new Map();this.associations=new Map();this.reorganizationProposals=[];this.receipts=[];this.sequence=0;
    if(snapshot)this.restore(snapshot);
  }
  observeArtifact(artifact,{rebuildable=true}={}){
    if(!artifact?.id)return null;
    const id=String(artifact.id),revision=Math.max(1,Number(artifact.revision)||1),key=keyOf(id,revision);
    const priorKey=this.currentByArtifact.get(id),prior=priorKey?this.records.get(priorKey):null;
    if(prior&&prior.key!==key){prior.current=false;if(prior.residency!=='EVICTED')prior.residency='HISTORICAL';}
    const limits=artifactRefLimits(artifact);
    const evidenceRefs=uniqStrings([...(artifact.evidenceRefs??[]),...(artifact.supportEvidenceRefs??[]),...(artifact.exactEvidenceRefs??[])],limits.evidence);
    const sourceRevisionRefs=uniqStrings([...(artifact.sourceRevisionRefs??[]),...(artifact.exactSourceRevisionSet??[])],limits.source);
    const row=this.records.get(key)??{
      kind:'MemoryPlasticityRecord',contractVersion:MEMORY_PLASTICITY_VERSION,key,artifactId:id,artifactRevision:revision,
      artifactType:String(artifact.artifactType??artifact.kind??'DERIVED_MEMORY'),authorityClass:String(artifact.authorityClass??AuthorityClass.DERIVED),
      rebuildable:Boolean(rebuildable),retrievalUses:0,acceptedUses:0,rejectedUses:0,eligibleForReconsolidation:false,
      strength:.25,maturity:.1,maturityStage:MemoryMaturityStage.FRESH_DERIVED,residency:'ACTIVE',current:true,stale:false,createdSequence:++this.sequence,
    };
    row.evidenceRefs=evidenceRefs;row.supportEvidenceRefs=evidenceRefs;
    row.contradictionEvidenceRefs=refs(artifact,'contradictionEvidenceRefs',128);row.sourceRevisionRefs=sourceRevisionRefs;
    row.current=true;row.stale=Boolean(artifact.freshness&&artifact.freshness!=='FRESH');row.updatedSequence=++this.sequence;
    row.maturityStage=row.maturityStage??this.#maturityStage(row,0);
    this.records.set(key,row);this.currentByArtifact.set(id,key);this.#trim();return deepClone(row);
  }
  recordRetrievalUse({artifactId,artifactRevision=1,accepted=false,rejected=false}={}){
    const id=String(artifactId??''),row=this.records.get(keyOf(id,artifactRevision))??this.records.get(this.currentByArtifact.get(id));
    if(!row)return{kind:'MemoryPlasticityUseReceipt',status:'ABSENT',artifactId:id,supportAdded:false,authorityChanged:false};
    row.retrievalUses+=1;row.acceptedUses+=accepted?1:0;row.rejectedUses+=rejected?1:0;row.eligibleForReconsolidation=true;row.updatedSequence=++this.sequence;
    return this.#receipt({kind:'MemoryPlasticityUseReceipt',status:'RECORDED',artifactId:row.artifactId,artifactRevision:row.artifactRevision,
      retrievalUses:row.retrievalUses,acceptedUses:row.acceptedUses,rejectedUses:row.rejectedUses,supportAdded:false,authorityChanged:false,authorityClass:row.authorityClass});
  }
  recordCoRetrieval({artifactRefs=[],acceptedArtifactIds=[],rejectedArtifactIds=[],reasonCode='CO_RETRIEVED'}={}){
    const keys=[...new Set((artifactRefs??[]).map(artifactRefKey).filter(Boolean))].sort().slice(0,32);
    const accepted=new Set((acceptedArtifactIds??[]).map(String)),rejected=new Set((rejectedArtifactIds??[]).map(String));
    const touched=[];
    for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++){
      const left=keys[i],right=keys[j],leftId=this.records.get(left)?.artifactId??left,rightId=this.records.get(right)?.artifactId??right,key=pairKey(left,right);
      const row=this.associations.get(key)??{kind:'MemoryDerivedAssociation',contractVersion:MEMORY_PLASTICITY_VERSION,key,artifactRefs:[left,right],retrievalUses:0,usefulUses:0,rejectedUses:0,
        strength:.2,eligibleForReconsolidation:false,current:true,createdSequence:++this.sequence};
      row.retrievalUses+=1;
      if(accepted.has(leftId)&&accepted.has(rightId))row.usefulUses+=1;
      if(rejected.has(leftId)||rejected.has(rightId))row.rejectedUses+=1;
      row.eligibleForReconsolidation=true;row.reasonCode=String(reasonCode);row.updatedSequence=++this.sequence;
      this.associations.set(key,row);touched.push(key);
    }
    this.#trimAssociations();
    return this.#receipt({kind:'MemoryCoRetrievalReceipt',status:keys.length>1?'RECORDED':'SKIPPED',reasonCode:keys.length>1?String(reasonCode):'INSUFFICIENT_ARTIFACTS',
      associationKeys:touched,supportAdded:false,authorityChanged:false,retrievalUseIsEvidence:false});
  }
  nominationPriority(artifactId,artifactRevision=null){
    const id=String(artifactId??''),row=artifactRevision==null?this.records.get(this.currentByArtifact.get(id)):this.records.get(keyOf(id,artifactRevision));
    if(!row)return 1;
    if(row.stale||row.residency==='EVICTED'||row.residency==='REBUILD_REQUIRED')return 0;
    if(!row.retrievalUses)return row.residency==='DEMOTED'?.55:1;
    let multiplier=1+Math.min(.12,row.acceptedUses*.025)-Math.min(.65,row.rejectedUses*.08);
    if(row.residency==='DEMOTED')multiplier=Math.min(multiplier,.55);
    if(row.strength<.2)multiplier=Math.min(multiplier,.7);
    return clamp(multiplier,.25,1.15);
  }
  association(leftArtifactId,rightArtifactId,leftRevision=null,rightRevision=null){
    const left=leftRevision==null?this.currentByArtifact.get(String(leftArtifactId)):keyOf(leftArtifactId,leftRevision);
    const right=rightRevision==null?this.currentByArtifact.get(String(rightArtifactId)):keyOf(rightArtifactId,rightRevision);
    if(!left||!right)return null;
    const row=this.associations.get(pairKey(left,right));return row?deepClone(row):null;
  }
  proposeReorganization({operation,artifactRefs=[],targetKeys=[],reasonCode='RECONSOLIDATION_REORGANIZATION'}={}){
    const kind=String(operation??'').toUpperCase();
    if(!Object.values(MemoryReorganizationKind).includes(kind))throw new Error('MEMORY_REORGANIZATION_KIND_UNSUPPORTED:'+kind);
    const refsNormalized=[...new Set((artifactRefs??[]).map(artifactRefKey).filter(Boolean))].sort().slice(0,32);
    const minimum=kind===MemoryReorganizationKind.MERGE?2:1;
    if(refsNormalized.length<minimum)throw new Error('MEMORY_REORGANIZATION_INPUT_INSUFFICIENT');
    const rows=refsNormalized.map(ref=>this.records.get(ref)).filter(Boolean);
    if(rows.length!==refsNormalized.length||rows.some(row=>!row.current||row.stale))throw new Error('MEMORY_REORGANIZATION_INPUT_STALE');
    const sourceRevisionPool=uniqStrings(rows.flatMap(row=>row.sourceRevisionRefs??[]),MEMORY_LIMITS.maxSummarySourceRevisionRefs);
    const evidencePool=uniqStrings(rows.flatMap(row=>row.evidenceRefs??[]),MEMORY_LIMITS.maxSummaryEvidenceRefs);
    const proposal={
      kind:'MemoryDerivedReorganizationProposal',contractVersion:MEMORY_PLASTICITY_VERSION,
      proposalId:'memory-reorganization:'+stableHash(stableStringify([kind,refsNormalized,targetKeys,++this.sequence])),
      operation:kind,artifactRefs:refsNormalized,targetKeys:uniqStrings(targetKeys,32),reasonCode:String(reasonCode),status:'PROPOSED',
      sourceRevisionRefs:sourceRevisionPool.slice(0,128),sourceRevisionRefCount:sourceRevisionPool.length,sourceRevisionRefsTruncated:sourceRevisionPool.length>128,
      evidenceRefs:evidencePool.slice(0,256),evidenceRefCount:evidencePool.length,evidenceRefsTruncated:evidencePool.length>256,
      authorityClasses:[...new Set(rows.map(row=>row.authorityClass))].sort(),
      retrievalFeedbackIsEvidence:false,canonicalMutationAuthority:false,settlementAuthority:false,ownerAdmissionRequired:true,createdSequence:this.sequence,
    };
    this.reorganizationProposals.push(proposal);
    if(this.reorganizationProposals.length>this.maxProposals)this.reorganizationProposals.splice(0,this.reorganizationProposals.length-this.maxProposals);
    return this.#receipt(proposal);
  }
  recoverArtifact({artifactId,artifactRevision=null,reasonCode='DERIVED_REPRESENTATION_REBUILT'}={}){
    const id=String(artifactId??''),row=artifactRevision==null?this.records.get(this.currentByArtifact.get(id)):this.records.get(keyOf(id,artifactRevision));
    if(!row)return this.#receipt({kind:'MemoryPlasticityRecoveryReceipt',status:'ABSENT',artifactId:id,reasonCode:'ARTIFACT_ABSENT'});
    if(!row.rebuildable||row.stale)return this.#receipt({kind:'MemoryPlasticityRecoveryReceipt',status:'REJECTED',artifactId:id,artifactRevision:row.artifactRevision,reasonCode:row.stale?'SOURCE_REVISION_STALE':'ARTIFACT_NOT_REBUILDABLE'});
    const priorResidency=row.residency;row.residency='ACTIVE';row.eligibleForReconsolidation=true;row.updatedSequence=++this.sequence;
    return this.#receipt({kind:'MemoryPlasticityRecoveryReceipt',status:'RECOVERED',artifactId:id,artifactRevision:row.artifactRevision,priorResidency,residency:row.residency,reasonCode:String(reasonCode),
      evidencePreserved:true,sourceHistoryPreserved:true,authorityChanged:false});
  }
  reconsolidate({maxUnits=8}={}){
    const limit=Math.max(1,Math.min(32,Number(maxUnits)||8));
    const work=[
      ...[...this.records.values()].filter(r=>r.current&&r.eligibleForReconsolidation).map(row=>({type:'ARTIFACT',row,sequence:row.updatedSequence})),
      ...[...this.associations.values()].filter(r=>r.current&&r.eligibleForReconsolidation).map(row=>({type:'ASSOCIATION',row,sequence:row.updatedSequence})),
    ].sort((a,b)=>a.sequence-b.sequence).slice(0,limit);
    const outcomes=[];
    for(const item of work){
      const row=item.row;
      if(item.type==='ASSOCIATION'){
        const priorStrength=row.strength;
        row.strength=clamp(.2+Math.min(.5,row.usefulUses*.08)-Math.min(.45,row.rejectedUses*.09),.05,.9);
        row.eligibleForReconsolidation=false;row.updatedSequence=++this.sequence;
        outcomes.push({kind:'MemoryAssociationReconsolidationOutcome',associationKey:row.key,artifactRefs:[...row.artifactRefs],priorStrength,strength:row.strength,
          retrievalUses:row.retrievalUses,usefulUses:row.usefulUses,rejectedUses:row.rejectedUses,retrievalUseCreatedSupport:false,authorityChanged:false});
        continue;
      }
      const support=row.supportEvidenceRefs.map(id=>this.graph.evidenceRecord(id)).filter(ev=>ev&&this.graph.evidenceFresh(ev.id));
      const contradictions=row.contradictionEvidenceRefs.map(id=>this.graph.evidenceRecord(id)).filter(ev=>ev&&this.graph.evidenceFresh(ev.id));
      const independent=new Set(support.map(ev=>ev.sourceRevisionId).filter(Boolean)).size;
      const opposed=new Set(contradictions.map(ev=>ev.sourceRevisionId).filter(Boolean)).size;
      const priorStrength=row.strength,priorMaturity=row.maturity,priorMaturityStage=row.maturityStage,priorResidency=row.residency;
      row.strength=clamp(.2+Math.min(.48,independent*.12)-Math.min(.4,opposed*.16)+Math.min(.12,row.acceptedUses*.02)-Math.min(.2,row.rejectedUses*.04),.05,.95);
      row.maturity=clamp(.1+Math.max(0,independent-1)*.12-Math.min(.36,opposed*.12)+Math.min(.2,row.acceptedUses*.01),.05,.9);
      row.maturityStage=this.#maturityStage(row,independent);
      const value=clamp(row.strength+Math.min(.1,row.acceptedUses*.01)-Math.min(.2,row.rejectedUses*.03),0,1);
      if(row.stale)row.residency='REBUILD_REQUIRED';
      else if(row.rebuildable&&row.retrievalUses>0&&value<.12)row.residency='EVICTED';
      else if(row.rebuildable&&row.retrievalUses>0&&value<.24)row.residency='DEMOTED';
      else row.residency='ACTIVE';
      row.eligibleForReconsolidation=false;row.updatedSequence=++this.sequence;
      outcomes.push({kind:'MemoryArtifactReconsolidationOutcome',artifactId:row.artifactId,artifactRevision:row.artifactRevision,independentSupportCount:independent,contradictionSourceCount:opposed,
        priorStrength,strength:row.strength,priorMaturity,maturity:row.maturity,priorMaturityStage,maturityStage:row.maturityStage,priorResidency,residency:row.residency,
        nominationPriority:this.nominationPriority(row.artifactId,row.artifactRevision),retrievalUseCreatedSupport:false,authorityChanged:false,authorityClass:row.authorityClass});
    }
    return this.#receipt({kind:'MemoryReconsolidationReceipt',status:'COMPLETED',processed:outcomes.length,outcomes,
      rawEvidenceDeleted:false,sourceHistoryDeleted:false,provenanceDeleted:false,canonicalAuthorityGranted:false,revision:this.revisionRef()});
  }
  invalidateSourceRevision(sourceRevisionId,{reason='SOURCE_REVISION_INVALIDATED'}={}){
    const source=String(sourceRevisionId),affected=[];
    for(const row of this.records.values())if(row.current&&row.sourceRevisionRefs.includes(source)){
      row.stale=true;row.eligibleForReconsolidation=true;row.residency='REBUILD_REQUIRED';row.updatedSequence=++this.sequence;affected.push(row.artifactId);
    }
    for(const association of this.associations.values()){
      if(association.artifactRefs.some(ref=>this.records.get(ref)?.sourceRevisionRefs?.includes(source))){association.current=false;association.eligibleForReconsolidation=false;association.updatedSequence=++this.sequence;}
    }
    return this.#receipt({kind:'MemoryPlasticityInvalidationReceipt',sourceRevisionId:source,reason,affectedArtifactIds:[...new Set(affected)].sort(),
      rawEvidenceDeleted:false,historicalVersionsDeleted:false,authorityChanged:false,revision:this.revisionRef()});
  }
  retrievable(artifactId,revision=null){
    const row=revision==null?this.records.get(this.currentByArtifact.get(String(artifactId))):this.records.get(keyOf(artifactId,revision));
    return !row||(!row.stale&&row.residency!=='EVICTED'&&row.residency!=='REBUILD_REQUIRED');
  }
  record(artifactId,revision=null){const row=revision==null?this.records.get(this.currentByArtifact.get(String(artifactId))):this.records.get(keyOf(artifactId,revision));return row?deepClone(row):null;}
  status(){const rows=[...this.records.values()];return{kind:'MemoryPlasticityStatus',recordCount:rows.length,associationCount:this.associations.size,reorganizationProposalCount:this.reorganizationProposals.length,
    active:rows.filter(x=>x.current&&x.residency==='ACTIVE').length,demoted:rows.filter(x=>x.current&&x.residency==='DEMOTED').length,
    evicted:rows.filter(x=>x.current&&x.residency==='EVICTED').length,rebuildRequired:rows.filter(x=>x.current&&x.residency==='REBUILD_REQUIRED').length,revision:this.revisionRef()};}
  revisionRef(){return'memory-plasticity:'+stableHash(stableStringify({
    records:[...this.records.values()].map(r=>[r.key,r.strength,r.maturity,r.maturityStage,r.residency,r.stale,r.updatedSequence]),
    associations:[...this.associations.values()].map(r=>[r.key,r.strength,r.current,r.updatedSequence]),
    proposals:this.reorganizationProposals.map(r=>[r.proposalId,r.operation,r.status]),
  }));}
  snapshot(){return{kind:'MemoryPlasticitySnapshot',contractVersion:MEMORY_PLASTICITY_VERSION,records:[...this.records.entries()].map(([k,v])=>[k,deepClone(v)]),
    currentByArtifact:[...this.currentByArtifact.entries()],associations:[...this.associations.entries()].map(([k,v])=>[k,deepClone(v)]),
    reorganizationProposals:deepClone(this.reorganizationProposals),receipts:deepClone(this.receipts),sequence:this.sequence};}
  restore(s){this.records=new Map((s?.records??[]).map(([k,v])=>[k,deepClone(v)]));this.currentByArtifact=new Map(s?.currentByArtifact??[]);
    this.associations=new Map((s?.associations??[]).map(([k,v])=>[k,deepClone(v)]));this.reorganizationProposals=deepClone(s?.reorganizationProposals??[]).slice(-this.maxProposals);
    this.receipts=deepClone(s?.receipts??[]).slice(-this.maxReceipts);this.sequence=Number(s?.sequence??0);
    for(const row of this.records.values())if(!row.maturityStage)row.maturityStage=this.#maturityStage(row,0);}
  #maturityStage(row,independentSupport){
    const type=String(row.artifactType??'').toUpperCase();
    if(type.includes('REFLECTION'))return independentSupport>=3&&row.maturity>=.4?MemoryMaturityStage.DURABLE_LEARNED:MemoryMaturityStage.REFLECTION;
    if(type.includes('EPISODE')||type.includes('EVENT'))return MemoryMaturityStage.EPISODIC;
    if(independentSupport>=2)return MemoryMaturityStage.SUPPORTED_PATTERN;
    return MemoryMaturityStage.FRESH_DERIVED;
  }
  #receipt(row){const value={contractVersion:MEMORY_PLASTICITY_VERSION,...deepClone(row)};this.receipts.push(value);if(this.receipts.length>this.maxReceipts)this.receipts.splice(0,this.receipts.length-this.maxReceipts);return deepClone(value);}
  #trim(){if(this.records.size<=this.maxRecords)return;for(const [key,row] of this.records){if(row.current)continue;this.records.delete(key);if(this.records.size<=this.maxRecords)break;}}
  #trimAssociations(){if(this.associations.size<=this.maxAssociations)return;for(const [key,row] of this.associations){if(row.current)continue;this.associations.delete(key);if(this.associations.size<=this.maxAssociations)break;}while(this.associations.size>this.maxAssociations)this.associations.delete(this.associations.keys().next().value);}
}
