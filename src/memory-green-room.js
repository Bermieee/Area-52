import {
  AuthorityClass,
  GREEN_ROOM_COMPAT_VERSION,
  MEMORY_LIMITS,
  deepClone,
  requiredString,
  stableHash,
  uniqStrings,
  unitNumber,
} from './memory-contracts.js';

const DIMENSIONS=new Set(['guardedness','warmth','anger','trustTrend','anxiety','latentIntent','attentionTarget','socialPressure','uncertainty']);

function normalizeDimensions(input={}) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new TypeError('Green Room dimensions must be an object');
  const rows=Object.entries(input);
  if (rows.length>MEMORY_LIMITS.maxGreenRoomDimensions) throw new RangeError('Green Room dimensions exceed bound');
  const out={};
  for (const [key,value] of rows) {
    if (!DIMENSIONS.has(key)) throw new Error('MEMORY_GREEN_ROOM_DIMENSION_UNKNOWN:'+key);
    out[key]=deepClone(value);
  }
  return out;
}

function normalizeInference(input,sequence=0) {
  if (!input || input.kind!=='GreenRoomInference') throw new TypeError('Memory requires GreenRoomInference');
  if (input.contractVersion!==GREEN_ROOM_COMPAT_VERSION) throw new Error('MEMORY_GREEN_ROOM_CONTRACT_MISMATCH:'+String(input.contractVersion));
  if (input.authority!=='INFERRED' || input.canonical || input.settlementAuthority || input.memoryMutation || input.characterStateMutation) {
    throw new Error('MEMORY_GREEN_ROOM_AUTHORITY_VIOLATION');
  }
  const sourceRevisionSet=uniqStrings(input.sourceRevisionSet??[],32);
  const directEvidenceRefs=uniqStrings(input.directEvidenceRefs??input.evidenceRefs??[],16);
  const priorInferenceRefs=uniqStrings(input.priorInferenceRefs??[],16);
  const characterRef=requiredString(input.characterRef,'GreenRoomInference.characterRef');
  const sceneRevision=Number(input.sceneRevision);
  if (!Number.isInteger(sceneRevision)||sceneRevision<0) throw new TypeError('sceneRevision must be non-negative integer');
  const expiry=input.expiryCondition??{};
  return {
    kind:'MemoryGreenRoomInference',
    id:'memory-green-room:' + stableHash(characterRef+'|'+sceneRevision+'|'+String(input.supportIdentity??'')+'|'+sequence),
    contractVersion:GREEN_ROOM_COMPAT_VERSION,
    characterRef,
    sceneRevision,
    directEvidenceRefs,
    evidenceRefs:directEvidenceRefs,
    priorInferenceRefs,
    confidence:unitNumber(input.confidence,'GreenRoomInference.confidence'),
    dimensions:normalizeDimensions(input.dimensions??{}),
    createdAt:Number(input.createdAt??0),
    updatedAt:Number(input.updatedAt??input.createdAt??0),
    expiryCondition:{
      onSceneClose:expiry.onSceneClose!==false,
      onSceneReplacement:expiry.onSceneReplacement!==false,
      onMajorTimeShift:expiry.onMajorTimeShift!==false,
      onCharacterDeparture:expiry.onCharacterDeparture!==false,
      onContradiction:expiry.onContradiction!==false,
      onSourceRevisionInvalidation:expiry.onSourceRevisionInvalidation!==false,
      ttlTurns:Number.isInteger(Number(expiry.ttlTurns))?Number(expiry.ttlTurns):2,
    },
    sourceRevisionSet,
    supportIdentity:String(input.supportIdentity??['green-room',characterRef,sceneRevision,directEvidenceRefs.join(','),sourceRevisionSet.join(',')].join(':')),
    authority:AuthorityClass.INFERRED,
    canonical:false,
    settlementAuthority:false,
    memoryMutation:false,
    characterStateMutation:false,
    state:'ACTIVE',
    storedTurn:null,
    expiresAfterTurns:Number.isInteger(Number(expiry.ttlTurns))?Number(expiry.ttlTurns):2,
    expiryReason:null,
    storedSequence:sequence,
  };
}

export class MemoryGreenRoomStore {
  constructor(snapshot=null) {
    this.activeByCharacter=new Map();
    this.history=[];
    this.sequence=0;
    this.metrics={accepted:0,expired:0,batches:0,reflectionProposals:0,authorityRejected:0};
    if (snapshot) this.restore(snapshot);
  }

  ingestBatch(batch,{turnSequence=0}={}) {
    if (!batch || batch.kind!=='GreenRoomBatch') throw new TypeError('Memory requires GreenRoomBatch');
    if (batch.contractVersion!==GREEN_ROOM_COMPAT_VERSION) throw new Error('MEMORY_GREEN_ROOM_CONTRACT_MISMATCH:'+String(batch.contractVersion));
    if (batch.authority!=='INFERRED' || batch.canonical || batch.durableMutation) throw new Error('MEMORY_GREEN_ROOM_AUTHORITY_VIOLATION');
    if (!Array.isArray(batch.characters)) throw new TypeError('GreenRoomBatch.characters must be array');
    if (batch.characters.length>MEMORY_LIMITS.maxGreenRoomCharacters) throw new RangeError('Green Room batch exceeds Memory bound');
    const seen=new Set();
    const accepted=[];
    for (const input of batch.characters) {
      if (seen.has(input.characterRef)) throw new Error('MEMORY_GREEN_ROOM_DUPLICATE_CHARACTER:'+input.characterRef);
      seen.add(input.characterRef);
      const row=normalizeInference(input,++this.sequence);
      row.storedTurn=Number(turnSequence);
      row.expiresAfterTurns=row.expiryCondition.ttlTurns;
      const prior=this.activeByCharacter.get(row.characterRef);
      if (prior) {
        prior.state='HISTORICAL';
        prior.expiryReason='REPLACED_BY_NEW_INFERENCE';
      }
      this.activeByCharacter.set(row.characterRef,row);
      this.history.push(row);
      accepted.push(deepClone(row));
      this.metrics.accepted+=1;
    }
    this.metrics.batches+=1;
    if (this.history.length>MEMORY_LIMITS.maxGreenRoomHistory) {
      this.history.splice(0,this.history.length-MEMORY_LIMITS.maxGreenRoomHistory);
    }
    return {
      kind:'MemoryGreenRoomBatchReceipt',
      sceneRevision:Number(batch.sceneRevision),
      accepted,
      activeCount:this.activeByCharacter.size,
      authority:AuthorityClass.INFERRED,
      canonicalMutation:false,
      characterStateMutation:false,
    };
  }

  expire(context={}) {
    const expired=[];
    const invalidated=new Set(context.invalidatedSourceRevisionRefs??[]);
    const activeSet=Array.isArray(context.activeCharacterRefs)?new Set(context.activeCharacterRefs):null;
    for (const [characterRef,row] of [...this.activeByCharacter.entries()]) {
      let reason=null;
      if (context.chatSwitch) reason='CHAT_SWITCH';
      else if (context.sceneCorrection) reason='SCENE_CORRECTION';
      else if (context.sceneRevision!=null && Number(context.sceneRevision)!==row.sceneRevision) reason='SCENE_REVISION_CHANGED';
      else if (context.sceneClosed && row.expiryCondition.onSceneClose) reason='SCENE_CLOSED';
      else if (context.sceneReplaced && row.expiryCondition.onSceneReplacement) reason='SCENE_REPLACED';
      else if (context.majorTimeShift && row.expiryCondition.onMajorTimeShift) reason='MAJOR_TIME_SHIFT';
      else if (activeSet && row.expiryCondition.onCharacterDeparture && !activeSet.has(characterRef)) reason='CHARACTER_DEPARTED';
      else if ((context.contradictoryCharacterRefs??[]).includes(characterRef) && row.expiryCondition.onContradiction) reason='CONTRADICTORY_EVIDENCE';
      else if (row.expiryCondition.onSourceRevisionInvalidation && row.sourceRevisionSet.some((id)=>invalidated.has(id))) reason='SOURCE_REVISION_INVALIDATED';
      else if (context.turnSequence!=null && Number(context.turnSequence)-Number(row.storedTurn)>row.expiresAfterTurns) reason='TTL_EXPIRED';
      if (!reason) continue;
      row.state='EXPIRED';
      row.expiryReason=reason;
      this.activeByCharacter.delete(characterRef);
      expired.push({characterRef,inferenceId:row.id,reason});
      this.metrics.expired+=1;
    }
    return {kind:'MemoryGreenRoomExpiryReceipt',expired,activeCount:this.activeByCharacter.size};
  }

  active(context={}) {
    if (Object.keys(context).length) this.expire(context);
    return [...this.activeByCharacter.values()].map(deepClone).sort((a,b)=>a.characterRef.localeCompare(b.characterRef));
  }

  compactShadow(context={}) {
    return {
      kind:'MemoryGreenRoomShadowState',
      contractVersion:'1.0.0',
      lane:'greenRoom',
      sceneRevision:context.sceneRevision??null,
      authority:AuthorityClass.INFERRED,
      canonical:false,
      freshness:'FRESH',
      characters:this.active(context).map((row)=>({
        characterRef:row.characterRef,
        characterId:row.characterRef,
        dimensions:deepClone(row.dimensions),
        confidence:row.confidence,
        evidenceRefs:[...row.directEvidenceRefs],
        sourceRevisionSet:[...row.sourceRevisionSet],
        sceneRevision:row.sceneRevision,
        expiry:deepClone(row.expiryCondition),
        supportIdentity:row.supportIdentity,
        authority:AuthorityClass.INFERRED,
      })),
      durableMutation:false,
      characterStateMutation:false,
      settlementAuthority:false,
    };
  }

  createReflectionProposal(characterRef,{minCompatibleObservations=3,contradictingEvidenceRefs=[]}={}) {
    const rows=this.history.filter((row)=>row.characterRef===characterRef && row.directEvidenceRefs.length);
    const bySupport=new Map();
    for (const row of rows) if (!bySupport.has(row.supportIdentity)) bySupport.set(row.supportIdentity,row);
    const independent=[...bySupport.values()];
    if (independent.length<minCompatibleObservations) return null;
    const proposal={
      kind:'MemoryReflectionProposal',
      proposalId:'memory-reflection-proposal:' + stableHash(characterRef+'|'+independent.map((row)=>row.supportIdentity).sort().join('|')),
      characterRef,
      supportingEvidenceRefs:uniqStrings(independent.flatMap((row)=>row.directEvidenceRefs),MEMORY_LIMITS.maxReflectionSupportRefs),
      sourceRevisionSet:uniqStrings(independent.flatMap((row)=>row.sourceRevisionSet),MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact),
      observationCount:independent.length,
      compatibleInferenceRefs:independent.map((row)=>row.id),
      contradictingEvidenceRefs:uniqStrings(contradictingEvidenceRefs,MEMORY_LIMITS.maxReflectionContradictionRefs),
      sceneRevision:independent.at(-1)?.sceneRevision??null,
      authority:AuthorityClass.INFERRED,
      durableMutation:false,
      characterStateMutation:false,
      settlementAuthority:false,
      destination:'MEMORY_REFLECTION_REVIEW',
    };
    this.metrics.reflectionProposals+=1;
    return proposal;
  }

  snapshot() {
    return {
      kind:'MemoryGreenRoomStoreSnapshot',
      activeByCharacter:[...this.activeByCharacter.entries()].map(([k,v])=>[k,deepClone(v)]),
      history:this.history.map(deepClone),
      sequence:this.sequence,
      metrics:deepClone(this.metrics),
    };
  }

  restore(snapshot) {
    this.activeByCharacter=new Map((snapshot?.activeByCharacter??[]).map(([k,v])=>[k,deepClone(v)]));
    this.history=(snapshot?.history??[]).map(deepClone).slice(-MEMORY_LIMITS.maxGreenRoomHistory);
    this.sequence=Number(snapshot?.sequence??0);
    this.metrics={accepted:0,expired:0,batches:0,reflectionProposals:0,authorityRejected:0,...deepClone(snapshot?.metrics??{})};
  }
}
