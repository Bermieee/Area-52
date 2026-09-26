const clone=(value)=>value==null?value:structuredClone(value);
export const SceneOwnerDecision=Object.freeze({ACCEPTED:'ACCEPTED',REJECTED:'REJECTED',UNRESOLVED:'UNRESOLVED'});

export class SceneJevOwnerAdjudicator{
  constructor({service=null,maxEvidenceRefs=32}={}){this.service=service;this.maxEvidenceRefs=Math.max(4,Math.min(128,Number(maxEvidenceRefs)||32));}
  async adjudicate(input,{currentScene,validateProposal=null,currentRevisionState=null}={}){
    const base={kind:'SceneOwnerAdjudicationReceipt',contractVersion:'1.0.0',decisionId:input?.decisionId??null,sceneId:currentScene?.sceneId??null,sceneRevision:currentScene?.revision??null,sceneMutationApplied:false,authority:'SCENE_OWNER_REVIEW',settlementAuthority:false,contextSealAuthority:false,jevAuthority:false};
    if(!currentScene?.sceneId||!Number.isFinite(Number(currentScene?.revision)))throw new TypeError('Scene owner adjudication requires current Scene');
    if(input?.sceneRevision!=null&&Number(input.sceneRevision)!==Number(currentScene.revision))return Object.freeze({...base,ownerDecision:SceneOwnerDecision.UNRESOLVED,reasonCode:'SCENE_REVISION_STALE',preserveCurrentScene:true,proposal:null});
    if(typeof this.service?.adjudicate!=='function')return Object.freeze({...base,ownerDecision:SceneOwnerDecision.UNRESOLVED,reasonCode:'JEV_SERVICE_UNAVAILABLE',preserveCurrentScene:true,proposal:null});
    let proposal;
    try{proposal=await this.service.adjudicate(clone(input),{currentRevisionState:clone(currentRevisionState??{sceneRevision:currentScene.revision})});}
    catch(error){return Object.freeze({...base,ownerDecision:SceneOwnerDecision.UNRESOLVED,reasonCode:'JEV_EXECUTION_UNAVAILABLE',preserveCurrentScene:true,error:String(error?.message??error).slice(0,320),proposal:null});}
    if(!proposal||proposal.staleState==='STALE'||proposal.proposedOutcome==='UNRESOLVED'||proposal.abstained===true)return Object.freeze({...base,ownerDecision:SceneOwnerDecision.UNRESOLVED,reasonCode:proposal?.staleState==='STALE'?'JEV_RESULT_STALE':'JEV_UNRESOLVED',preserveCurrentScene:true,proposal:clone(proposal)});
    let accepted=true;
    if(typeof validateProposal==='function'){try{accepted=validateProposal(clone(proposal),clone(currentScene))===true;}catch{accepted=false;}}
    return Object.freeze({...base,ownerDecision:accepted?SceneOwnerDecision.ACCEPTED:SceneOwnerDecision.REJECTED,reasonCode:accepted?'SCENE_OWNER_ACCEPTED':'SCENE_OWNER_REJECTED',preserveCurrentScene:!accepted,proposal:clone(proposal)});
  }
}
