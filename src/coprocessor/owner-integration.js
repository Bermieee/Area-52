export const COPROCESSOR_OWNER_INTEGRATION_VERSION='1.0.0';

export function admitGreenRoomBatchToMemoryOwner({batch,memoryOwner,turnSequence=0}={}){
  const fn=resolve(memoryOwner,['acceptGreenRoomBatch','ingestGreenRoomBatch']);
  if(!fn)return freeze({
    kind:'GreenRoomMemoryOwnerAdmissionReceipt',contractVersion:COPROCESSOR_OWNER_INTEGRATION_VERSION,
    status:'OWNER_CONTRACT_UNAVAILABLE',ownerAccepted:false,acceptedCount:0,pendingOwnerIntegration:true,
    authority:'NONE',canonicalMutation:false,characterStateMutation:false,settlementAuthority:false,
  });
  try{
    const receipt=fn(batch,{turnSequence});
    if(receipt?.kind!=='MemoryGreenRoomBatchReceipt')throw new TypeError('Memory owner returned unsupported Green Room receipt');
    return freeze({
      kind:'GreenRoomMemoryOwnerAdmissionReceipt',contractVersion:COPROCESSOR_OWNER_INTEGRATION_VERSION,
      status:'ACCEPTED',ownerAccepted:true,acceptedCount:Array.isArray(receipt.accepted)?receipt.accepted.length:0,
      sceneRevision:receipt.sceneRevision??batch?.sceneRevision??null,activeCount:receipt.activeCount??null,
      authority:receipt.authority??'INFERRED',canonicalMutation:false,characterStateMutation:false,settlementAuthority:false,
      pendingOwnerIntegration:false,
    });
  }catch(error){
    return freeze({
      kind:'GreenRoomMemoryOwnerAdmissionReceipt',contractVersion:COPROCESSOR_OWNER_INTEGRATION_VERSION,
      status:'REJECTED',ownerAccepted:false,acceptedCount:0,pendingOwnerIntegration:false,
      reasonCode:String(error?.code??'MEMORY_GREEN_ROOM_REJECTED'),reason:String(error?.message??error).slice(0,400),
      authority:'NONE',canonicalMutation:false,characterStateMutation:false,settlementAuthority:false,
    });
  }
}

export function createMemoryConsolidationDeepWork({memoryOwner,jobs=[],options={},workId=null}={}){
  const start=resolve(memoryOwner,['startConsolidation']);
  const list=resolve(memoryOwner,['consolidationWorkUnits']);
  const run=resolve(memoryOwner,['runConsolidation']);
  if(!start||!list||!run)return freeze({
    kind:'MemoryConsolidationDeepWorkFactoryReceipt',contractVersion:COPROCESSOR_OWNER_INTEGRATION_VERSION,
    status:'OWNER_CONTRACT_UNAVAILABLE',available:false,pendingOwnerIntegration:true,work:null,authority:'NONE',
  });
  let session;
  try{session=start(jobs,options);}
  catch(error){
    return freeze({
      kind:'MemoryConsolidationDeepWorkFactoryReceipt',contractVersion:COPROCESSOR_OWNER_INTEGRATION_VERSION,
      status:'OWNER_REJECTED_START',available:false,pendingOwnerIntegration:false,
      reasonCode:String(error?.code??'MEMORY_CONSOLIDATION_START_REJECTED'),reason:String(error?.message??error).slice(0,400),
      work:null,authority:'NONE',
    });
  }
  const id=workId??('memory-deep:'+session.id);
  const initialUnits=list(session.id,{maxUnits:1});
  const descriptor={
    workId:id,
    checkpoint:session.checkpoint??null,
    metadata:{
      owner:'MEMORY',
      ownerContract:'MemoryConsolidationWorkUnit v1.0.0',
      sessionId:session.id,
      initialWorkUnitId:initialUnits[0]?.workUnitId??null,
      jobCount:Array.isArray(jobs)?jobs.length:0,
    },
    async runSlice({context={}}={}){
      const state=run(session.id,{
        maxUnits:1,
        sealed:Boolean(context.sealed),
        sealedGenerationIds:[...(context.sealedGenerationIds??[])],
        currentSourceRevisionRefs:context.currentSourceRevisionRefs??null,
      });
      const ownerPublishedArtifactIds=[...(state.publishedArtifactIds??[])];
      return {
        state:state.state,
        ownerState:state.state,
        checkpoint:state.checkpoint??null,
        done:state.state==='COMPLETED',
        terminal:state.state==='STALE'||state.state==='COMPLETED',
        stale:state.state==='STALE',
        postSeal:state.state==='PARKED_AFTER_SEAL',
        ownerAccepted:ownerPublishedArtifactIds.length>0,
        ownerPublishedArtifactIds,
        lateDisposition:publicLateDisposition(state.lateDisposition),
      };
    },
  };
  return {
    kind:'MemoryConsolidationDeepWorkFactoryReceipt',contractVersion:COPROCESSOR_OWNER_INTEGRATION_VERSION,
    status:'READY',available:true,pendingOwnerIntegration:false,sessionId:session.id,
    initialWorkUnits:initialUnits.map(publicWorkUnit),work:descriptor,authority:'NONE',
  };
}

export async function adjudicateJevForOwner({service,input,currentRevisionState=null,sealed=false,signal=null,ownerReview=null}={}){
  if(!service||typeof service.adjudicate!=='function')throw new TypeError('JevDomainAdapterService is required');
  const proposal=await service.adjudicate(input,{currentRevisionState,sealed,signal});
  const stale=proposal?.staleState==='STALE';
  const late=Boolean(proposal?.details?.late||proposal?.details?.foregroundEligible===false);
  if(stale||late){
    return freeze({
      kind:'JevOwnerAdmissionReceipt',contractVersion:COPROCESSOR_OWNER_INTEGRATION_VERSION,
      status:stale?'REJECTED_STALE':'REJECTED_POST_SEAL',domain:proposal?.domain??input?.domain??null,
      proposalType:proposal?.proposalType??null,proposal,ownerReviewInvoked:false,ownerDecision:'REJECTED',
      accepted:false,rejected:true,reasonCode:stale?'STALE_REVISION':'CONTEXT_SEALED',
      settlementPerformed:false,canonicalMutation:false,jevSettlementPerformed:false,mutationAuthority:false,
      authority:'OWNER_REQUIRED',
    });
  }
  const review=await requestJevOwnerReview({proposal,ownerReview});
  return freeze({
    kind:'JevOwnerAdmissionReceipt',contractVersion:COPROCESSOR_OWNER_INTEGRATION_VERSION,
    status:review.status,domain:proposal.domain,proposalType:proposal.proposalType,proposal,
    ownerReviewInvoked:typeof ownerReview==='function',ownerDecision:review.ownerDecision,
    accepted:Boolean(review.accepted),rejected:Boolean(review.rejected),reasonCode:review.reasonCode??null,
    settlementPerformed:Boolean(review.settlementPerformed),canonicalMutation:Boolean(review.canonicalMutation),
    jevSettlementPerformed:false,mutationAuthority:false,authority:'OWNER_REVIEW_RECEIPT',
  });
}

export async function requestJevOwnerReview({proposal,ownerReview=null}={}){
  if(!proposal||proposal.requiresOwnerPolicy!==true||proposal.mutationAuthority!==false)throw new TypeError('bounded Jev owner proposal is required');
  if(typeof ownerReview!=='function')return freeze({
    kind:'JevOwnerReviewReceipt',contractVersion:COPROCESSOR_OWNER_INTEGRATION_VERSION,
    status:'PENDING_OWNER_CONTRACT',ownerDecision:'PENDING',proposalType:proposal.proposalType,domain:proposal.domain,
    owner:proposal.owner,accepted:false,rejected:false,settlementPerformed:false,canonicalMutation:false,authority:'OWNER_REQUIRED',
  });
  try{
    const raw=await ownerReview(proposal);
    const decision=String(raw?.decision??raw?.status??'').toUpperCase();
    if(!['ACCEPTED','REJECTED','UNRESOLVED','DEFERRED'].includes(decision))throw new TypeError('ownerReview must return ACCEPTED, REJECTED, UNRESOLVED, or DEFERRED');
    return freeze({
      kind:'JevOwnerReviewReceipt',contractVersion:COPROCESSOR_OWNER_INTEGRATION_VERSION,status:'REVIEWED',
      ownerDecision:decision,proposalType:proposal.proposalType,domain:proposal.domain,owner:proposal.owner,
      accepted:decision==='ACCEPTED',rejected:decision==='REJECTED',reasonCode:raw?.reasonCode??null,
      reason:typeof raw?.reason==='string'?raw.reason.slice(0,400):null,
      settlementPerformed:Boolean(raw?.settlementPerformed),
      canonicalMutation:Boolean(raw?.canonicalMutation),
      authority:'OWNER_REVIEW_RECEIPT',
    });
  }catch(error){
    return freeze({
      kind:'JevOwnerReviewReceipt',contractVersion:COPROCESSOR_OWNER_INTEGRATION_VERSION,status:'OWNER_REVIEW_FAILED',
      ownerDecision:'PENDING',proposalType:proposal.proposalType,domain:proposal.domain,owner:proposal.owner,
      accepted:false,rejected:false,reasonCode:String(error?.code??'OWNER_REVIEW_FAILED'),reason:String(error?.message??error).slice(0,400),
      settlementPerformed:false,canonicalMutation:false,authority:'OWNER_REQUIRED',
    });
  }
}

function resolve(owner,names){
  for(const source of [owner?.adapters,owner]){
    for(const name of names)if(typeof source?.[name]==='function')return source[name].bind(source);
  }
  return null;
}
function publicWorkUnit(row){return freeze({
  kind:row?.kind??null,contractVersion:row?.contractVersion??null,workUnitId:row?.workUnitId??null,sessionId:row?.sessionId??null,
  cursor:row?.cursor??null,jobType:row?.jobType??null,inputRevisionFence:clone(row?.inputRevisionFence??null),
  generationFence:clone(row?.generationFence??null),runtimeSchedulingAuthority:false,physicalWorkerAuthority:false,
  foregroundPublicationAuthority:false,contextSealAuthority:false,canonicalMutationAuthority:false,
});}
function publicLateDisposition(row){if(!row)return null;return freeze({
  reasonCode:row.reasonCode??null,destination:row.destination??null,generationId:row.generationId??null,
  foregroundEligible:Boolean(row.foregroundEligible),contextSealMutation:Boolean(row.contextSealMutation),
  staleSourceRevisionRefs:[...(row.staleSourceRevisionRefs??[])],
});}
function clone(value){return value==null?value:structuredClone(value);}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
