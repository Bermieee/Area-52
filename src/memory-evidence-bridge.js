import {
  MEMORY_EVIDENCE_BRIDGE_CONTRACT_VERSION,
  MEMORY_LIMITS,
  deepClone,
  requiredString,
  stableHash,
  stableStringify,
  uniqStrings,
} from './memory-contracts.js';

const AUTHORITY_FLAGS=[
  'authorityGranted','settlementAuthority','canonicalMutationAuthority','contextSealAuthority',
  'contextSealBypass','memoryMutationAuthority','runtimeSchedulingAuthority','directSettlement',
];

const SCENE_EVENT_TYPES=new Set([
  'SCENE_BOUNDARY_CANDIDATE',
  'SCENE_BOUNDARY_CONFIRMED',
  'SCENE_EPISODE_READY',
  'SCENE_CLOSED',
]);

function positiveRevision(value,name){
  const revision=Number(value);
  if(!Number.isInteger(revision)||revision<1)throw new MemoryEvidenceBridgeError(
    'MEMORY_BRIDGE_REVISION_INVALID',
    name+' must be a positive integer',
    {field:name,value},
  );
  return revision;
}

function optionalFinite(value,name){
  if(value==null)return null;
  const n=Number(value);
  if(!Number.isFinite(n))throw new MemoryEvidenceBridgeError('MEMORY_BRIDGE_FENCE_INVALID',name+' must be finite',{field:name,value});
  return n;
}

function authorityViolation(value){
  if(!value||typeof value!=='object')return null;
  for(const key of AUTHORITY_FLAGS)if(value[key]===true)return key;
  const authority=String(value.authority??value.authorityClass??'');
  if(['CANONICAL','SETTLED','SOURCE_CANON','OPERATOR'].includes(authority))return 'authority:'+authority;
  return null;
}

function normalizeArtifactRef(input,name='ownerArtifactRef'){
  if(!input||typeof input!=='object')throw new MemoryEvidenceBridgeError('MEMORY_BRIDGE_OWNER_REF_REQUIRED',name+' is required');
  const bad=authorityViolation(input);
  if(bad)throw new MemoryEvidenceBridgeError('MEMORY_BRIDGE_AUTHORITY_VIOLATION',name+' cannot grant authority',{field:bad});
  const sourceRevisionSet=uniqStrings(
    input.sourceRevisionSet??input.sourceRevisionRefs??[],
    MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact,
  );
  return {
    kind:input.kind??'ArtifactReference',
    artifactId:requiredString(input.artifactId??input.id,name+'.artifactId'),
    artifactType:requiredString(input.artifactType??input.kind??'ExternalEvidenceArtifact',name+'.artifactType'),
    owner:requiredString(input.owner,name+'.owner'),
    revision:positiveRevision(input.revision,name+'.revision'),
    sourceRevisionSet,
    worldRevision:optionalFinite(input.worldRevision,name+'.worldRevision'),
    sceneRevision:optionalFinite(input.sceneRevision,name+'.sceneRevision'),
    contentHash:input.contentHash??input.digest??null,
    provenanceRef:input.provenanceRef??null,
  };
}

function baseIdentity(ownerArtifactRef,externalEvidenceRef){
  return ownerArtifactRef.owner+'|'+ownerArtifactRef.artifactId+'|'+externalEvidenceRef;
}

function sceneKey(sceneId,sceneRevision){
  return String(sceneId)+'@'+String(sceneRevision);
}

function sameSet(a,b){
  return stableStringify([...(a??[])].sort())===stableStringify([...(b??[])].sort());
}

function safeRaw(input){
  const text=stableStringify(input);
  if(text.length>MEMORY_LIMITS.maxExternalRawInputCharacters)throw new MemoryEvidenceBridgeError(
    'MEMORY_BRIDGE_RAW_INPUT_LIMIT_EXCEEDED',
    'External owner input exceeds bounded audit size',
    {characters:text.length,limit:MEMORY_LIMITS.maxExternalRawInputCharacters},
  );
  return deepClone(input);
}

function statusReceipt(kind,{status,reasonCode=null,details={},...rest}={}){
  return {
    kind,
    contractVersion:MEMORY_EVIDENCE_BRIDGE_CONTRACT_VERSION,
    status,
    reasonCode,
    details:deepClone(details),
    ...deepClone(rest),
    authorityGranted:false,
    settlementAuthority:false,
    canonicalMutationAuthority:false,
    contextSealAuthority:false,
  };
}

export class MemoryEvidenceBridgeError extends Error{
  constructor(code,message,details={}){
    super(message);
    this.name='MemoryEvidenceBridgeError';
    this.code=code;
    this.details=deepClone(details);
  }
}

export class MemoryExternalEvidenceBridge{
  constructor({graph,snapshot=null}={}){
    if(!graph)throw new TypeError('MemoryExternalEvidenceBridge requires TemporalStateGraph');
    this.graph=graph;
    this.mappings=new Map();
    this.historyByIdentity=new Map();
    this.currentByIdentity=new Map();
    this.sceneProposals=new Map();
    this.sceneEvents=new Map();
    this.boundaryBySceneRevision=new Map();
    this.episodeReadyBySceneRevision=new Map();
    this.sequence=0;
    this.proposalSequence=0;
    this.eventSequence=0;
    this.diagnostics=[];
    if(snapshot)this.restore(snapshot);
  }

  admitMapping(input={}){
    if(input.contractVersion&&input.contractVersion!==MEMORY_EVIDENCE_BRIDGE_CONTRACT_VERSION)throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_CONTRACT_MISMATCH',
      'Unsupported Memory evidence bridge contract '+String(input.contractVersion),
    );
    const bad=authorityViolation(input);
    if(bad)throw new MemoryEvidenceBridgeError('MEMORY_BRIDGE_AUTHORITY_VIOLATION','Mapping request cannot grant authority',{field:bad});
    if(input.lateForSealedGeneration===true||input.sealedGeneration===true)throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_LATE_SEALED_GENERATION',
      'Late sealed-generation material cannot be admitted as current evidence',
    );

    const ownerArtifactRef=normalizeArtifactRef(input.ownerArtifactRef);
    const externalEvidenceRef=requiredString(input.externalEvidenceRef,'externalEvidenceRef');
    const source=input.source??{};
    const sourceId=requiredString(source.sourceId,'source.sourceId');
    const sourceRevisionId=requiredString(source.sourceRevisionId,'source.sourceRevisionId');
    if(typeof source.exactContent!=='string'||!source.exactContent.trim())throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_EXACT_CONTENT_REQUIRED',
      'Exact source/evidence content is required',
      {externalEvidenceRef},
    );
    const exactContent=source.exactContent;
    const ownerEvidenceKind=String(source.evidenceKind??source.kind??'EXPERIENCE');
    if(ownerEvidenceKind==='SOURCE'||['SOURCE_CANON','SETTLED','OPERATOR'].includes(String(source.authorityClass??'')))throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_AUTHORITY_UNSUPPORTED',
      'Evidence bridge cannot manufacture stronger source or settled authority',
      {ownerEvidenceKind,authorityClass:source.authorityClass??null},
    );

    const proof=input.revisionProof??{};
    if(proof.sourceRevisionId!=null&&String(proof.sourceRevisionId)!==sourceRevisionId)throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_SOURCE_PROOF_MISMATCH',
      'Revision proof source does not match exact source revision',
      {proof:proof.sourceRevisionId,sourceRevisionId},
    );
    if(proof.ownerArtifactRevision!=null&&Number(proof.ownerArtifactRevision)!==ownerArtifactRef.revision)throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_OWNER_PROOF_MISMATCH',
      'Revision proof owner artifact revision does not match',
      {proof:proof.ownerArtifactRevision,ownerArtifactRevision:ownerArtifactRef.revision},
    );
    if(ownerArtifactRef.sourceRevisionSet.length&&!ownerArtifactRef.sourceRevisionSet.includes(sourceRevisionId))throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_SOURCE_NOT_IN_OWNER_REF',
      'Exact source revision is not named by the owner artifact reference',
      {sourceRevisionId,ownerSourceRevisionSet:ownerArtifactRef.sourceRevisionSet},
    );

    const sceneRevision=optionalFinite(source.sceneRevision??proof.sceneRevision,'source.sceneRevision');
    const worldRevision=optionalFinite(source.worldRevision??proof.worldRevision,'source.worldRevision');
    if(ownerArtifactRef.sceneRevision!=null&&sceneRevision!==ownerArtifactRef.sceneRevision)throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_SCENE_FENCE_MISMATCH',
      'Scene revision does not match owner artifact reference',
      {ownerSceneRevision:ownerArtifactRef.sceneRevision,sceneRevision},
    );
    if(proof.sceneRevision!=null&&sceneRevision!==Number(proof.sceneRevision))throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_SCENE_PROOF_MISMATCH',
      'Scene revision proof mismatch',
      {proofSceneRevision:Number(proof.sceneRevision),sceneRevision},
    );
    if(ownerArtifactRef.worldRevision!=null&&worldRevision!==ownerArtifactRef.worldRevision)throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_WORLD_FENCE_MISMATCH',
      'World revision does not match owner artifact reference',
      {ownerWorldRevision:ownerArtifactRef.worldRevision,worldRevision},
    );
    if(proof.worldRevision!=null&&worldRevision!==Number(proof.worldRevision))throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_WORLD_PROOF_MISMATCH',
      'World revision proof mismatch',
      {proofWorldRevision:Number(proof.worldRevision),worldRevision},
    );

    const sourceState=this.graph.sourceRevisionState.get(sourceRevisionId);
    if(sourceState&&sourceState.state!=='ACTIVE')throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_SOURCE_STALE',
      'Source revision is already stale in Memory',
      {sourceRevisionId,state:sourceState.state},
    );

    const contentHash=stableHash(exactContent);
    if(proof.contentHash!=null&&String(proof.contentHash)!==contentHash&&String(proof.contentHash)!==String(ownerArtifactRef.contentHash??''))throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_CONTENT_HASH_MISMATCH',
      'Revision proof content hash does not match exact content',
      {proofContentHash:proof.contentHash,computedContentHash:contentHash},
    );

    const identity=baseIdentity(ownerArtifactRef,externalEvidenceRef);
    const currentId=this.currentByIdentity.get(identity);
    const current=currentId?this.mappings.get(currentId):null;
    const fingerprint=stableHash(stableStringify({
      ownerArtifactRef,externalEvidenceRef,sourceId,sourceRevisionId,contentHash,sceneRevision,worldRevision,
      observationState:input.observationState??source.observationState??null,
    }));
    if(current){
      if(ownerArtifactRef.revision<current.ownerArtifactRef.revision)throw new MemoryEvidenceBridgeError(
        'MEMORY_BRIDGE_OWNER_REVISION_STALE',
        'Owner artifact revision is older than the active mapping',
        {activeRevision:current.ownerArtifactRef.revision,incomingRevision:ownerArtifactRef.revision,identity},
      );
      if(ownerArtifactRef.revision===current.ownerArtifactRef.revision){
        if(current.fingerprint!==fingerprint)throw new MemoryEvidenceBridgeError(
          'MEMORY_BRIDGE_IDENTITY_CONFLICT',
          'Owner evidence identity was reused with conflicting exact content or revision fences',
          {identity,currentMappingId:current.id},
        );
        return statusReceipt('MemoryExternalEvidenceMappingReceipt',{
          status:'REPLAYED',
          mappingId:current.id,
          memoryEvidenceId:current.memoryEvidenceId,
          sourceRevisionId:current.sourceRevisionId,
          identity,
          affectedSceneProposalIds:[],
        });
      }
    }

    if(this.mappings.size>=MEMORY_LIMITS.maxExternalEvidenceMappings)throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_MAPPING_LIMIT_EXCEEDED',
      'External evidence mapping journal reached its configured bound',
      {limit:MEMORY_LIMITS.maxExternalEvidenceMappings},
    );
    const history=this.historyByIdentity.get(identity)??[];
    if(history.length>=MEMORY_LIMITS.maxExternalMappingHistoryPerIdentity)throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_IDENTITY_HISTORY_LIMIT_EXCEEDED',
      'External evidence identity reached its retained revision bound',
      {identity,limit:MEMORY_LIMITS.maxExternalMappingHistoryPerIdentity},
    );

    const memoryEvidenceId='memory-external-evidence:'+stableHash(sourceId+'|'+sourceRevisionId+'|'+contentHash);
    const evidence=this.graph.appendEvidence({
      id:memoryEvidenceId,
      sourceId,
      sourceRevisionId,
      exactContent,
      kind:'EXPERIENCE',
      occurredAt:Number(source.occurredAt??worldRevision??sceneRevision??0),
      worldRevision:Number(worldRevision??0),
      sceneRevision,
      participants:source.participants??[],
      knownBy:source.knownBy??[],
      perspective:source.perspective??'WORLD',
      metadata:{
        ...(source.metadata??{}),
        bridgeOriginOwner:ownerArtifactRef.owner,
        bridgeOwnerArtifactId:ownerArtifactRef.artifactId,
        bridgeOwnerArtifactRevision:ownerArtifactRef.revision,
        bridgeExternalEvidenceRef:externalEvidenceRef,
        ownerEvidenceKind,
        observationState:input.observationState??source.observationState??null,
      },
      provenance:[
        ...(source.provenance??[]),
        ...(input.provenanceRefs??[]),
        'external-owner:'+ownerArtifactRef.owner+':'+ownerArtifactRef.artifactId+'@'+ownerArtifactRef.revision,
        'external-evidence:'+externalEvidenceRef,
      ],
    });

    if(current){
      current.state='HISTORICAL';
      current.freshness='STALE';
      current.replacedByMappingId='pending';
    }

    const id='memory-external-map:'+stableHash(identity+'|'+ownerArtifactRef.revision+'|'+fingerprint+'|'+String(++this.sequence));
    const mapping={
      kind:'MemoryExternalEvidenceMapping',
      contractVersion:MEMORY_EVIDENCE_BRIDGE_CONTRACT_VERSION,
      id,
      identity,
      revision:history.length+1,
      originOwner:ownerArtifactRef.owner,
      ownerArtifactRef,
      externalEvidenceRef,
      memoryEvidenceId:evidence.id,
      sourceId,
      sourceRevisionId,
      exactContentHash:contentHash,
      sceneRevision,
      worldRevision,
      observationState:input.observationState??source.observationState??null,
      sceneEligible:(input.observationState??source.observationState??null)!=='MENTIONED_ONLY',
      provenanceRefs:uniqStrings(input.provenanceRefs??[],64),
      rawOwnerInput:safeRaw(input),
      fingerprint,
      state:'CURRENT',
      freshness:'FRESH',
      createdSequence:this.sequence,
      replacedByMappingId:null,
      authorityGranted:false,
      settlementAuthority:false,
      canonicalMutationAuthority:false,
      contextSealAuthority:false,
    };
    if(current)current.replacedByMappingId=id;
    this.mappings.set(id,mapping);
    this.historyByIdentity.set(identity,[...history,id]);
    this.currentByIdentity.set(identity,id);

    const affectedSceneProposalIds=this.affectedSceneProposals({
      ownerArtifactRef,
      externalEvidenceRef,
      sourceRevisionId,
    });
    const receipt=statusReceipt('MemoryExternalEvidenceMappingReceipt',{
      status:'ADMITTED',
      mappingId:id,
      memoryEvidenceId:evidence.id,
      sourceRevisionId,
      identity,
      affectedSceneProposalIds,
    });
    this.pushDiagnostic(receipt);
    return receipt;
  }

  mappingFresh(mapping){
    return Boolean(
      mapping&&mapping.state==='CURRENT'&&mapping.freshness==='FRESH'
      &&this.graph.evidenceFresh(mapping.memoryEvidenceId)
      &&this.graph.isSourceRevisionActive(mapping.sourceRevisionId)
    );
  }

  mappingHistory({ownerArtifactRef,externalEvidenceRef}={}){
    const ref=normalizeArtifactRef(ownerArtifactRef);
    const identity=baseIdentity(ref,requiredString(externalEvidenceRef,'externalEvidenceRef'));
    return (this.historyByIdentity.get(identity)??[]).map((id)=>deepClone(this.mappings.get(id))).filter(Boolean);
  }

  resolveMapping({ownerArtifactRef,externalEvidenceRef,sourceRevisionId=null,sceneRevision=null,worldRevision=null}={}){
    const ref=normalizeArtifactRef(ownerArtifactRef);
    const identity=baseIdentity(ref,requiredString(externalEvidenceRef,'externalEvidenceRef'));
    const id=this.currentByIdentity.get(identity);
    const mapping=id?this.mappings.get(id):null;
    if(!mapping)return {ok:false,reasonCode:'MEMORY_BRIDGE_MAPPING_MISSING',identity};
    if(mapping.ownerArtifactRef.revision!==ref.revision)return {ok:false,reasonCode:'MEMORY_BRIDGE_OWNER_REVISION_MISMATCH',identity,mappingId:mapping.id};
    if(sourceRevisionId!=null&&mapping.sourceRevisionId!==String(sourceRevisionId))return {ok:false,reasonCode:'MEMORY_BRIDGE_SOURCE_REVISION_MISMATCH',identity,mappingId:mapping.id};
    if(sceneRevision!=null&&mapping.sceneRevision!==Number(sceneRevision))return {ok:false,reasonCode:'MEMORY_BRIDGE_SCENE_FENCE_MISMATCH',identity,mappingId:mapping.id};
    if(worldRevision!=null&&mapping.worldRevision!==Number(worldRevision))return {ok:false,reasonCode:'MEMORY_BRIDGE_WORLD_FENCE_MISMATCH',identity,mappingId:mapping.id};
    if(!this.mappingFresh(mapping))return {ok:false,reasonCode:'MEMORY_BRIDGE_MAPPING_STALE',identity,mappingId:mapping.id};
    return {ok:true,mapping:deepClone(mapping)};
  }

  mappingsForOwnerArtifact(ownerArtifactRef){
    const ref=normalizeArtifactRef(ownerArtifactRef);
    const out=[];
    for(const id of this.currentByIdentity.values()){
      const row=this.mappings.get(id);
      if(!row)continue;
      if(row.originOwner!==ref.owner||row.ownerArtifactRef.artifactId!==ref.artifactId||row.ownerArtifactRef.revision!==ref.revision)continue;
      if(this.mappingFresh(row))out.push(row);
    }
    return out.sort((a,b)=>a.externalEvidenceRef.localeCompare(b.externalEvidenceRef)).map(deepClone);
  }

  registerSceneProposal(proposal,options={}){
    if(!proposal||proposal.kind!=='SceneExperienceProposal')throw new MemoryEvidenceBridgeError('MEMORY_BRIDGE_SCENE_PROPOSAL_REQUIRED','SceneExperienceProposal required');
    if(proposal.contractVersion!=='1.0.0')throw new MemoryEvidenceBridgeError('MEMORY_BRIDGE_SCENE_CONTRACT_MISMATCH','Unsupported SceneExperienceProposal contract',{contractVersion:proposal.contractVersion});
    const bad=authorityViolation(proposal);
    if(bad)throw new MemoryEvidenceBridgeError('MEMORY_BRIDGE_AUTHORITY_VIOLATION','Scene proposal cannot grant authority',{field:bad});
    const ownerArtifactRef=normalizeArtifactRef({...proposal.sceneEpisodeRef,owner:proposal.sceneEpisodeRef?.owner??'SCENE_INTELLIGENCE'},'SceneExperienceProposal.sceneEpisodeRef');
    if(ownerArtifactRef.owner!=='SCENE_INTELLIGENCE')throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_SCENE_OWNER_MISMATCH',
      'Scene episode owner must be SCENE_INTELLIGENCE',
      {owner:ownerArtifactRef.owner},
    );
    if(Number(proposal.sceneRevision)!==Number(ownerArtifactRef.sceneRevision))throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_SCENE_FENCE_MISMATCH',
      'Scene proposal revision must match SceneEpisode reference',
      {proposalSceneRevision:proposal.sceneRevision,artifactSceneRevision:ownerArtifactRef.sceneRevision},
    );
    const raw={proposal:safeRaw(proposal),options:safeRaw(options)};
    const fingerprint=stableHash(stableStringify(raw));
    const existing=this.sceneProposals.get(proposal.proposalId);
    if(existing){
      if(existing.fingerprint!==fingerprint)throw new MemoryEvidenceBridgeError(
        'MEMORY_BRIDGE_SCENE_PROPOSAL_CONFLICT',
        'Scene proposal ID was reused with conflicting content',
        {proposalId:proposal.proposalId},
      );
      return deepClone(existing);
    }
    if(this.sceneProposals.size>=MEMORY_LIMITS.maxExternalSceneProposals)throw new MemoryEvidenceBridgeError(
      'MEMORY_BRIDGE_SCENE_PROPOSAL_LIMIT_EXCEEDED',
      'Scene proposal journal reached its configured bound',
      {limit:MEMORY_LIMITS.maxExternalSceneProposals},
    );
    const record={
      kind:'MemorySceneProposalBridgeRecord',
      proposalId:proposal.proposalId,
      ownerArtifactRef,
      proposal:deepClone(proposal),
      options:deepClone(options),
      fingerprint,
      createdSequence:++this.proposalSequence,
      lastResolution:null,
    };
    this.sceneProposals.set(proposal.proposalId,record);
    return deepClone(record);
  }

  acceptSceneEvent(event,{currentSceneRevision=null,sealedGeneration=false}={}){
    if(!event||event.kind!=='CognitiveEventEnvelope')return statusReceipt('MemorySceneOwnerEventReceipt',{
      status:'REJECTED',reasonCode:'MEMORY_BRIDGE_SCENE_EVENT_INVALID',
    });
    if(event.producer!=='SCENE_INTELLIGENCE')return statusReceipt('MemorySceneOwnerEventReceipt',{
      status:'REJECTED',reasonCode:'MEMORY_BRIDGE_SCENE_EVENT_OWNER_MISMATCH',
      details:{producer:event.producer},
    });
    if(String(event.eventVersion??event.schemaVersion??'').split('.')[0]!=='1')return statusReceipt('MemorySceneOwnerEventReceipt',{
      status:'REJECTED',reasonCode:'MEMORY_BRIDGE_SCENE_EVENT_VERSION_MISMATCH',
    });
    const bad=authorityViolation(event)||authorityViolation(event.payload);
    if(bad)return statusReceipt('MemorySceneOwnerEventReceipt',{
      status:'REJECTED',reasonCode:'MEMORY_BRIDGE_AUTHORITY_VIOLATION',details:{field:bad},
    });
    if(sealedGeneration)return statusReceipt('MemorySceneOwnerEventReceipt',{
      status:'REJECTED',reasonCode:'MEMORY_BRIDGE_LATE_SEALED_GENERATION',
      details:{eventId:event.eventId,turnId:event.turnId??null},
    });
    const sceneRevision=positiveRevision(event.sceneRevision,'SceneEvent.sceneRevision');
    if(currentSceneRevision!=null&&sceneRevision!==Number(currentSceneRevision))return statusReceipt('MemorySceneOwnerEventReceipt',{
      status:'STALE',reasonCode:'MEMORY_BRIDGE_SCENE_FENCE_MISMATCH',
      details:{eventSceneRevision:sceneRevision,currentSceneRevision:Number(currentSceneRevision)},
    });
    const eventType=String(event.eventType??'');
    if(!SCENE_EVENT_TYPES.has(eventType))return statusReceipt('MemorySceneOwnerEventReceipt',{
      status:'IGNORED',reasonCode:'MEMORY_BRIDGE_SCENE_EVENT_NOT_REQUIRED',
      eventId:event.eventId,eventType,
    });
    const eventId=requiredString(event.eventId,'SceneEvent.eventId');
    const raw=safeRaw(event);
    const fingerprint=stableHash(stableStringify(raw));
    const prior=this.sceneEvents.get(eventId);
    if(prior){
      if(prior.fingerprint!==fingerprint)return statusReceipt('MemorySceneOwnerEventReceipt',{
        status:'REJECTED',reasonCode:'MEMORY_BRIDGE_SCENE_EVENT_ID_CONFLICT',eventId,eventType,
      });
      return statusReceipt('MemorySceneOwnerEventReceipt',{
        status:'REPLAYED',eventId,eventType,
        affectedSceneProposalIds:[],
      });
    }
    if(this.sceneEvents.size>=MEMORY_LIMITS.maxExternalOwnerEvents)return statusReceipt('MemorySceneOwnerEventReceipt',{
      status:'REJECTED',reasonCode:'MEMORY_BRIDGE_OWNER_EVENT_LIMIT_EXCEEDED',
      details:{limit:MEMORY_LIMITS.maxExternalOwnerEvents},
    });
    const sourceRevisionRefs=uniqStrings(
      event.sourceRevisionSet??event.sourceRevisionRefs??event.revisionFences?.sourceRevisionIds??[],
      MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact,
    );
    const row={
      kind:'MemorySceneOwnerEventRecord',
      eventId,eventType,
      sceneId:requiredString(event.sceneId,'SceneEvent.sceneId'),
      sceneRevision,
      sourceRevisionRefs,
      payload:deepClone(event.payload??{}),
      turnId:event.turnId??null,
      fingerprint,
      rawOwnerInput:raw,
      state:'CURRENT',
      createdSequence:++this.eventSequence,
    };
    this.sceneEvents.set(eventId,row);
    const key=sceneKey(row.sceneId,row.sceneRevision);
    if(eventType==='SCENE_BOUNDARY_CONFIRMED')this.boundaryBySceneRevision.set(key,eventId);
    if(eventType==='SCENE_EPISODE_READY')this.episodeReadyBySceneRevision.set(key,eventId);
    const affectedSceneProposalIds=[...this.sceneProposals.values()]
      .filter((record)=>record.proposal.sceneId===row.sceneId&&Number(record.proposal.sceneRevision)===row.sceneRevision)
      .map((record)=>record.proposalId)
      .sort();
    const receipt=statusReceipt('MemorySceneOwnerEventReceipt',{
      status:eventType==='SCENE_BOUNDARY_CANDIDATE'?'RECORDED_NONCONFIRMING':'ACCEPTED',
      eventId,eventType,
      affectedSceneProposalIds,
      boundaryConfirmed:eventType==='SCENE_BOUNDARY_CONFIRMED',
    });
    this.pushDiagnostic(receipt);
    return receipt;
  }

  boundaryForProposal(proposal){
    const eventId=this.boundaryBySceneRevision.get(sceneKey(proposal.sceneId,proposal.sceneRevision));
    const row=eventId?this.sceneEvents.get(eventId):null;
    if(!row)return {ok:false,reasonCode:'MEMORY_BRIDGE_SCENE_BOUNDARY_UNCONFIRMED'};
    if(row.sourceRevisionRefs.some((ref)=>!this.graph.isSourceRevisionActive(ref)))return {
      ok:false,reasonCode:'MEMORY_BRIDGE_SCENE_BOUNDARY_STALE',eventId:row.eventId,
    };
    return {ok:true,event:deepClone(row)};
  }

  resolveSceneProposal(proposalOrId,{currentSceneRevision=null}={}){
    const record=typeof proposalOrId==='string'
      ? this.sceneProposals.get(proposalOrId)
      : this.sceneProposals.get(proposalOrId?.proposalId)??this.registerSceneProposal(proposalOrId,{});
    if(!record)return statusReceipt('MemorySceneProposalResolution',{
      status:'WITHHELD',reasonCode:'MEMORY_BRIDGE_SCENE_PROPOSAL_UNKNOWN',
    });
    const proposal=record.proposal;
    const reasons=[];
    if(currentSceneRevision!=null&&Number(proposal.sceneRevision)!==Number(currentSceneRevision))reasons.push('MEMORY_BRIDGE_SCENE_FENCE_MISMATCH');
    const boundary=this.boundaryForProposal(proposal);
    if(!boundary.ok)reasons.push(boundary.reasonCode);

    const ownerArtifactRef=record.ownerArtifactRef;
    const mappingIds=[];
    const memoryEvidenceIds=[];
    const unresolvedEvidenceRefs=[];
    const notSceneEligibleRefs=[];
    for(const ref of proposal.evidenceRefs??[]){
      const resolved=this.resolveMapping({
        ownerArtifactRef,
        externalEvidenceRef:ref,
        sceneRevision:Number(proposal.sceneRevision),
      });
      if(!resolved.ok){
        unresolvedEvidenceRefs.push(ref);
        reasons.push(resolved.reasonCode);
        continue;
      }
      mappingIds.push(resolved.mapping.id);
      memoryEvidenceIds.push(resolved.mapping.memoryEvidenceId);
      if(!resolved.mapping.sceneEligible)notSceneEligibleRefs.push(ref);
    }
    if(notSceneEligibleRefs.length)reasons.push('MEMORY_BRIDGE_MENTIONED_ONLY_NOT_SCENE_EVIDENCE');

    const allOwnerMappings=this.mappingsForOwnerArtifact(ownerArtifactRef)
      .filter((mapping)=>mapping.sceneRevision===Number(proposal.sceneRevision));
    const mappedSources=new Set(allOwnerMappings.filter((mapping)=>this.mappingFresh(mapping)).map((mapping)=>mapping.sourceRevisionId));
    const unresolvedSourceRevisionRefs=(proposal.sourceRevisionRefs??[]).filter((ref)=>!mappedSources.has(ref));
    if(unresolvedSourceRevisionRefs.length)reasons.push('MEMORY_BRIDGE_SCENE_SOURCE_MAPPING_MISSING');

    const readyId=this.episodeReadyBySceneRevision.get(sceneKey(proposal.sceneId,proposal.sceneRevision));
    const ready=readyId?this.sceneEvents.get(readyId):null;
    if(ready?.payload?.episodeRef){
      const readyRef=ready.payload.episodeRef;
      if(
        String(readyRef.artifactId??'')!==ownerArtifactRef.artifactId
        ||Number(readyRef.revision??0)!==ownerArtifactRef.revision
      )reasons.push('MEMORY_BRIDGE_SCENE_EPISODE_REF_MISMATCH');
    }

    const uniqueReasons=[...new Set(reasons)].sort();
    const resolved=uniqueReasons.length===0;
    const result=statusReceipt('MemorySceneProposalResolution',{
      status:resolved?'RESOLVED':'WITHHELD',
      reasonCode:resolved?null:uniqueReasons[0],
      details:{reasons:uniqueReasons},
      proposalId:proposal.proposalId,
      sceneId:proposal.sceneId,
      sceneRevision:Number(proposal.sceneRevision),
      sceneBoundaryEventId:boundary.ok?boundary.event.eventId:null,
      sceneEpisodeReadyEventId:ready?.eventId??null,
      ownerArtifactRef,
      mappingIds:[...new Set(mappingIds)].sort(),
      memoryEvidenceIds:[...new Set(memoryEvidenceIds)].sort(),
      memorySourceRevisionRefs:[...mappedSources].filter((ref)=>(proposal.sourceRevisionRefs??[]).includes(ref)).sort(),
      unresolvedEvidenceRefs:unresolvedEvidenceRefs.sort(),
      unresolvedSourceRevisionRefs:unresolvedSourceRevisionRefs.sort(),
      notSceneEligibleRefs:notSceneEligibleRefs.sort(),
    });
    record.lastResolution=deepClone(result);
    return result;
  }

  affectedSceneProposals({ownerArtifactRef,externalEvidenceRef,sourceRevisionId}={}){
    return [...this.sceneProposals.values()].filter((record)=>{
      const p=record.proposal;
      const sameOwner=record.ownerArtifactRef.owner===ownerArtifactRef.owner
        &&record.ownerArtifactRef.artifactId===ownerArtifactRef.artifactId
        &&record.ownerArtifactRef.revision===ownerArtifactRef.revision;
      return sameOwner&&(
        (p.evidenceRefs??[]).includes(externalEvidenceRef)
        ||(p.sourceRevisionRefs??[]).includes(sourceRevisionId)
      );
    }).map((record)=>record.proposalId).sort();
  }

  invalidateMapping({mappingId=null,ownerArtifactRef=null,externalEvidenceRef=null,reason='OWNER_EVIDENCE_INVALIDATED'}={}){
    let mapping=mappingId?this.mappings.get(mappingId):null;
    if(!mapping&&ownerArtifactRef&&externalEvidenceRef){
      const ref=normalizeArtifactRef(ownerArtifactRef);
      const id=this.currentByIdentity.get(baseIdentity(ref,externalEvidenceRef));
      mapping=id?this.mappings.get(id):null;
    }
    if(!mapping)return statusReceipt('MemoryExternalEvidenceInvalidationReceipt',{
      status:'NOT_FOUND',reasonCode:'MEMORY_BRIDGE_MAPPING_MISSING',
    });
    if(mapping.state!=='CURRENT')return statusReceipt('MemoryExternalEvidenceInvalidationReceipt',{
      status:'REPLAYED',mappingId:mapping.id,sourceRevisionId:mapping.sourceRevisionId,
    });
    mapping.state='HISTORICAL';
    mapping.freshness='STALE';
    mapping.staleReason=reason;
    if(this.currentByIdentity.get(mapping.identity)===mapping.id)this.currentByIdentity.delete(mapping.identity);
    const affectedSceneProposalIds=[...this.sceneProposals.values()].filter((record)=>
      record.lastResolution?.mappingIds?.includes(mapping.id)
      ||record.proposal.evidenceRefs?.includes(mapping.externalEvidenceRef)
      ||record.proposal.sourceRevisionRefs?.includes(mapping.sourceRevisionId)
    ).map((record)=>record.proposalId).sort();
    const receipt=statusReceipt('MemoryExternalEvidenceInvalidationReceipt',{
      status:'INVALIDATED',mappingId:mapping.id,sourceRevisionId:mapping.sourceRevisionId,
      affectedSceneProposalIds,reason,
    });
    this.pushDiagnostic(receipt);
    return receipt;
  }

  mapCoreSettlementEnvelope(envelope,{evidenceArtifactRefs=[]}={}){
    if(!envelope||typeof envelope!=='object'||!envelope.proposal||!envelope.decision)throw new MemoryEvidenceBridgeError(
      'MEMORY_CORE_SETTLEMENT_ENVELOPE_REQUIRED',
      'Core Settlement envelope with proposal and decision is required',
    );
    const proposal=envelope.proposal,decision=envelope.decision,receipt=envelope.receipt??null;
    if(proposal.owner!=='WORLD_STATE'||decision.owner!=='WORLD_STATE')throw new MemoryEvidenceBridgeError(
      'MEMORY_CORE_SETTLEMENT_OWNER_MISMATCH',
      'Core Settlement adapter only accepts WORLD_STATE owner envelopes',
      {proposalOwner:proposal.owner,decisionOwner:decision.owner},
    );
    if(decision.proposalId!==proposal.id)throw new MemoryEvidenceBridgeError(
      'MEMORY_CORE_SETTLEMENT_PROPOSAL_MISMATCH',
      'Core Settlement decision does not name the proposal',
    );
    if(receipt&&receipt.proposalId!==proposal.id)throw new MemoryEvidenceBridgeError(
      'MEMORY_CORE_SETTLEMENT_RECEIPT_MISMATCH',
      'Core Settlement receipt does not name the proposal',
    );
    if(!sameSet(decision.evidenceIds??[],proposal.evidenceIds??[]))throw new MemoryEvidenceBridgeError(
      'MEMORY_CORE_SETTLEMENT_DECISION_EVIDENCE_MISMATCH',
      'Core Settlement decision evidence IDs do not match proposal evidence IDs',
      {proposalEvidenceIds:proposal.evidenceIds,decisionEvidenceIds:decision.evidenceIds},
    );
    if(!sameSet(decision.sourceRevisionIds??[],proposal.sourceRevisionIds??[]))throw new MemoryEvidenceBridgeError(
      'MEMORY_CORE_SETTLEMENT_DECISION_SOURCE_MISMATCH',
      'Core Settlement decision source revisions do not match proposal source revisions',
      {proposalSourceRevisionIds:proposal.sourceRevisionIds,decisionSourceRevisionIds:decision.sourceRevisionIds},
    );

    const descriptors=new Map();
    for(const input of evidenceArtifactRefs??[]){
      const externalEvidenceRef=requiredString(input.externalEvidenceRef??input.artifactRef?.artifactId??input.artifactId,'CoreEvidenceDescriptor.externalEvidenceRef');
      const artifactRef=normalizeArtifactRef(input.artifactRef??input,'CoreEvidenceDescriptor.artifactRef');
      descriptors.set(externalEvidenceRef,{externalEvidenceRef,artifactRef});
    }
    const mapped=[];
    for(const externalEvidenceRef of proposal.evidenceIds??[]){
      const descriptor=descriptors.get(externalEvidenceRef);
      if(!descriptor)throw new MemoryEvidenceBridgeError(
        'MEMORY_CORE_EVIDENCE_DESCRIPTOR_REQUIRED',
        'Core evidence ID requires an explicit owner artifact descriptor',
        {externalEvidenceRef},
      );
      const resolution=this.resolveMapping({
        ownerArtifactRef:descriptor.artifactRef,
        externalEvidenceRef,
        worldRevision:descriptor.artifactRef.worldRevision,
      });
      if(!resolution.ok)throw new MemoryEvidenceBridgeError(
        resolution.reasonCode,
        'Core evidence ID could not be reconciled to exact Memory evidence',
        {externalEvidenceRef,artifactRef:descriptor.artifactRef},
      );
      const mapping=resolution.mapping;
      if(!(proposal.sourceRevisionIds??[]).includes(mapping.sourceRevisionId))throw new MemoryEvidenceBridgeError(
        'MEMORY_CORE_EVIDENCE_SOURCE_MISMATCH',
        'Mapped Memory source revision is absent from Core proposal source revisions',
        {externalEvidenceRef,mappedSourceRevisionId:mapping.sourceRevisionId,proposalSourceRevisionIds:proposal.sourceRevisionIds},
      );
      if(!(proposal.freshnessRevisionIds??proposal.sourceRevisionIds??[]).includes(mapping.sourceRevisionId))throw new MemoryEvidenceBridgeError(
        'MEMORY_CORE_EVIDENCE_FRESHNESS_MISMATCH',
        'Mapped Memory source revision is absent from Core freshness revisions',
        {externalEvidenceRef,mappedSourceRevisionId:mapping.sourceRevisionId,freshnessRevisionIds:proposal.freshnessRevisionIds},
      );
      mapped.push(mapping);
    }
    const memoryEvidenceIds=mapped.map((row)=>row.memoryEvidenceId);
    const mappedByExternal=new Map(mapped.map((row)=>[row.externalEvidenceRef,row.memoryEvidenceId]));
    const mappedEnvelope=deepClone(envelope);
    mappedEnvelope.proposal.evidenceIds=(proposal.evidenceIds??[]).map((id)=>mappedByExternal.get(id));
    mappedEnvelope.decision.evidenceIds=(decision.evidenceIds??[]).map((id)=>mappedByExternal.get(id));
    if(mappedEnvelope.proposal.payload?.claim?.provenance){
      mappedEnvelope.proposal.payload.claim.provenance={
        ...mappedEnvelope.proposal.payload.claim.provenance,
        externalEvidenceIds:[...(mappedEnvelope.proposal.payload.claim.provenance.evidenceIds??[])],
        evidenceIds:[...memoryEvidenceIds],
      };
    }
    return {
      kind:'MemoryMappedCoreSettlementEnvelope',
      contractVersion:MEMORY_EVIDENCE_BRIDGE_CONTRACT_VERSION,
      externalProposalId:proposal.id,
      mappingIds:mapped.map((row)=>row.id).sort(),
      externalEvidenceIds:[...(proposal.evidenceIds??[])],
      memoryEvidenceIds,
      sourceRevisionIds:[...(proposal.sourceRevisionIds??[])],
      mappedEnvelope,
      authorityGranted:false,
      settlementAuthority:false,
      canonicalMutationAuthority:false,
      contextSealAuthority:false,
    };
  }

  revisionRef(){
    return 'memory-evidence-bridge:'+stableHash(stableStringify({
      mappingSequence:this.sequence,
      proposalSequence:this.proposalSequence,
      eventSequence:this.eventSequence,
      currentMappings:[...this.currentByIdentity.entries()].sort(),
      sceneBoundary:[...this.boundaryBySceneRevision.entries()].sort(),
      episodeReady:[...this.episodeReadyBySceneRevision.entries()].sort(),
    }));
  }

  status(){
    const current=[...this.currentByIdentity.values()].map((id)=>this.mappings.get(id)).filter(Boolean);
    const rawCharacters=[...this.mappings.values()].reduce((sum,row)=>sum+stableStringify(row.rawOwnerInput).length,0)
      +[...this.sceneEvents.values()].reduce((sum,row)=>sum+stableStringify(row.rawOwnerInput).length,0);
    return {
      kind:'MemoryExternalEvidenceBridgeStatus',
      contractVersion:MEMORY_EVIDENCE_BRIDGE_CONTRACT_VERSION,
      revision:this.revisionRef(),
      mappings:this.mappings.size,
      currentMappings:current.filter((row)=>this.mappingFresh(row)).length,
      sceneProposals:this.sceneProposals.size,
      sceneEvents:this.sceneEvents.size,
      confirmedSceneBoundaries:this.boundaryBySceneRevision.size,
      episodeReadyEvents:this.episodeReadyBySceneRevision.size,
      rawAuditCharacters:rawCharacters,
      limits:{
        maxExternalEvidenceMappings:MEMORY_LIMITS.maxExternalEvidenceMappings,
        maxExternalMappingHistoryPerIdentity:MEMORY_LIMITS.maxExternalMappingHistoryPerIdentity,
        maxExternalSceneProposals:MEMORY_LIMITS.maxExternalSceneProposals,
        maxExternalOwnerEvents:MEMORY_LIMITS.maxExternalOwnerEvents,
        maxExternalRawInputCharacters:MEMORY_LIMITS.maxExternalRawInputCharacters,
      },
      externalDatabaseRequired:false,
      providerRequired:false,
      backgroundServiceRequired:false,
      authorityGranted:false,
      settlementAuthority:false,
      canonicalMutationAuthority:false,
      contextSealAuthority:false,
      diagnostics:deepClone(this.diagnostics).slice(-MEMORY_LIMITS.maxDiagnostics),
    };
  }

  pushDiagnostic(row){
    this.diagnostics.push(deepClone(row));
    if(this.diagnostics.length>MEMORY_LIMITS.maxDiagnostics)this.diagnostics.splice(0,this.diagnostics.length-MEMORY_LIMITS.maxDiagnostics);
  }

  snapshot(){
    return {
      kind:'MemoryExternalEvidenceBridgeSnapshot',
      contractVersion:MEMORY_EVIDENCE_BRIDGE_CONTRACT_VERSION,
      mappings:[...this.mappings.values()].map(deepClone),
      historyByIdentity:[...this.historyByIdentity.entries()].map(([key,value])=>[key,[...value]]),
      currentByIdentity:[...this.currentByIdentity.entries()],
      sceneProposals:[...this.sceneProposals.entries()].map(([key,value])=>[key,deepClone(value)]),
      sceneEvents:[...this.sceneEvents.entries()].map(([key,value])=>[key,deepClone(value)]),
      boundaryBySceneRevision:[...this.boundaryBySceneRevision.entries()],
      episodeReadyBySceneRevision:[...this.episodeReadyBySceneRevision.entries()],
      sequence:this.sequence,
      proposalSequence:this.proposalSequence,
      eventSequence:this.eventSequence,
      diagnostics:deepClone(this.diagnostics),
    };
  }

  restore(snapshot){
    this.mappings=new Map((snapshot?.mappings??[]).map((row)=>[row.id,deepClone(row)]));
    this.historyByIdentity=new Map((snapshot?.historyByIdentity??[]).map(([key,value])=>[key,[...value]]));
    this.currentByIdentity=new Map(snapshot?.currentByIdentity??[]);
    this.sceneProposals=new Map((snapshot?.sceneProposals??[]).map(([key,value])=>[key,deepClone(value)]));
    this.sceneEvents=new Map((snapshot?.sceneEvents??[]).map(([key,value])=>[key,deepClone(value)]));
    this.boundaryBySceneRevision=new Map(snapshot?.boundaryBySceneRevision??[]);
    this.episodeReadyBySceneRevision=new Map(snapshot?.episodeReadyBySceneRevision??[]);
    this.sequence=Number(snapshot?.sequence??0);
    this.proposalSequence=Number(snapshot?.proposalSequence??0);
    this.eventSequence=Number(snapshot?.eventSequence??0);
    this.diagnostics=deepClone(snapshot?.diagnostics??[]).slice(-MEMORY_LIMITS.maxDiagnostics);
  }
}
