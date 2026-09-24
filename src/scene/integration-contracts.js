const clone=(v)=>v==null?v:structuredClone(v);
const req=(v,n)=>{if(typeof v!=='string'||!v.trim())throw new TypeError(`${n} must be a non-empty string`);return v.trim();};
const rev=(v,n)=>{const x=Number(v);if(!Number.isInteger(x)||x<1)throw new TypeError(`${n} must be a positive integer`);return x;};
const num=(v,n,min=0,max=1)=>{const x=Number(v);if(!Number.isFinite(x)||x<min||x>max)throw new TypeError(`${n} must be ${min}..${max}`);return x;};
const strings=(v,n)=>{if(!Array.isArray(v)||v.some(x=>typeof x!=='string'))throw new TypeError(`${n} must be an array of strings`);return [...new Set(v)].sort();};
const freeze=(v)=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const safe=(v)=>freeze(clone(v));
const forbidAuthority=(input,name)=>{if(input?.authorityGranted===true||input?.settlementAuthority===true||input?.contextSealBypass===true||input?.runtimeSchedulingAuthority===true||['SOURCE_CANON','SETTLED','CANONICAL'].includes(input?.authority)||['SOURCE_CANON','SETTLED','CANONICAL'].includes(input?.authorityClass))throw new TypeError(`${name} cannot grant authority`);};

export const SCENE_INTEGRATION_CONTRACT_VERSION='1.0.0';
export const SCENE_CONTEXT_INVALIDATION_VERSION='1.0.0';
export const SCENE_MEMORY_HANDOFF_VERSION='1.0.0';
export const OBJECT_TRANSITION_PROPOSAL_VERSION='1.0.0';

export const SceneContextScope=Object.freeze({
  COMPILED_CONTEXT:'SCENE_COMPILED_CONTEXT',
  RETRIEVAL_CONTEXT:'SCENE_RETRIEVAL_CONTEXT',
  ACTIVE_SCENE_IDENTITY:'ACTIVE_SCENE_IDENTITY',
  PROMPT_SEGMENTS:'SCENE_PROMPT_SEGMENTS',
});

export function createSceneWhyReferences({evidenceRefs=[],sourceRevisionRefs=[],proposalIds=[],transitionIds=[],eventIds=[],artifactRefs=[],boundaryDecisionRefs=[]}={}){
  return freeze({kind:'SceneWhyReferences',evidenceRefs:strings(evidenceRefs,'SceneWhyReferences.evidenceRefs'),sourceRevisionRefs:strings(sourceRevisionRefs,'SceneWhyReferences.sourceRevisionRefs'),proposalIds:strings(proposalIds,'SceneWhyReferences.proposalIds'),transitionIds:strings(transitionIds,'SceneWhyReferences.transitionIds'),eventIds:strings(eventIds,'SceneWhyReferences.eventIds'),artifactRefs:safe(artifactRefs),boundaryDecisionRefs:safe(boundaryDecisionRefs)});
}

export function createSceneIntegrationSignal(input={}){
  forbidAuthority(input,'SceneIntegrationSignal');
  const activeCast=(input.activeCast??[]).filter((x)=>typeof x==='string'||x?.state==='PRESENT'||x?.presence==='PRESENT');
  const castObservations=input.castObservations??input.activeCast??[];
  const objects=(input.objects??[]).filter((x)=>typeof x==='string'||x?.state!=='MENTIONED_ONLY');
  const objectObservations=input.objectObservations??input.objects??[];
  return freeze({
    kind:'SceneIntegrationSignal',contractVersion:SCENE_INTEGRATION_CONTRACT_VERSION,
    sceneId:req(input.sceneId,'SceneIntegrationSignal.sceneId'),sceneRevision:rev(input.sceneRevision,'SceneIntegrationSignal.sceneRevision'),
    sourceRevisionRefs:strings(input.sourceRevisionRefs??input.sourceRevisionSet??[],'SceneIntegrationSignal.sourceRevisionRefs'),
    sourceRevisionSet:strings(input.sourceRevisionRefs??input.sourceRevisionSet??[],'SceneIntegrationSignal.sourceRevisionSet'),
    location:safe(input.location??null),narrativeTime:safe(input.narrativeTime??null),
    activeCast:safe(activeCast),castObservations:safe(castObservations),
    activeThreads:safe(input.activeThreads??[]),objects:safe(objects),objectObservations:safe(objectObservations),
    uncertainFields:strings(input.uncertainFields??[],'SceneIntegrationSignal.uncertainFields'),
    conflictSignals:strings(input.conflictSignals??[],'SceneIntegrationSignal.conflictSignals'),
    boundaryState:safe(input.boundaryState??null),sceneRelationship:input.sceneRelationship??null,transitionType:input.transitionType??input.sceneRelationship??null,
    previousSceneRef:safe(input.previousSceneRef??null),resumedSceneRef:safe(input.resumedSceneRef??null),
    latestEpisodeRef:safe(input.latestEpisodeRef??null),episodeRefs:safe(input.episodeRefs??[]),
    retrievalQuality:input.retrievalQuality??null,prefetchRecommendations:safe(input.prefetchRecommendations??[]),
    objectTransitionRefs:safe(input.objectTransitionRefs??[]),atmosphere:safe(input.atmosphere??null),atmosphereRef:safe(input.atmosphereRef??null),
    health:safe(input.health??{status:'ready',reasons:[]}),provenance:strings(input.provenance??[],'SceneIntegrationSignal.provenance'),
    diagnosticRefs:createSceneWhyReferences(input.diagnosticRefs??{}),
    authority:'DESCRIPTIVE',authorityGranted:false,settlementAuthority:false,canonicalMutationAuthority:false,contextSealBypass:false,runtimeSchedulingAuthority:false,
  });
}

export function createSceneContextInvalidationSignal(input={}){
  forbidAuthority(input,'SceneContextInvalidationSignal');
  const fromSceneId=req(input.fromSceneId,'SceneContextInvalidationSignal.fromSceneId');
  const toSceneId=req(input.toSceneId,'SceneContextInvalidationSignal.toSceneId');
  const fromRevision=rev(input.fromRevision,'SceneContextInvalidationSignal.fromRevision');
  const toRevision=rev(input.toRevision,'SceneContextInvalidationSignal.toRevision');
  const relationship=req(input.relationship??'CONTINUES','SceneContextInvalidationSignal.relationship');
  return freeze({
    kind:'SceneContextInvalidationSignal',contractVersion:SCENE_CONTEXT_INVALIDATION_VERSION,
    invalidationId:req(input.invalidationId??`scene-context:${fromSceneId}:${fromRevision}->${toSceneId}:${toRevision}:${relationship}`,'SceneContextInvalidationSignal.invalidationId'),
    fromSceneRef:freeze({sceneId:fromSceneId,sceneRevision:fromRevision}),toSceneRef:freeze({sceneId:toSceneId,sceneRevision:toRevision}),
    resumedSceneRef:input.resumedSceneRef?safe(input.resumedSceneRef):null,relationship,
    invalidatedScopes:strings(input.invalidatedScopes??Object.values(SceneContextScope),'SceneContextInvalidationSignal.invalidatedScopes'),
    sourceRevisionRefs:strings(input.sourceRevisionRefs??[],'SceneContextInvalidationSignal.sourceRevisionRefs'),
    evidenceRefs:strings(input.evidenceRefs??[],'SceneContextInvalidationSignal.evidenceRefs'),
    reason:req(input.reason??'SCENE_TRANSITION','SceneContextInvalidationSignal.reason'),
    activeSceneIdentityChanged:fromSceneId!==toSceneId,
    sameConceptualSceneResumed:Boolean(input.resumedSceneRef&&input.resumedSceneRef.sceneId===toSceneId),
    deleteEvidence:false,authority:'NONE',authorityGranted:false,contextMutationAuthority:false,contextSealBypass:false,
  });
}

export function createSceneGraphReferenceSet(input={}){
  forbidAuthority(input,'SceneGraphReferenceSet');
  return freeze({
    kind:'SceneGraphReferenceSet',contractVersion:SCENE_MEMORY_HANDOFF_VERSION,
    sceneId:req(input.sceneId,'SceneGraphReferenceSet.sceneId'),sceneRevision:rev(input.sceneRevision,'SceneGraphReferenceSet.sceneRevision'),
    episodeRefs:safe(input.episodeRefs??[]),relationshipRefs:strings(input.relationshipRefs??[],'SceneGraphReferenceSet.relationshipRefs'),
    entityMembershipRefs:strings(input.entityMembershipRefs??[],'SceneGraphReferenceSet.entityMembershipRefs'),
    eventMembershipRefs:strings(input.eventMembershipRefs??[],'SceneGraphReferenceSet.eventMembershipRefs'),
    objectMembershipRefs:strings(input.objectMembershipRefs??[],'SceneGraphReferenceSet.objectMembershipRefs'),
    threadMembershipRefs:strings(input.threadMembershipRefs??[],'SceneGraphReferenceSet.threadMembershipRefs'),
    sourceRevisionRefs:strings(input.sourceRevisionRefs??[],'SceneGraphReferenceSet.sourceRevisionRefs'),
    provenance:strings(input.provenance??[],'SceneGraphReferenceSet.provenance'),
    authority:'REFERENCE_ONLY',authorityGranted:false,memoryMutationAuthority:false,settlementAuthority:false,
  });
}

export function createSceneExperienceProposal(input={}){
  forbidAuthority(input,'SceneExperienceProposal');
  return freeze({
    kind:'SceneExperienceProposal',contractVersion:SCENE_MEMORY_HANDOFF_VERSION,
    proposalId:req(input.proposalId,'SceneExperienceProposal.proposalId'),
    sceneId:req(input.sceneId,'SceneExperienceProposal.sceneId'),sceneRevision:rev(input.sceneRevision,'SceneExperienceProposal.sceneRevision'),
    sceneEpisodeRef:safe(input.sceneEpisodeRef),graphReferenceSet:safe(input.graphReferenceSet),
    sourceRevisionRefs:strings(input.sourceRevisionRefs??input.sceneEpisodeRef?.sourceRevisionSet??[],'SceneExperienceProposal.sourceRevisionRefs'),
    evidenceRefs:strings(input.evidenceRefs??[],'SceneExperienceProposal.evidenceRefs'),
    provenance:strings(input.provenance??[],'SceneExperienceProposal.provenance'),
    status:'PROPOSED',authority:'PROPOSAL',authorityGranted:false,memoryMutationAuthority:false,settlementAuthority:false,
  });
}

export function isSceneExperienceProposalFresh(proposal,{sceneRevision,sourceRevisionRefs=[]}={}){
  if(!proposal||proposal.kind!=='SceneExperienceProposal')return false;
  if(Number(proposal.sceneRevision)!==Number(sceneRevision))return false;
  const expected=new Set(sourceRevisionRefs);
  return proposal.sourceRevisionRefs.every((x)=>expected.has(x));
}

export function createObjectStateTransitionProposal(input={}){
  forbidAuthority(input,'ObjectStateTransitionProposal');
  const observationClass=req(input.observationClass??'OBSERVED','ObjectStateTransitionProposal.observationClass');
  if(!['OBSERVED','INFERRED','UNRESOLVED'].includes(observationClass))throw new TypeError('ObjectStateTransitionProposal observationClass unsupported');
  return freeze({
    kind:'ObjectStateTransitionProposal',contractVersion:OBJECT_TRANSITION_PROPOSAL_VERSION,
    proposalId:req(input.proposalId,'ObjectStateTransitionProposal.proposalId'),
    sceneId:req(input.sceneId,'ObjectStateTransitionProposal.sceneId'),sceneRevision:rev(input.sceneRevision,'ObjectStateTransitionProposal.sceneRevision'),
    objectRef:req(input.objectRef,'ObjectStateTransitionProposal.objectRef'),before:safe(input.before??null),after:safe(input.after??null),
    evidenceRefs:strings(input.evidenceRefs??[],'ObjectStateTransitionProposal.evidenceRefs'),
    sourceRevisionRefs:strings(input.sourceRevisionRefs??[],'ObjectStateTransitionProposal.sourceRevisionRefs'),
    confidence:num(input.confidence??1,'ObjectStateTransitionProposal.confidence'),observationClass,
    authority:'PROPOSAL',authorityGranted:false,directSettlement:false,settlementAuthority:false,
  });
}
