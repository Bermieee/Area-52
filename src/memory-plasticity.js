import {AuthorityClass,deepClone,stableHash,stableStringify,uniqStrings} from './memory-contracts.js';

export const MEMORY_PLASTICITY_VERSION='1.0.0';
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const keyOf=(id,rev)=>String(id)+'@'+String(Number(rev)||1);
const refs=(a,key,limit)=>uniqStrings(a?.[key]??[],limit);

export class MemoryPlasticityManager{
  constructor({graph,snapshot=null,maxRecords=4096,maxReceipts=128}={}){
    if(!graph)throw new TypeError('MemoryPlasticityManager requires graph');
    this.graph=graph;this.maxRecords=maxRecords;this.maxReceipts=maxReceipts;
    this.records=new Map();this.currentByArtifact=new Map();this.receipts=[];this.sequence=0;
    if(snapshot)this.restore(snapshot);
  }
  observeArtifact(artifact,{rebuildable=true}={}){
    if(!artifact?.id)return null;
    const id=String(artifact.id),revision=Math.max(1,Number(artifact.revision)||1),key=keyOf(id,revision);
    const priorKey=this.currentByArtifact.get(id),prior=priorKey?this.records.get(priorKey):null;
    if(prior&&prior.key!==key){prior.current=false;if(prior.residency!=='EVICTED')prior.residency='HISTORICAL';}
    const evidenceRefs=uniqStrings([...(artifact.evidenceRefs??[]),...(artifact.supportEvidenceRefs??[]),...(artifact.exactEvidenceRefs??[])],128);
    const sourceRevisionRefs=uniqStrings([...(artifact.sourceRevisionRefs??[]),...(artifact.exactSourceRevisionSet??[])],64);
    const row=this.records.get(key)??{
      kind:'MemoryPlasticityRecord',contractVersion:MEMORY_PLASTICITY_VERSION,key,artifactId:id,artifactRevision:revision,
      artifactType:String(artifact.artifactType??artifact.kind??'DERIVED_MEMORY'),authorityClass:String(artifact.authorityClass??AuthorityClass.DERIVED),
      rebuildable:Boolean(rebuildable),retrievalUses:0,acceptedUses:0,rejectedUses:0,eligibleForReconsolidation:false,
      strength:.25,maturity:.1,residency:'ACTIVE',current:true,stale:false,createdSequence:++this.sequence,
    };
    row.evidenceRefs=evidenceRefs;row.supportEvidenceRefs=evidenceRefs;
    row.contradictionEvidenceRefs=refs(artifact,'contradictionEvidenceRefs',128);row.sourceRevisionRefs=sourceRevisionRefs;
    row.current=true;row.stale=Boolean(artifact.freshness&&artifact.freshness!=='FRESH');row.updatedSequence=++this.sequence;
    this.records.set(key,row);this.currentByArtifact.set(id,key);this.#trim();return deepClone(row);
  }
  recordRetrievalUse({artifactId,artifactRevision=1,accepted=false,rejected=false}={}){
    const id=String(artifactId??''),row=this.records.get(keyOf(id,artifactRevision))??this.records.get(this.currentByArtifact.get(id));
    if(!row)return{kind:'MemoryPlasticityUseReceipt',status:'ABSENT',artifactId:id,supportAdded:false,authorityChanged:false};
    row.retrievalUses+=1;row.acceptedUses+=accepted?1:0;row.rejectedUses+=rejected?1:0;row.eligibleForReconsolidation=true;row.updatedSequence=++this.sequence;
    return this.#receipt({kind:'MemoryPlasticityUseReceipt',status:'RECORDED',artifactId:row.artifactId,artifactRevision:row.artifactRevision,
      retrievalUses:row.retrievalUses,acceptedUses:row.acceptedUses,rejectedUses:row.rejectedUses,supportAdded:false,authorityChanged:false,authorityClass:row.authorityClass});
  }
  reconsolidate({maxUnits=8}={}){
    const limit=Math.max(1,Math.min(32,Number(maxUnits)||8));
    const rows=[...this.records.values()].filter(r=>r.current&&r.eligibleForReconsolidation).sort((a,b)=>a.updatedSequence-b.updatedSequence).slice(0,limit);
    const outcomes=[];
    for(const row of rows){
      const support=row.supportEvidenceRefs.map(id=>this.graph.evidenceRecord(id)).filter(ev=>ev&&this.graph.evidenceFresh(ev.id));
      const contradictions=row.contradictionEvidenceRefs.map(id=>this.graph.evidenceRecord(id)).filter(ev=>ev&&this.graph.evidenceFresh(ev.id));
      const independent=new Set(support.map(ev=>ev.sourceRevisionId).filter(Boolean)).size;
      const opposed=new Set(contradictions.map(ev=>ev.sourceRevisionId).filter(Boolean)).size;
      const priorStrength=row.strength,priorMaturity=row.maturity,priorResidency=row.residency;
      row.strength=clamp(.2+Math.min(.48,independent*.12)-Math.min(.4,opposed*.16)+Math.min(.12,row.acceptedUses*.02)-Math.min(.2,row.rejectedUses*.04),.05,.95);
      row.maturity=clamp(.1+Math.max(0,independent-1)*.12-Math.min(.36,opposed*.12)+Math.min(.2,row.retrievalUses*.01),.05,.9);
      const value=clamp(row.strength+Math.min(.1,row.acceptedUses*.01)-Math.min(.2,row.rejectedUses*.03),0,1);
      if(row.stale)row.residency='REBUILD_REQUIRED';
      else if(row.rebuildable&&row.retrievalUses>0&&value<.12)row.residency='EVICTED';
      else if(row.rebuildable&&row.retrievalUses>0&&value<.24)row.residency='DEMOTED';
      else row.residency='ACTIVE';
      row.eligibleForReconsolidation=false;row.updatedSequence=++this.sequence;
      outcomes.push({artifactId:row.artifactId,artifactRevision:row.artifactRevision,independentSupportCount:independent,contradictionSourceCount:opposed,
        priorStrength,strength:row.strength,priorMaturity,maturity:row.maturity,priorResidency,residency:row.residency,
        retrievalUseCreatedSupport:false,authorityChanged:false,authorityClass:row.authorityClass});
    }
    return this.#receipt({kind:'MemoryReconsolidationReceipt',status:'COMPLETED',processed:outcomes.length,outcomes,
      rawEvidenceDeleted:false,sourceHistoryDeleted:false,provenanceDeleted:false,canonicalAuthorityGranted:false,revision:this.revisionRef()});
  }
  invalidateSourceRevision(sourceRevisionId,{reason='SOURCE_REVISION_INVALIDATED'}={}){
    const source=String(sourceRevisionId),affected=[];
    for(const row of this.records.values())if(row.current&&row.sourceRevisionRefs.includes(source)){
      row.stale=true;row.eligibleForReconsolidation=true;row.residency='REBUILD_REQUIRED';row.updatedSequence=++this.sequence;affected.push(row.artifactId);
    }
    return this.#receipt({kind:'MemoryPlasticityInvalidationReceipt',sourceRevisionId:source,reason,affectedArtifactIds:[...new Set(affected)].sort(),
      rawEvidenceDeleted:false,historicalVersionsDeleted:false,authorityChanged:false,revision:this.revisionRef()});
  }
  retrievable(artifactId,revision=null){
    const row=revision==null?this.records.get(this.currentByArtifact.get(String(artifactId))):this.records.get(keyOf(artifactId,revision));
    return !row||(!row.stale&&row.residency!=='EVICTED');
  }
  record(artifactId,revision=null){const row=revision==null?this.records.get(this.currentByArtifact.get(String(artifactId))):this.records.get(keyOf(artifactId,revision));return row?deepClone(row):null;}
  status(){const rows=[...this.records.values()];return{kind:'MemoryPlasticityStatus',recordCount:rows.length,
    active:rows.filter(x=>x.current&&x.residency==='ACTIVE').length,demoted:rows.filter(x=>x.current&&x.residency==='DEMOTED').length,
    evicted:rows.filter(x=>x.current&&x.residency==='EVICTED').length,rebuildRequired:rows.filter(x=>x.current&&x.residency==='REBUILD_REQUIRED').length,revision:this.revisionRef()};}
  revisionRef(){return'memory-plasticity:'+stableHash(stableStringify([...this.records.values()].map(r=>[r.key,r.strength,r.maturity,r.residency,r.stale,r.updatedSequence])));}
  snapshot(){return{kind:'MemoryPlasticitySnapshot',contractVersion:MEMORY_PLASTICITY_VERSION,records:[...this.records.entries()].map(([k,v])=>[k,deepClone(v)]),
    currentByArtifact:[...this.currentByArtifact.entries()],receipts:deepClone(this.receipts),sequence:this.sequence};}
  restore(s){this.records=new Map((s?.records??[]).map(([k,v])=>[k,deepClone(v)]));this.currentByArtifact=new Map(s?.currentByArtifact??[]);
    this.receipts=deepClone(s?.receipts??[]).slice(-this.maxReceipts);this.sequence=Number(s?.sequence??0);}
  #receipt(row){const value={contractVersion:MEMORY_PLASTICITY_VERSION,...deepClone(row)};this.receipts.push(value);if(this.receipts.length>this.maxReceipts)this.receipts.splice(0,this.receipts.length-this.maxReceipts);return deepClone(value);}
  #trim(){if(this.records.size<=this.maxRecords)return;for(const [key,row] of this.records){if(row.current)continue;this.records.delete(key);if(this.records.size<=this.maxRecords)break;}}
}
