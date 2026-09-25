// Immutable owner-contract shape snapshots for Memory Wave 3 assembly tests.
// Scene reference: Development-Scene-Scanner@3aaf1c1e9e7e8703dc8c66c5542efb03cc9873cf
// Core reference: Development-Nexus@ba4619f56db8e4f94873256dc26589e1680b7d29
// These constructors preserve owner field names/shapes only; they do not copy owner policy.

export const OWNER_CONTRACT_REFERENCE=Object.freeze({
  scene:{branch:'Development-Scene-Scanner',sha:'3aaf1c1e9e7e8703dc8c66c5542efb03cc9873cf'},
  core:{branch:'Development-Nexus',sha:'ba4619f56db8e4f94873256dc26589e1680b7d29'},
});

export function sceneArtifactRef({
  artifactId,
  sceneRevision,
  sourceRevisionRefs=[],
  revision=sceneRevision,
}={}){
  return Object.freeze({
    kind:'ArtifactReference',
    contractVersion:'1.0.0',
    artifactId,
    artifactType:'SceneEpisode',
    owner:'SCENE_INTELLIGENCE',
    revision,
    storageDomain:'artifacts',
    sourceRevisionSet:[...sourceRevisionRefs].sort(),
    worldRevision:null,
    sceneRevision,
    contentHash:null,
    sliceSelector:null,
    provenanceRef:null,
    expiry:null,
    authorityGranted:false,
    settlementAuthority:false,
    contextSealBypass:false,
    sourceRevisionRefs:[...sourceRevisionRefs].sort(),
    sliceIdentity:null,
    digest:null,
    provenance:[],
  });
}

export function sceneProposal({
  proposalId,
  sceneId,
  sceneRevision,
  episodeRef,
  evidenceRefs=[],
  sourceRevisionRefs=[],
}={}){
  return Object.freeze({
    kind:'SceneExperienceProposal',
    contractVersion:'1.0.0',
    proposalId,
    sceneId,
    sceneRevision,
    sceneEpisodeRef:structuredClone(episodeRef),
    graphReferenceSet:{
      kind:'SceneGraphReferenceSet',
      contractVersion:'1.0.0',
      sceneId,
      sceneRevision,
      episodeRefs:[structuredClone(episodeRef)],
      relationshipRefs:[],
      entityMembershipRefs:[],
      eventMembershipRefs:[],
      objectMembershipRefs:[],
      threadMembershipRefs:[],
      sourceRevisionRefs:[...sourceRevisionRefs].sort(),
      provenance:[],
      authority:'REFERENCE_ONLY',
      authorityGranted:false,
      memoryMutationAuthority:false,
      settlementAuthority:false,
    },
    sourceRevisionRefs:[...sourceRevisionRefs].sort(),
    evidenceRefs:[...evidenceRefs].sort(),
    provenance:['scene-owner-snapshot:'+proposalId],
    status:'PROPOSED',
    authority:'PROPOSAL',
    authorityGranted:false,
    memoryMutationAuthority:false,
    settlementAuthority:false,
  });
}

export function sceneEvent({
  eventId,
  eventType,
  sceneId,
  sceneRevision,
  sourceRevisionRefs=[],
  payload={},
  turnId='turn:wave3',
  sequence=1,
}={}){
  const refs=[...sourceRevisionRefs].sort();
  return Object.freeze({
    kind:'CognitiveEventEnvelope',
    eventId,
    eventType,
    eventVersion:'1.0.0',
    schemaVersion:'1.0',
    producer:'SCENE_INTELLIGENCE',
    correlationId:'scene:'+sceneId+':r'+sceneRevision,
    causationId:null,
    turnId,
    taskId:null,
    sceneId,
    sceneRevision,
    sourceRevisionSet:refs,
    worldRevision:null,
    revisionFences:{
      sourceRevisionIds:refs,
      sourceRevisions:Object.fromEntries(refs.map((x)=>[x,x])),
      worldRevision:null,
      sceneRevision,
    },
    sourceRevisions:Object.fromEntries(refs.map((x)=>[x,x])),
    sequence,
    createdSequence:sequence,
    time:sequence,
    createdAt:sequence,
    dedupeIdentity:eventId,
    dedupeKey:eventId,
    payload:structuredClone(payload),
    payloadSchemaVersion:'1.0.0',
  });
}

export function coreArtifactRef({
  evidenceId,
  sourceRevisionId,
  worldRevision,
  revision=1,
  owner='CORE',
}={}){
  return Object.freeze({
    kind:'ArtifactReference',
    artifactId:evidenceId,
    artifactType:'KnowledgeEvidence',
    owner,
    revision,
    domain:'KNOWLEDGE',
    sourceRevisionSet:[sourceRevisionId],
    worldRevision,
    sceneRevision:null,
    contentHash:null,
    provenanceRef:null,
    expiry:null,
    authorityGranted:false,
    settlementAuthority:false,
    contextSealAuthority:false,
  });
}

export function coreSettlementEnvelope({
  proposalId,
  claimId,
  evidenceId,
  sourceRevisionId,
  subjectId,
  predicate,
  value,
  worldRevision,
  decision='ACCEPT_CURRENT',
  temporalKind='CURRENT',
  includeReceipt=true,
}={}){
  const proposal={
    kind:'MutationProposal',
    id:proposalId,
    mutationType:'SET_CLAIM',
    owner:'WORLD_STATE',
    sourceRevisionIds:[sourceRevisionId],
    evidenceIds:[evidenceId],
    freshnessRevisionIds:[sourceRevisionId],
    payload:{claim:{
      kind:'Claim',
      id:claimId,
      subjectId,
      predicate,
      value,
      temporal:{kind:temporalKind,validFrom:worldRevision},
      authorityClass:'OBSERVED',
      confidence:1,
      owner:'WORLD_STATE',
      semanticKey:subjectId+'|'+predicate+'|'+JSON.stringify(value),
      explicitness:'EXPLICIT',
      provenance:{sourceRevisionIds:[sourceRevisionId],evidenceIds:[evidenceId]},
    }},
    status:'PROPOSED',
  };
  const decisionRow={
    kind:'SettlementDecision',
    id:'decision:'+proposalId,
    proposalId,
    decision,
    owner:'WORLD_STATE',
    evidenceIds:[evidenceId],
    sourceRevisionIds:[sourceRevisionId],
    worldRevision,
    reason:'owner contract snapshot settlement',
    consideredClaimIds:[],
    receiptId:includeReceipt?'receipt:'+proposalId:null,
    diagnostics:{validation:[{ok:true}]},
  };
  const receipt=includeReceipt?{
    kind:'SettlementReceipt',
    id:'receipt:'+proposalId,
    proposalId,
    owner:'WORLD_STATE',
    outcome:'SETTLED',
    settledArtifactIds:[claimId],
    supersededArtifactIds:[],
    revision:worldRevision,
    reason:null,
  }:null;
  return {proposal,decision:decisionRow,receipt};
}
