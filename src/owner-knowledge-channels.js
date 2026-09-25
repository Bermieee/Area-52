import {
  CandidateFreshness,
  CandidateTruthStatus,
  RetrievalChannelCapability,
  RetrievalChannelHealth,
  createChannelNomination,
  createRetrievalChannelDescriptor,
} from './candidate-bus-contracts.js';
import {
  KnowledgeAuthorityOrigin,
  KnowledgeSourceClass,
  KnowledgeTemporalStatus,
  createKnowledgeEvidence,
  normalizeKnowledgeAuthority,
} from './knowledge-evidence.js';
import {stableHash} from './browser-runtime-utils.js';

const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();
const syncValue=(value,code)=>{if(value&&typeof value.then==='function'){const error=new Error(code);error.code=code;throw error;}return value;};
const provenanceRefs=(values=[])=>uniq(values.map((value)=>typeof value==='string'?value:(value?.ref??value?.sourceRevisionId??value?.id??null)));
const truthStatus=(value)=>{
  const status=String(value??CandidateTruthStatus.UNRESOLVED).toUpperCase();
  return Object.values(CandidateTruthStatus).includes(status)?status:CandidateTruthStatus.UNRESOLVED;
};
const temporalStatus=(value)=>{
  const status=truthStatus(value);
  return Object.values(KnowledgeTemporalStatus).includes(status)?status:KnowledgeTemporalStatus.UNRESOLVED;
};
const memorySourceClass=(channel)=>{
  if(channel==='REFLECTION')return KnowledgeSourceClass.REFLECTION;
  if(channel==='SCENE_EPISODE')return KnowledgeSourceClass.SCENE_EPISODE;
  if(channel==='HISTORICAL_STATE'||channel==='UNRESOLVED_HYPOTHESIS')return KnowledgeSourceClass.TEMPORAL_STATE;
  if(channel==='HIERARCHICAL_SUMMARY')return KnowledgeSourceClass.DERIVED_REPRESENTATION;
  return KnowledgeSourceClass.EPISODIC_MEMORY;
};

class OwnerChannelBase{
  constructor({channelId,capabilities,evidenceSink,maxCandidates=48}={}){
    this.channelId=channelId;
    this.evidenceSink=typeof evidenceSink==='function'?evidenceSink:()=>{};
    this.turnContext=null;
    this.lastReceipt={kind:'OwnerKnowledgeRetrievalReceipt',channelId,status:'NOT_ATTACHED',queried:false,nominationCount:0,sourceRevisionFence:[],authorityGranted:false};
    this.descriptor=createRetrievalChannelDescriptor({
      channelId,
      capabilities,
      supportedIntentKinds:['*'],
      maxCandidates,
      health:RetrievalChannelHealth.HEALTHY,
      available:true,
      metadata:{ownerRevisionFence:true,externalOwnerEvidence:true,admissionAuthority:false,settlementAuthority:false,contextSealAuthority:false},
    });
  }
  beginTurn(context={}){
    this.turnContext=clone(context);
    this.lastReceipt={kind:'OwnerKnowledgeRetrievalReceipt',channelId:this.channelId,status:'PENDING',queried:false,nominationCount:0,sourceRevisionFence:[],authorityGranted:false};
  }
  finalizeSkipped(reason='COGNITIVE_CHOICE_SKIPPED_RETRIEVAL'){
    if(this.lastReceipt?.status!=='PENDING')return clone(this.lastReceipt);
    this.lastReceipt={...this.lastReceipt,status:'SKIPPED',reason,queried:false};
    return clone(this.lastReceipt);
  }
  receipt(){return clone(this.lastReceipt);}
  publishEvidence(evidence){this.evidenceSink(evidence);return evidence;}
}

export class LoreOwnerRetrievalChannel extends OwnerChannelBase{
  constructor({getInterface,evidenceSink,revisionGuard=null,maxCandidates=48}={}){
    super({channelId:'OWNER_LORE',capabilities:[RetrievalChannelCapability.SPARSE,RetrievalChannelCapability.SPECIALIZED_STORE],evidenceSink,maxCandidates});
    this.getInterface=typeof getInterface==='function'?getInterface:()=>null;
    this.revisionGuard=typeof revisionGuard==='function'?revisionGuard:null;
  }

  retrieve(intent,context={}){
    const owner=this.getInterface();
    if(!owner||typeof owner.query!=='function'){
      this.lastReceipt={kind:'OwnerKnowledgeRetrievalReceipt',channelId:this.channelId,status:'NOT_ATTACHED',queried:false,nominationCount:0,sourceRevisionFence:[],authorityGranted:false};
      return[];
    }
    try{
      const packet=syncValue(owner.query({query:intent?.query??context.query??'',intent:intent?.intentKind??'AUTO'}),'LORE_OWNER_ASYNC_UNSUPPORTED_IN_SYNC_FOREGROUND');
      if(!packet||packet.kind!=='LoreBrainRetrievalPacket'||Number(packet.contractVersion)!==1)throw new Error('LORE_BRAIN_PACKET_CONTRACT_MISMATCH');
      const fence=new Set(uniq(packet.sourceRevisionFence??[]));
      const out=[],rejected=[];
      for(const group of packet.nominations??[]){
        for(const source of group?.drillback??[]){
          const sourceId=source?.sourceId==null?null:String(source.sourceId);
          const sourceRevisionId=source?.sourceRevisionId==null?null:String(source.sourceRevisionId);
          const exact=source?.exactAuthoredText;
          if(!sourceId||!sourceRevisionId||typeof exact!=='string'||!exact.trim())continue;
          if(!fence.has(sourceRevisionId)){rejected.push({sourceId,sourceRevisionId,reason:'OWNER_PACKET_REVISION_NOT_FENCED'});continue;}
          let ownerRevision=null;
          if(typeof owner.sourceRevision==='function'){
            try{ownerRevision=syncValue(owner.sourceRevision(sourceId),'LORE_OWNER_SOURCE_REVISION_ASYNC_UNSUPPORTED_IN_SYNC_FOREGROUND');}
            catch(error){rejected.push({sourceId,sourceRevisionId,reason:error?.message??String(error)});continue;}
            if(ownerRevision&&(String(ownerRevision.id??'')!==sourceRevisionId||ownerRevision.state==='REMOVED')){
              rejected.push({sourceId,sourceRevisionId,reason:'OWNER_CURRENT_REVISION_MISMATCH'});continue;
            }
            if(ownerRevision&&typeof ownerRevision.exactContent==='string'&&ownerRevision.exactContent!==exact){
              rejected.push({sourceId,sourceRevisionId,reason:'OWNER_EXACT_SOURCE_MISMATCH'});continue;
            }
          }
          if(this.revisionGuard){
            let guard=null;
            try{guard=this.revisionGuard({sourceId,sourceRevisionId,exactAuthoredText:exact,ownerRevision:clone(ownerRevision),packetIndexRevision:packet.indexRevision??null,packetOntologyRevision:packet.ontologyRevision??null});}
            catch(error){rejected.push({sourceId,sourceRevisionId,reason:error?.message??String(error)});continue;}
            if(guard===false||guard?.admit===false){rejected.push({sourceId,sourceRevisionId,reason:guard?.reason??'BRAIN_REVISION_GUARD_REJECTED'});continue;}
          }
          const artifactRef=source.representationRef??('lore-source:'+sourceRevisionId);
          const evidenceId='owner-lore:'+stableHash({sourceId,sourceRevisionId},{length:24});
          const evidence=this.publishEvidence(createKnowledgeEvidence({
            evidenceId,
            evidenceIdentity:'lore-source:'+sourceId,
            artifactRef,
            sourceClass:KnowledgeSourceClass.SOURCE_LORE,
            authorityClass:'SOURCE_CANON',
            authorityOrigin:KnowledgeAuthorityOrigin.SOURCE,
            temporalStatus:KnowledgeTemporalStatus.CURRENT,
            sourceRevisionRefs:[sourceRevisionId],
            dependencyRevisionRefs:[sourceRevisionId],
            provenanceRefs:uniq([sourceRevisionId,...provenanceRefs(source.provenance??[])]),
            loreRef:{sourceId,sourceRevisionId},
            extensions:{
              representationText:exact,
              exactSourceDrillback:true,
              owner:'LORE',
              ownerIndexRevision:packet.indexRevision??null,
              ownerOntologyRevision:packet.ontologyRevision??null,
            },
          }));
          out.push(createChannelNomination({
            nominationId:this.channelId+':'+String(intent.intentId)+':'+evidenceId,
            channelId:this.channelId,
            candidateId:'candidate:'+evidenceId,
            evidenceIdentity:evidence.evidenceIdentity,
            artifactRef,
            artifactRevision:source?.selectedRepresentation?.representationRevision??1,
            sourceRevisionRefs:[sourceRevisionId],
            retrievalIntentIds:[intent.intentId],
            rankSignals:{ownerLore:1},
            normalizedRank:1,
            temporalHints:[{status:CandidateTruthStatus.CURRENT}],
            authorityClass:'SOURCE_CANON',
            truthStatusHint:CandidateTruthStatus.CURRENT,
            provenance:(source.provenance??[]).length?clone(source.provenance):[{ref:sourceRevisionId}],
            evidenceRefs:[evidenceId],
            dependencyRevisions:[sourceRevisionId],
            freshness:CandidateFreshness.FRESH,
            representationRef:String(source.representationRef??sourceRevisionId),
            representationRevision:source?.selectedRepresentation?.representationRevision??1,
            representationText:exact,
            metadata:{knowledgeEvidenceId:evidenceId,owner:'LORE',sourceId,ownerSourceRevisionId:sourceRevisionId,exactSourceDrillback:true},
            worldRevision:context.worldRevision??null,
            sceneRevision:context.sceneRevision??null,
          }));
        }
      }
      this.lastReceipt={
        kind:'OwnerKnowledgeRetrievalReceipt',channelId:this.channelId,status:'SYNCED',queried:true,
        nominationCount:out.length,sourceRevisionFence:uniq(out.flatMap((row)=>row.sourceRevisionRefs)),
        rejectedCount:rejected.length,rejectedRevisionRefs:uniq(rejected.map((row)=>row.sourceRevisionId)),
        rejectionReasons:uniq(rejected.map((row)=>row.reason)),
        ownerIndexRevision:packet.indexRevision??null,ownerOntologyRevision:packet.ontologyRevision??null,
        authorityGranted:false,settlementAuthority:false,contextSealAuthority:false,
      };
      return out;
    }catch(error){
      this.lastReceipt={kind:'OwnerKnowledgeRetrievalReceipt',channelId:this.channelId,status:'DEGRADED',queried:true,nominationCount:0,sourceRevisionFence:[],reason:error?.message??String(error),authorityGranted:false};
      throw error;
    }
  }
}

export class MemoryOwnerRetrievalChannel extends OwnerChannelBase{
  constructor({getInterface,evidenceSink,maxCandidates=48}={}){
    super({channelId:'OWNER_MEMORY',capabilities:[RetrievalChannelCapability.HISTORIAN,RetrievalChannelCapability.REFLECTION,RetrievalChannelCapability.CHARACTER_MEMORY],evidenceSink,maxCandidates});
    this.getInterface=typeof getInterface==='function'?getInterface:()=>null;
  }

  retrieve(intent,context={}){
    const owner=this.getInterface();
    const queryHistorian=owner?.queryHistorian??owner?.adapters?.queryHistorian;
    const drillDown=owner?.drillDown??owner?.adapters?.drillDown;
    if(typeof queryHistorian!=='function'||typeof drillDown!=='function'){
      this.lastReceipt={kind:'OwnerKnowledgeRetrievalReceipt',channelId:this.channelId,status:'NOT_ATTACHED',queried:false,nominationCount:0,sourceRevisionFence:[],authorityGranted:false};
      return[];
    }
    try{
      const selection=clone(this.turnContext?.selection??{});
      const perspectiveConstraint=clone(intent?.perspective??this.turnContext?.perspectiveConstraint??{scope:'WORLD'});
      const mode=['HISTORICAL','TEMPORAL'].includes(String(intent?.intentKind??'').toUpperCase())?'EXPLICIT_HISTORY':'CONTINUITY_RECALL';
      const result=syncValue(queryHistorian({
        query:intent?.query??context.query??'',mode,retrievalIntentId:intent?.intentId??null,
        activeEntityIds:uniq(intent?.entityRefs??context.anchorEntityIds??[]),
        perspectiveConstraint,maxCandidates:this.descriptor.maxCandidates,selection,
      }),'MEMORY_OWNER_ASYNC_UNSUPPORTED_IN_SYNC_FOREGROUND');
      const out=[];
      for(const nomination of result?.nominations??[]){
        const exactRows=syncValue(drillDown(nomination,{selection,perspectiveConstraint}),'MEMORY_OWNER_DRILLDOWN_ASYNC_UNSUPPORTED_IN_SYNC_FOREGROUND')??[];
        if(!Array.isArray(exactRows)||!exactRows.length)continue;
        if(!exactRows.every((row)=>typeof row?.exactContent==='string'&&row.exactContent.length))continue;
        const channel=String(nomination?.metadata?.historianChannel??'EPISODIC_MEMORY');
        const authority=normalizeKnowledgeAuthority(nomination?.authorityClass);
        const status=truthStatus(nomination?.truthStatusHint);
        const sourceRevisionRefs=uniq((nomination?.sourceRevisionRefs??[]).length?nomination.sourceRevisionRefs:exactRows.map((row)=>row?.sourceRevisionId));
        if(!sourceRevisionRefs.length)continue;
        const exactSourceRefs=uniq(exactRows.map((row)=>row?.id??row?.evidenceId));
        const exactSourceRevisionRefs=uniq(exactRows.map((row)=>row?.sourceRevisionId));
        if(sourceRevisionRefs.some((ref)=>!exactSourceRevisionRefs.includes(ref)))continue;
        const evidenceId='owner-memory:'+stableHash({candidateId:nomination.candidateId,sourceRevisionRefs},{length:24});
        const evidence=this.publishEvidence(createKnowledgeEvidence({
          evidenceId,
          evidenceIdentity:nomination.evidenceIdentity??('memory:'+String(nomination.candidateId)),
          artifactRef:clone(nomination.artifactRef),
          sourceClass:memorySourceClass(channel),
          authorityClass:authority,
          authorityOrigin:KnowledgeAuthorityOrigin.CARRIED,
          sourceAuthorityClass:authority,
          temporalStatus:temporalStatus(status),
          sourceRevisionRefs,
          dependencyRevisionRefs:uniq(nomination.dependencyRevisions??[]),
          provenanceRefs:uniq([...provenanceRefs(nomination.provenance??[]),...exactSourceRefs,...sourceRevisionRefs]),
          memoryRef:{candidateId:nomination.candidateId,historianChannel:channel},
          claimIds:uniq(nomination.claimRefs??[]),
          extensions:{
            representationText:String(nomination.representationText??''),
            exactSourceDrillback:true,
            exactEvidenceRefs:exactSourceRefs,
            owner:'MEMORY',
            historianRevision:result?.historianRevision??null,
            perspective:clone(nomination?.metadata?.perspective??perspectiveConstraint),
          },
        }));
        out.push(createChannelNomination({
          nominationId:this.channelId+':'+String(intent.intentId)+':'+evidenceId,
          channelId:this.channelId,
          candidateId:nomination.candidateId??('candidate:'+evidenceId),
          evidenceIdentity:evidence.evidenceIdentity,
          artifactRef:clone(nomination.artifactRef),
          artifactRevision:nomination.artifactRevision??nomination.representationRevision??1,
          sourceRevisionRefs,
          claimRefs:uniq(nomination.claimRefs??[]),
          eventRefs:uniq(nomination.eventRefs??[]),
          entityRefs:uniq(nomination.entityRefs??[]),
          relationshipRefs:uniq(nomination.relationshipRefs??[]),
          retrievalIntentIds:[intent.intentId],
          rankSignals:clone(nomination.rankSignals??{}),
          normalizedRank:nomination.normalizedRank??null,
          graphMetadata:clone(nomination.graphMetadata??null),
          temporalHints:clone(nomination.temporalHints??[{status}]),
          continuitySignals:clone(nomination.continuitySignals??[]),
          authorityClass:nomination.authorityClass??authority,
          truthStatusHint:status,
          provenance:clone(nomination.provenance??[]),
          evidenceRefs:[evidenceId],
          dependencyRevisions:uniq(nomination.dependencyRevisions??[]),
          freshness:CandidateFreshness.FRESH,
          representationRef:nomination.representationRef??String(nomination.candidateId??evidenceId),
          representationRevision:nomination.representationRevision??nomination.artifactRevision??1,
          representationText:String(nomination.representationText??''),
          metadata:{...(clone(nomination.metadata??{})),knowledgeEvidenceId:evidenceId,owner:'MEMORY',exactSourceDrillback:true},
          worldRevision:context.worldRevision??null,
          sceneRevision:context.sceneRevision??null,
        }));
      }
      this.lastReceipt={
        kind:'OwnerKnowledgeRetrievalReceipt',channelId:this.channelId,status:result?.status==='DEGRADED'?'DEGRADED':'SYNCED',queried:true,
        nominationCount:out.length,sourceRevisionFence:uniq(out.flatMap((row)=>row.sourceRevisionRefs)),
        historianRevision:result?.historianRevision??null,authorityGranted:false,settlementAuthority:false,contextSealAuthority:false,
      };
      return out;
    }catch(error){
      this.lastReceipt={kind:'OwnerKnowledgeRetrievalReceipt',channelId:this.channelId,status:'DEGRADED',queried:true,nominationCount:0,sourceRevisionFence:[],reason:error?.message??String(error),authorityGranted:false};
      throw error;
    }
  }
}

export const OWNER_KNOWLEDGE_CHANNELS=Object.freeze({LORE:'OWNER_LORE',MEMORY:'OWNER_MEMORY'});
