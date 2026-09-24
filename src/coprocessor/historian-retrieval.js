import {
  Capability, FailureCode, Placement, ResultClass, ResultDestination, TelemetryEvent,
} from './constants.js';
import { createArtifactReference } from './artifact-reference.js';
import {
  CandidateAuthorityClass, CandidateFreshness, CandidateTruthStatus, createCandidateBusEnvelope,
} from './candidate-bus.js';
import { createCognitiveTask, createRevisionSet } from './contracts.js';
import { buildBoundedProviderPayload, assertProviderPayloadBoundary } from './provider-payload-boundary.js';
import { utf8ByteLength } from './browser-compat.js';
import { emitTelemetry } from './telemetry.js';

export const HISTORIAN_CONTRACT_VERSION = '1.0.0';

export const HistorianRetrievalMode = Object.freeze({
  CONTINUITY_RECALL: 'CONTINUITY_RECALL',
  EXPLICIT_HISTORY: 'EXPLICIT_HISTORY',
  RELATIONSHIP_HISTORY: 'RELATIONSHIP_HISTORY',
  EVENT_CAUSAL_RECALL: 'EVENT_CAUSAL_RECALL',
  REFLECTION_RECALL: 'REFLECTION_RECALL',
});

export const HistorianPerspectiveScope = Object.freeze({
  WORLD: 'WORLD',
  CHARACTER_KNOWLEDGE: 'CHARACTER_KNOWLEDGE',
  OBSERVED_BY: 'OBSERVED_BY',
  HEARD_FROM: 'HEARD_FROM',
  BELIEVED: 'BELIEVED',
  UNCERTAIN: 'UNCERTAIN',
  FALSE_BELIEF: 'FALSE_BELIEF',
  PERSPECTIVE_UNAVAILABLE: 'PERSPECTIVE_UNAVAILABLE',
});

export const HistorianMemoryChannel = Object.freeze({
  SCENE_EPISODE: 'SCENE_EPISODE',
  EXPERIENCE: 'EXPERIENCE',
  EPISODIC_MEMORY: 'EPISODIC_MEMORY',
  RELATIONSHIP_EVENT: 'RELATIONSHIP_EVENT',
  REFLECTION: 'REFLECTION',
  CAUSAL_EVENT: 'CAUSAL_EVENT',
  UNRESOLVED_HYPOTHESIS: 'UNRESOLVED_HYPOTHESIS',
  HISTORICAL_STATE: 'HISTORICAL_STATE',
});

export const HistorianResolverStatus = Object.freeze({
  OK: 'OK',
  DEGRADED: 'DEGRADED',
  PERSPECTIVE_UNAVAILABLE: 'PERSPECTIVE_UNAVAILABLE',
});

const MODES = new Set(Object.values(HistorianRetrievalMode));
const PERSPECTIVES = new Set(Object.values(HistorianPerspectiveScope));
const CHANNELS = new Set(Object.values(HistorianMemoryChannel));
const AUTHORITIES = new Set(Object.values(CandidateAuthorityClass));
const TRUTH = new Set(Object.values(CandidateTruthStatus));
const RESOLVER_STATUSES = new Set(Object.values(HistorianResolverStatus));
const LIMITS = Object.freeze({
  maxRetrievalIntents:16,maxActiveEntities:32,maxActiveThreads:32,maxArtifacts:48,maxEpisodes:24,maxReflections:12,
  maxEvidenceRefs:128,maxEvidenceBytes:65536,maxProviderExcerptChars:1600,maxProviderCandidates:48,
});

export function createHistorianTask(input = {}) {
  const intents = normalizeIntents(input.retrievalIntents ?? [], input.retrievalIntentIds ?? []);
  if (!intents.length) throw new TypeError('Historian requires at least one retrieval intent');
  const perspective = normalizePerspective(input.perspectiveConstraint ?? { scope: HistorianPerspectiveScope.WORLD });
  const revisions = createRevisionSet(input);
  const caps = normalizeLimits(input);
  return createCognitiveTask({
    taskId: input.taskId ?? `historian:${input.turnId}:${input.sceneRevision ?? 0}:${intents.map((x)=>x.intentId).join('+')}`,
    taskType: 'HISTORIAN_RETRIEVAL',
    turnId: input.turnId,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    requiredCapabilities: [Capability.RETRIEVAL, Capability.LONG_CONTEXT],
    optionalCapabilities: [Capability.SEMANTIC_JUDGMENT, Capability.RERANK, Capability.REFLECTION],
    cognitiveLayer: 'L1',
    resultClass: input.resultClass ?? ResultClass.OPPORTUNISTIC,
    inputRevisionSet: revisions,
    softDeadline: input.softDeadline ?? 70,
    hardDeadline: input.hardDeadline ?? 120,
    placement: Placement.HOT,
    contextSealPolicy: 'BEFORE_SEAL_ONLY',
    compilerLane: 'loreEvidence',
    intentFingerprint: input.intentFingerprint ?? `historian:${input.turnId}:${intents.map((x)=>x.intentId).join('|')}`,
    fallbackPolicy: input.fallbackPolicy ?? { type:'DETERMINISTIC_RETRIEVAL', maxRetries:1 },
    batchMetadata: { batchable:true,slicePolicy:'RETRIEVAL_INTENT',checkpointBoundary:'TASK',yieldSafety:'NOT_APPLICABLE',partialResultSemantics:'PRESERVE_VALID_NOMINATIONS' },
    metadata: {
      retrievalIntents:intents,
      retrievalIntentIds:intents.map((x)=>x.intentId),
      activeEntityIds:strings(input.activeEntityIds ?? [],LIMITS.maxActiveEntities,'activeEntityIds'),
      activeThreadIds:strings(input.activeThreadIds ?? [],LIMITS.maxActiveThreads,'activeThreadIds'),
      locationRef:opt(input.locationRef),sceneRef:opt(input.sceneRef),
      temporalConstraint:normalizeTemporal(input.temporalConstraint),
      perspectiveConstraint:perspective,perspectiveFingerprint:perspectiveFingerprint(perspective),
      memoryRevisionRefs:strings(input.memoryRevisionRefs ?? [],64,'memoryRevisionRefs'),
      ...caps,expectedOutputTokens:1200,provenanceRequired:true,durableMutationAllowed:false,truthAuthorityGranted:false,
    },
  });
}

export function createHistorianMemoryRequest(task, overrides = {}) {
  const perspective = normalizePerspective(overrides.perspectiveConstraint ?? task.metadata.perspectiveConstraint);
  const caps = normalizeLimits({ ...task.metadata, ...overrides });
  return freeze({
    kind:'HistorianMemoryRequest',contractVersion:HISTORIAN_CONTRACT_VERSION,requestId:`memory:${task.taskId}`,
    turnId:task.turnId,taskId:task.taskId,correlationId:task.correlationId,causationId:task.causationId,
    retrievalIntents:structuredClone(task.metadata.retrievalIntents),retrievalIntentIds:[...task.metadata.retrievalIntentIds],
    activeEntityIds:[...(overrides.activeEntityIds ?? task.metadata.activeEntityIds)],activeThreadIds:[...(overrides.activeThreadIds ?? task.metadata.activeThreadIds)],
    locationRef:overrides.locationRef ?? task.metadata.locationRef,sceneRef:overrides.sceneRef ?? task.metadata.sceneRef,
    temporalConstraint:structuredClone(overrides.temporalConstraint ?? task.metadata.temporalConstraint),perspectiveConstraint:perspective,
    sourceRevisionSet:[...task.sourceRevisionSet],worldRevision:task.worldRevision,sceneRevision:task.sceneRevision,
    characterStateRevision:task.characterStateRevision,memoryRevisionRefs:[...(overrides.memoryRevisionRefs ?? task.metadata.memoryRevisionRefs)],
    intentFingerprint:task.intentFingerprint,
    freshnessFence:{
      sourceRevisionSet:[...task.sourceRevisionSet],worldRevision:task.worldRevision,sceneRevision:task.sceneRevision,
      characterStateRevision:task.characterStateRevision,intentFingerprint:task.intentFingerprint,
      perspectiveFingerprint:perspectiveFingerprint(perspective),memoryRevisionRefs:[...(overrides.memoryRevisionRefs ?? task.metadata.memoryRevisionRefs)],
    },
    limits:caps,referenceFirst:true,authorityGranted:false,memoryMutation:false,
  });
}

export class HistorianMemoryResolver {
  constructor({ resolve } = {}) {
    if (typeof resolve !== 'function') throw new TypeError('HistorianMemoryResolver requires resolve(request)');
    this.resolveFn = resolve;
  }
  async resolve(request) { return validateHistorianResolverResponse(await this.resolveFn(structuredClone(request)), request); }
}

export function validateHistorianResolverResponse(value, request) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(FailureCode.SCHEMA_INVALID,'Historian resolver response must be an object');
  const status = value.status ?? HistorianResolverStatus.OK;
  if (!RESOLVER_STATUSES.has(status)) fail(FailureCode.SCHEMA_INVALID,`unsupported Historian resolver status: ${status}`);
  const unavailableChannels = strings(value.unavailableChannels ?? [],32,'unavailableChannels');
  const memoryRevisionRefs = strings(value.memoryRevisionRefs ?? request.memoryRevisionRefs ?? [],64,'memoryRevisionRefs');
  if ((request.memoryRevisionRefs ?? []).length && !sameSet(memoryRevisionRefs,request.memoryRevisionRefs)) fail(FailureCode.STALE_RESULT,'Historian Memory revision fence changed');
  if (status === HistorianResolverStatus.PERSPECTIVE_UNAVAILABLE) return freeze({
    kind:'HistorianMemoryResolution',contractVersion:HISTORIAN_CONTRACT_VERSION,status,artifacts:[],unavailableChannels,memoryRevisionRefs,
    perspectiveStatus:HistorianPerspectiveScope.PERSPECTIVE_UNAVAILABLE,evidenceBytes:0,authorityGranted:false,memoryMutation:false,
  });
  if (!Array.isArray(value.artifacts)) fail(FailureCode.SCHEMA_INVALID,'Historian resolver artifacts must be an array');
  const limits=request.limits ?? normalizeLimits({});
  if (value.artifacts.length>limits.maxArtifacts) fail(FailureCode.SCHEMA_INVALID,`Historian artifacts exceed ${limits.maxArtifacts}`);
  const artifacts=value.artifacts.map((row,i)=>normalizeArtifact(row,request,i));
  const reflections=artifacts.filter((x)=>x.channel===HistorianMemoryChannel.REFLECTION).length;
  if (reflections>limits.maxReflections) fail(FailureCode.SCHEMA_INVALID,`Historian Reflections exceed ${limits.maxReflections}`);
  if (artifacts.length-reflections>limits.maxEpisodes) fail(FailureCode.SCHEMA_INVALID,`Historian episodes exceed ${limits.maxEpisodes}`);
  const evidenceBytes=utf8ByteLength(JSON.stringify(artifacts.map((x)=>providerSlice(x))));
  if (evidenceBytes>limits.maxEvidenceBytes) fail(FailureCode.SCHEMA_INVALID,`Historian evidence exceeds ${limits.maxEvidenceBytes}`);
  enforcePerspective(artifacts,request.perspectiveConstraint);
  return freeze({kind:'HistorianMemoryResolution',contractVersion:HISTORIAN_CONTRACT_VERSION,status,artifacts,unavailableChannels,memoryRevisionRefs,
    perspectiveStatus:value.perspectiveStatus ?? request.perspectiveConstraint.scope,evidenceBytes,authorityGranted:false,memoryMutation:false});
}

export function createHistorianProviderInput(task,input={}) {
  if (Array.isArray(input.candidates) && !input.resolution && !input.artifacts) return legacyProviderInput(task,input);
  const request=input.request ?? createHistorianMemoryRequest(task,input);
  const resolution=input.resolution?.kind==='HistorianMemoryResolution'?input.resolution:
    validateHistorianResolverResponse(input.resolution ?? {status:'OK',artifacts:input.artifacts ?? [],memoryRevisionRefs:request.memoryRevisionRefs},request);
  const limits=request.limits;
  const selected=resolution.artifacts.slice(0,limits.maxProviderCandidates).map((x)=>providerSlice(x,limits.maxProviderExcerptChars));
  const payload=buildBoundedProviderPayload({
    taskSlice:{
      taskId:task.taskId,turnId:task.turnId,retrievalIntents:request.retrievalIntents,retrievalIntentIds:request.retrievalIntentIds,
      activeEntityIds:request.activeEntityIds,activeThreadIds:request.activeThreadIds,locationRef:request.locationRef,sceneRef:request.sceneRef,
      temporalConstraint:request.temporalConstraint,perspectiveConstraint:request.perspectiveConstraint,
      sourceRevisionSet:request.sourceRevisionSet,worldRevision:request.worldRevision,sceneRevision:request.sceneRevision,
      characterStateRevision:request.characterStateRevision,memoryRevisionRefs:request.memoryRevisionRefs,intentFingerprint:request.intentFingerprint,
      maxArtifacts:limits.maxArtifacts,maxEpisodes:limits.maxEpisodes,maxReflections:limits.maxReflections,maxEvidenceBytes:limits.maxEvidenceBytes,
    },
    sourceReferences:selected.map((x)=>x.artifactRef).filter(Boolean),
    selectedContext:selected.map((x)=>({
      ref:x.candidateId,revision:x.artifactRef?.revision ?? null,excerpt:x.representationText,
      structuredFacts:[{retrievalIntentIds:x.retrievalIntentIds,entityRefs:x.entityRefs,relationshipRefs:x.relationshipRefs,eventRefs:x.eventRefs,
        claimRefs:x.claimRefs,temporalHints:x.temporalHints,authorityClass:x.authorityClass,truthStatusHint:x.truthStatusHint,perspective:x.perspective,channel:x.channel}],
      provenanceRef:x.provenance?.[0]?.ref ?? x.artifactRef?.provenanceRef ?? null,
    })),
    diagnosticMetadata:{taskClass:'HISTORIAN_RETRIEVAL',cognitiveLayer:task.cognitiveLayer,resultClass:task.resultClass,placement:task.placement,
      resolverStatus:resolution.status,unavailableChannels:resolution.unavailableChannels,evidenceBytes:resolution.evidenceBytes},
  });
  assertProviderPayloadBoundary(payload);
  return freeze({...payload,candidates:selected.map((x)=>({...x,ref:x.candidateId,summary:x.representationText})),maxRefs:limits.maxProviderCandidates});
}

export function validateHistorianProviderOutput(value,{input={},task,providerInput=null}={}) {
  const object=typeof value==='string'?parseObject(value):value;
  if (!object || typeof object!=='object' || Array.isArray(object)) fail(FailureCode.SCHEMA_INVALID,'Historian output must be an object');
  const sourceCandidates=providerInput?.data?.candidates ?? providerInput?.candidates ?? input.candidates ?? [];
  const allowed=new Map(sourceCandidates.map((x)=>[x.candidateId ?? x.ref,x]));
  if (!allowed.size && input.resolution?.artifacts) for (const x of input.resolution.artifacts) allowed.set(x.candidateId,x);
  const uncertainty=uncertaintyEnum(object.uncertainty ?? 'UNRESOLVED');
  const reasoningSummary=text(object.reasoningSummary ?? '',600,'reasoningSummary');
  let nominations;
  if (Array.isArray(object.refs)) {
    const refs=selectedRefs(object.refs,allowed,task?.metadata?.maxProviderCandidates ?? input.maxRefs ?? allowed.size);
    const scores=new Map((object.relevance ?? []).map((r)=>[required(r.ref,'relevance.ref'),unit(r.score,'relevance.score')]));
    nominations=refs.map((candidateId)=>({candidateId,retrievalIntentIds:allowed.get(candidateId)?.retrievalIntentIds ?? task?.metadata?.retrievalIntentIds ?? [],rankSignals:{intentMatch:scores.get(candidateId) ?? 0}}));
  } else {
    const legal=new Set(['kind','contractVersion','nominations','uncertainty','reasoningSummary','authorityGranted','memoryMutation','truthAuthorityGranted']);
    for (const key of Object.keys(object)) if (!legal.has(key)) fail(FailureCode.SCHEMA_INVALID,`Historian output has unsupported field: ${key}`);
    if (object.authorityGranted||object.memoryMutation||object.truthAuthorityGranted) fail(FailureCode.AUTHORITY_VIOLATION,'Historian attempted authority escalation');
    if (!Array.isArray(object.nominations)) fail(FailureCode.SCHEMA_INVALID,'Historian nominations must be an array');
    const cap=task?.metadata?.maxProviderCandidates ?? LIMITS.maxProviderCandidates;
    if (object.nominations.length>cap) fail(FailureCode.SCHEMA_INVALID,`Historian nominations exceed ${cap}`);
    nominations=object.nominations.map((row)=>{
      const candidateId=required(row.candidateId ?? row.ref,'candidateId');
      if (!allowed.has(candidateId)) fail(FailureCode.UNKNOWN_REFERENCE,`Unknown Historian candidate: ${candidateId}`);
      const legalRow=new Set(['candidateId','ref','rankSignals','retrievalIntentIds']);
      for (const key of Object.keys(row)) if (!legalRow.has(key)) fail(FailureCode.AUTHORITY_VIOLATION,`Historian provider cannot rewrite candidate metadata: ${key}`);
      const ids=strings(row.retrievalIntentIds ?? allowed.get(candidateId).retrievalIntentIds ?? [],LIMITS.maxRetrievalIntents,'retrievalIntentIds');
      for (const id of ids) if (!(task?.metadata?.retrievalIntentIds ?? []).includes(id)) fail(FailureCode.UNKNOWN_REFERENCE,`Unknown Historian intent: ${id}`);
      return {candidateId,retrievalIntentIds:ids,rankSignals:rankSignals(row.rankSignals ?? {})};
    });
  }
  const candidateSet=createHistorianCandidateSet({task,sourceCandidates,nominations,unavailableChannels:input.resolution?.unavailableChannels ?? [],query:input.query ?? null});
  return freeze({
    kind:'HistorianRetrievalResult',contractVersion:HISTORIAN_CONTRACT_VERSION,lane:'loreEvidence',
    refs:candidateSet.candidates.map((x)=>x.candidateId),
    relevance:candidateSet.candidates.map((x)=>({ref:x.candidateId,score:bestSignal(x.rankSignals)})),
    uncertainty,reasoningSummary,candidates:candidateSet.candidates,candidateSet,retrievalIntentIds:[...(task?.metadata?.retrievalIntentIds ?? [])],
    memoryRevisionRefs:[...(task?.metadata?.memoryRevisionRefs ?? [])],perspectiveConstraint:structuredClone(task?.metadata?.perspectiveConstraint ?? null),
    evidence:candidateSet.candidates.map((x)=>({id:x.candidateId,semanticKey:x.metadata?.semanticKey ?? x.candidateId,value:x.representationText,
      temporalStatus:x.truthStatus,authority:x.authorityClass,sourceRevisionRefs:x.sourceRevisionRefs,provenance:x.provenance})),
    authorityGranted:false,memoryMutation:false,truthAuthorityGranted:false,
  });
}

export function createHistorianCandidateSet({task,sourceCandidates=[],nominations=[],unavailableChannels=[],query=null}={}) {
  const source=new Map(sourceCandidates.map((x)=>[x.candidateId ?? x.ref,x]));
  const candidates=nominations.map((n)=>{
    const original=source.get(n.candidateId);
    if (!original) fail(FailureCode.UNKNOWN_REFERENCE,`Unknown Historian candidate: ${n.candidateId}`);
    const truthStatus=original.truthStatusHint ?? original.truthStatus ?? CandidateTruthStatus.UNKNOWN;
    const authorityClass=original.channel===HistorianMemoryChannel.REFLECTION?CandidateAuthorityClass.INFERRED:
      original.authorityClass ?? original.authority ?? CandidateAuthorityClass.UNKNOWN;
    return {
      candidateId:n.candidateId,evidenceIdentity:original.evidenceIdentity ?? evidenceIdentity(original),artifactRef:original.artifactRef ?? null,
      sourceRevisionRefs:[...(original.sourceRevisionRefs ?? original.sourceRevisionSet ?? [])],worldRevision:task?.worldRevision ?? original.worldRevision ?? null,
      sceneRevision:task?.sceneRevision ?? original.sceneRevision ?? null,channel:`HISTORIAN_${original.channel ?? 'MEMORY'}`,
      nominatedBy:[`HISTORIAN_${original.channel ?? 'MEMORY'}`],rankSignals:{...(original.rankSignals ?? {}),...(n.rankSignals ?? {})},
      entityRefs:[...(original.entityRefs ?? [])],relationshipRefs:[...(original.relationshipRefs ?? [])],eventRefs:[...(original.eventRefs ?? [])],
      claimRefs:[...(original.claimRefs ?? [])],retrievalIntentIds:[...(n.retrievalIntentIds ?? original.retrievalIntentIds ?? [])],
      temporalHints:[...(original.temporalHints ?? [])],sceneRelevance:original.sceneRelevance ?? null,authorityClass,truthStatus,truthStatusHint:truthStatus,
      provenance:structuredClone(original.provenance ?? []),evidenceRefs:[...(original.evidenceRefs ?? original.sourceRevisionRefs ?? [])],
      representationText:original.representationText ?? original.summary ?? original.statement ?? null,freshness:CandidateFreshness.FRESH,
      dependencyRevisions:[...(original.dependencyRevisions ?? [])],perspective:structuredClone(original.perspective ?? null),
      metadata:{memoryChannel:original.channel ?? null,sourceRef:original.sourceRef ?? null,episodeId:original.episodeId ?? null,eventId:original.eventId ?? null,
        reflectionId:original.reflectionId ?? null,semanticKey:original.semanticKey ?? null,historianOnly:true},
      authorityGranted:false,admissionAuthority:false,
    };
  });
  return createCandidateBusEnvelope({
    candidateSetId:`historian:${task?.taskId ?? 'candidate-set'}`,query,intentFingerprint:task?.intentFingerprint ?? null,
    sourceRevisionSet:task?.sourceRevisionSet ?? [],worldRevision:task?.worldRevision ?? 0,sceneRevision:task?.sceneRevision ?? 0,
    candidates,unavailableChannels,maxCandidates:task?.metadata?.maxArtifacts ?? LIMITS.maxArtifacts,
  });
}

export function evaluateHistorianFreshness(task,payload,current={}) {
  const reasons=[];
  const have=new Set(current.sourceRevisionSet ?? task.sourceRevisionSet ?? []);
  for (const source of task.sourceRevisionSet ?? []) if (!have.has(source)) reasons.push('SOURCE_REVISION_CHANGED');
  if (current.worldRevision!=null && Number(current.worldRevision)!==Number(task.worldRevision)) reasons.push('WORLD_REVISION_CHANGED');
  if (current.sceneRevision!=null && Number(current.sceneRevision)!==Number(task.sceneRevision)) reasons.push('SCENE_REVISION_CHANGED');
  if (current.characterStateRevision!=null && Number(current.characterStateRevision)!==Number(task.characterStateRevision)) reasons.push('CHARACTER_STATE_REVISION_CHANGED');
  if (current.intentFingerprint!=null && current.intentFingerprint!==task.intentFingerprint) reasons.push('INTENT_FINGERPRINT_CHANGED');
  if (current.perspectiveConstraint!=null && perspectiveFingerprint(normalizePerspective(current.perspectiveConstraint))!==task.metadata.perspectiveFingerprint) reasons.push('PERSPECTIVE_CHANGED');
  if (current.turnSuperseded===true || (current.supersededTurnIds ?? []).includes(task.turnId)) reasons.push('TURN_SUPERSEDED');
  if (current.memoryRevisionRefs!=null && !sameSet(task.metadata.memoryRevisionRefs,current.memoryRevisionRefs)) reasons.push('MEMORY_REVISION_CHANGED');
  const retired=new Set(current.retiredArtifactIds ?? current.deletedArtifactIds ?? []);
  const revisions=current.memoryArtifactRevisions ?? {};
  for (const candidate of payload?.candidateSet?.candidates ?? payload?.candidates ?? []) {
    const ref=candidate.artifactRef;
    if (!ref) continue;
    if (retired.has(ref.artifactId)) reasons.push(`ARTIFACT_RETIRED:${ref.artifactId}`);
    if (revisions[ref.artifactId]!=null && Number(revisions[ref.artifactId])!==Number(ref.revision)) reasons.push(`ARTIFACT_REVISION_CHANGED:${ref.artifactId}`);
  }
  const unique=[...new Set(reasons)];
  return freeze({kind:'HistorianFreshnessReceipt',freshness:unique.length?CandidateFreshness.STALE:CandidateFreshness.FRESH,reasons:unique,
    foregroundEligible:unique.length===0 && current.sealed!==true,destination:current.sealed?ResultDestination.NEXT_TURN:unique.length?ResultDestination.DROP:ResultDestination.FOREGROUND,
    authorityGranted:false});
}

export class HistorianRetrievalWorker {
  constructor({executionLayer,memoryResolver,telemetry=null}={}) {
    if (!executionLayer||typeof executionLayer.execute!=='function') throw new TypeError('HistorianRetrievalWorker requires SpecialistExecutionLayer');
    if (!memoryResolver||typeof memoryResolver.resolve!=='function') throw new TypeError('HistorianRetrievalWorker requires Memory resolver');
    this.executionLayer=executionLayer;this.memoryResolver=memoryResolver;this.telemetry=telemetry;
  }
  async run({task=null,turn=null,request={},current=null,sealed=false,profileId=null}={}) {
    const cognitiveTask=task ?? createHistorianTask({
      turnId:turn?.turnId,correlationId:turn?.correlationId,causationId:turn?.causationId ?? turn?.eventId ?? null,
      sourceRevisionSet:turn?.sourceRevisionSet ?? [],worldRevision:turn?.worldRevision ?? 0,sceneRevision:turn?.sceneRevision ?? 0,
      characterStateRevision:turn?.characterStateRevision ?? 0,intentFingerprint:request.intentFingerprint ?? turn?.intentFingerprint ?? null,...request,
    });
    const memoryRequest=createHistorianMemoryRequest(cognitiveTask,request);
    emitTelemetry(this.telemetry,TelemetryEvent.HISTORIAN_REQUESTED,{taskId:cognitiveTask.taskId,turnId:cognitiveTask.turnId,
      resultClass:cognitiveTask.resultClass,retrievalIntentCount:memoryRequest.retrievalIntentIds.length,perspective:memoryRequest.perspectiveConstraint.scope});
    let resolution;
    try { resolution=await this.memoryResolver.resolve(memoryRequest); }
    catch (error) {
      emitTelemetry(this.telemetry,TelemetryEvent.HISTORIAN_DEGRADED,{taskId:cognitiveTask.taskId,reason:error?.code ?? 'MEMORY_RESOLVER_FAILED'});
      return degraded(cognitiveTask,error,sealed);
    }
    if (resolution.status===HistorianResolverStatus.PERSPECTIVE_UNAVAILABLE) {
      emitTelemetry(this.telemetry,TelemetryEvent.HISTORIAN_ABSTAINED,{taskId:cognitiveTask.taskId,reason:'PERSPECTIVE_UNAVAILABLE'});
      return freeze({kind:'HistorianWorkerResult',status:'ABSTAINED',task:cognitiveTask,memoryRequest,resolution,
        candidateSet:createCandidateBusEnvelope({candidateSetId:`historian:${cognitiveTask.taskId}:perspective-unavailable`,
          intentFingerprint:cognitiveTask.intentFingerprint,sourceRevisionSet:cognitiveTask.sourceRevisionSet,worldRevision:cognitiveTask.worldRevision,
          sceneRevision:cognitiveTask.sceneRevision,candidates:[],unavailableChannels:resolution.unavailableChannels}),
        perspectiveUnavailable:true,destination:sealed?ResultDestination.NEXT_TURN:ResultDestination.FOREGROUND,authorityGranted:false,memoryMutation:false});
    }
    let workerResult;
    try { workerResult=await this.executionLayer.execute(cognitiveTask,{input:{request:memoryRequest,resolution},profileId}); }
    catch (error) {
      emitTelemetry(this.telemetry,TelemetryEvent.HISTORIAN_DEGRADED,{taskId:cognitiveTask.taskId,reason:error?.code ?? 'HISTORIAN_PROVIDER_FAILED'});
      return degraded(cognitiveTask,error,sealed,{memoryRequest,resolution});
    }
    const context={
      sourceRevisionSet:current?.sourceRevisionSet ?? cognitiveTask.sourceRevisionSet,worldRevision:current?.worldRevision ?? cognitiveTask.worldRevision,
      sceneRevision:current?.sceneRevision ?? cognitiveTask.sceneRevision,characterStateRevision:current?.characterStateRevision ?? cognitiveTask.characterStateRevision,
      intentFingerprint:current?.intentFingerprint ?? cognitiveTask.intentFingerprint,perspectiveConstraint:current?.perspectiveConstraint ?? cognitiveTask.metadata.perspectiveConstraint,
      memoryRevisionRefs:current?.memoryRevisionRefs ?? cognitiveTask.metadata.memoryRevisionRefs,
      memoryArtifactRevisions:current?.memoryArtifactRevisions ?? Object.fromEntries(resolution.artifacts.map((x)=>[x.artifactRef.artifactId,x.artifactRef.revision])),
      retiredArtifactIds:current?.retiredArtifactIds ?? [],deletedArtifactIds:current?.deletedArtifactIds ?? [],
      supersededTurnIds:current?.supersededTurnIds ?? [],turnSuperseded:current?.turnSuperseded ?? false,sealed,
    };
    const freshness=evaluateHistorianFreshness(cognitiveTask,workerResult.payload,context);
    if (freshness.freshness!==CandidateFreshness.FRESH) {
      emitTelemetry(this.telemetry,TelemetryEvent.HISTORIAN_STALE_REJECTED,{taskId:cognitiveTask.taskId,reasons:freshness.reasons});
      return freeze({kind:'HistorianWorkerResult',status:'STALE',task:cognitiveTask,memoryRequest,resolution,workerResult,freshness,
        candidateSet:null,destination:freshness.destination,authorityGranted:false,memoryMutation:false});
    }
    const destination=sealed?ResultDestination.NEXT_TURN:ResultDestination.FOREGROUND;
    emitTelemetry(this.telemetry,TelemetryEvent.HISTORIAN_COMPLETED,{taskId:cognitiveTask.taskId,turnId:cognitiveTask.turnId,
      candidateCount:workerResult.payload.candidateSet?.candidateCount ?? 0,destination,resolverStatus:resolution.status});
    return freeze({kind:'HistorianWorkerResult',status:resolution.status===HistorianResolverStatus.DEGRADED?'DEGRADED':'SUCCESS',
      task:cognitiveTask,memoryRequest,resolution,workerResult,freshness,candidateSet:workerResult.payload.candidateSet,payload:workerResult.payload,
      destination,authorityGranted:false,memoryMutation:false});
  }
}

export function historianUrgency({text='',queryIntent=null,activeThreads=[],hotStateSufficient=false,freshWarm=false,physical=false}={}) {
  const normalized=String(text).trim().toLowerCase();
  const explicit=/\b(last time|what happened|before the|previously|earlier|originally|when did|promise|promised|owed|betray|betrayed|remember|history|where did (?:we|they|he|she)|didn['’]?t .* (?:promise|leave|carry))\b/.test(normalized);
  const historyIntent=['HISTORY','HISTORICAL','EXPLICIT_HISTORY','RELATIONSHIP_HISTORY','CONTINUITY_REQUIRED'].includes(queryIntent);
  const depends=['CURRENT_STATE','LOCATION','INVENTORY'].includes(queryIntent)&&activeThreads.length>0&&(physical||/\b(return|again|still|left|carried|promise|previous)\b/.test(normalized));
  if (hotStateSufficient&&!explicit&&!historyIntent) return freeze({wake:false,resultClass:null,reason:'HOT_STATE_SUFFICIENT'});
  if (freshWarm&&!explicit&&!historyIntent&&!depends) return freeze({wake:false,resultClass:null,reason:'FRESH_WARM_PACKET_AVAILABLE'});
  if (explicit||historyIntent||depends) return freeze({wake:true,resultClass:ResultClass.REQUIRED,reason:'PRIOR_EXPERIENCE_REQUIRED'});
  if (physical && ['CURRENT_STATE','LOCATION','INVENTORY'].includes(queryIntent)) return freeze({wake:true,resultClass:ResultClass.OPPORTUNISTIC,reason:'PHYSICAL_HISTORY_MAY_HELP'});
  if (activeThreads.length>0||normalized.length>24) return freeze({wake:true,resultClass:ResultClass.OPPORTUNISTIC,reason:'HISTORY_MAY_ENRICH'});
  return freeze({wake:false,resultClass:null,reason:'NO_EXPECTED_HISTORY_VALUE'});
}

function normalizeArtifact(input,request,index) {
  if (!input||typeof input!=='object'||Array.isArray(input)) fail(FailureCode.SCHEMA_INVALID,'Historian artifact must be an object');
  const artifactRef=createArtifactReference(input.artifactRef ?? input);
  const channel=input.channel ?? channelFor(artifactRef.artifactType);
  if (!CHANNELS.has(channel)) fail(FailureCode.SCHEMA_INVALID,`unsupported Historian channel: ${channel}`);
  const candidateId=required(input.candidateId ?? input.ref ?? `${artifactRef.artifactId}@${artifactRef.revision}`,'candidateId');
  const retrievalIntentIds=strings(input.retrievalIntentIds ?? request.retrievalIntentIds,LIMITS.maxRetrievalIntents,'retrievalIntentIds');
  for (const id of retrievalIntentIds) if (!request.retrievalIntentIds.includes(id)) fail(FailureCode.UNKNOWN_REFERENCE,`Unknown Historian intent: ${id}`);
  let authorityClass=input.authorityClass ?? input.authority ?? CandidateAuthorityClass.UNKNOWN;
  if (!AUTHORITIES.has(authorityClass)) fail(FailureCode.SCHEMA_INVALID,`unsupported authorityClass: ${authorityClass}`);
  if (channel===HistorianMemoryChannel.REFLECTION) {
    if (![CandidateAuthorityClass.INFERRED,CandidateAuthorityClass.UNKNOWN].includes(authorityClass)) fail(FailureCode.AUTHORITY_VIOLATION,'Reflection cannot become canon through Historian');
    authorityClass=CandidateAuthorityClass.INFERRED;
  }
  const truthStatusHint=input.truthStatusHint ?? input.truthStatus ?? CandidateTruthStatus.UNKNOWN;
  if (!TRUTH.has(truthStatusHint)) fail(FailureCode.SCHEMA_INVALID,`unsupported truthStatusHint: ${truthStatusHint}`);
  return freeze({
    kind:'HistorianArtifactNomination',contractVersion:HISTORIAN_CONTRACT_VERSION,candidateId,artifactRef,
    sourceRef:opt(input.sourceRef),episodeId:opt(input.episodeId),eventId:opt(input.eventId),reflectionId:opt(input.reflectionId),channel,retrievalIntentIds,
    entityRefs:strings(input.entityRefs ?? [],64,'entityRefs'),relationshipRefs:strings(input.relationshipRefs ?? [],64,'relationshipRefs'),
    eventRefs:strings(input.eventRefs ?? [],64,'eventRefs'),claimRefs:strings(input.claimRefs ?? [],64,'claimRefs'),
    temporalHints:strings(input.temporalHints ?? [],32,'temporalHints'),authorityClass,truthStatusHint,
    provenance:provenance(input.provenance ?? (artifactRef.provenanceRef?[{ref:artifactRef.provenanceRef}]:[])),
    evidenceRefs:strings(input.evidenceRefs ?? artifactRef.sourceRevisionSet ?? [],LIMITS.maxEvidenceRefs,'evidenceRefs'),
    sourceRevisionRefs:strings(input.sourceRevisionRefs ?? artifactRef.sourceRevisionSet ?? [],LIMITS.maxEvidenceRefs,'sourceRevisionRefs'),
    dependencyRevisions:strings(input.dependencyRevisions ?? [],64,'dependencyRevisions'),perspective:artifactPerspective(input.perspective ?? null),
    representationText:input.representationText ?? input.summary ?? input.statement ?? input.excerpt ?? null,
    rankSignals:rankSignals(input.rankSignals ?? {}),sceneRelevance:input.sceneRelevance==null?null:unit(input.sceneRelevance,'sceneRelevance'),
    semanticKey:opt(input.semanticKey),inputRank:index+1,authorityGranted:false,memoryMutation:false,
  });
}
function enforcePerspective(artifacts,constraintInput) {
  const constraint=normalizePerspective(constraintInput);
  if (constraint.scope===HistorianPerspectiveScope.WORLD) return;
  for (const artifact of artifacts) {
    const p=artifact.perspective;
    if (!p) fail(FailureCode.AUTHORITY_VIOLATION,`Perspective unavailable for ${artifact.candidateId}`);
    if (p.scope===HistorianPerspectiveScope.WORLD) fail(FailureCode.AUTHORITY_VIOLATION,`World evidence cannot satisfy ${constraint.scope}`);
    if (constraint.characterRef&&p.characterRef!==constraint.characterRef) fail(FailureCode.AUTHORITY_VIOLATION,`Perspective leak: ${artifact.candidateId}`);
  }
}
function normalizeIntents(values,ids) {
  if (!Array.isArray(values)) throw new TypeError('retrievalIntents must be an array');
  if (!values.length) values=(ids ?? []).map((intentId)=>({intentId,mode:HistorianRetrievalMode.CONTINUITY_RECALL,required:true}));
  if (values.length>LIMITS.maxRetrievalIntents) fail(FailureCode.SCHEMA_INVALID,`retrieval intents exceed ${LIMITS.maxRetrievalIntents}`);
  const seen=new Set();
  return values.map((value)=>{
    const row=typeof value==='string'?{intentId:value}:value;
    const intentId=required(row.intentId ?? row.id,'intentId');if(seen.has(intentId))fail(FailureCode.SCHEMA_INVALID,`duplicate intent ${intentId}`);seen.add(intentId);
    const mode=row.mode ?? HistorianRetrievalMode.CONTINUITY_RECALL;if(!MODES.has(mode))fail(FailureCode.SCHEMA_INVALID,`unsupported Historian mode: ${mode}`);
    return freeze({intentId,mode,query:row.query==null?null:text(row.query,600,'query'),required:row.required!==false,
      entityRefs:strings(row.entityRefs ?? [],32,'entityRefs'),threadRefs:strings(row.threadRefs ?? [],32,'threadRefs'),
      eventRefs:strings(row.eventRefs ?? [],32,'eventRefs'),relationshipRefs:strings(row.relationshipRefs ?? [],32,'relationshipRefs'),
      exactIdentifiers:strings(row.exactIdentifiers ?? [],32,'exactIdentifiers')});
  });
}
function normalizePerspective(value={}) {
  if (typeof value==='string') value={scope:value};
  const scope=value.scope ?? HistorianPerspectiveScope.WORLD;
  if (!PERSPECTIVES.has(scope)||scope===HistorianPerspectiveScope.PERSPECTIVE_UNAVAILABLE) fail(FailureCode.SCHEMA_INVALID,`unsupported perspective: ${scope}`);
  const characterRef=opt(value.characterRef ?? value.characterId);
  if (scope!==HistorianPerspectiveScope.WORLD&&!characterRef) fail(FailureCode.SCHEMA_INVALID,'character perspective requires characterRef');
  return freeze({scope,characterRef,allowUncertain:value.allowUncertain!==false,allowFalseBelief:value.allowFalseBelief!==false});
}
function artifactPerspective(value) {
  if (value==null) return null;if(typeof value==='string')value={scope:value};
  const scope=value.scope ?? HistorianPerspectiveScope.WORLD;if(!PERSPECTIVES.has(scope))fail(FailureCode.SCHEMA_INVALID,`unsupported artifact perspective: ${scope}`);
  return freeze({scope,characterRef:opt(value.characterRef ?? value.characterId),observedBy:strings(value.observedBy ?? [],32,'observedBy'),
    heardFrom:strings(value.heardFrom ?? [],32,'heardFrom'),beliefStatus:opt(value.beliefStatus)});
}
function normalizeTemporal(value) {
  if (value==null) return null;if(typeof value==='string')return freeze({mode:value});
  return freeze({mode:opt(value.mode),beforeRef:opt(value.beforeRef),afterRef:opt(value.afterRef),atRef:opt(value.atRef),
    start:value.start ?? null,end:value.end ?? null,currentOnly:Boolean(value.currentOnly),historicalOnly:Boolean(value.historicalOnly)});
}
function normalizeLimits(value={}) {
  return freeze({maxArtifacts:int(value.maxArtifacts ?? LIMITS.maxArtifacts,1,128,'maxArtifacts'),maxEpisodes:int(value.maxEpisodes ?? LIMITS.maxEpisodes,0,96,'maxEpisodes'),
    maxReflections:int(value.maxReflections ?? LIMITS.maxReflections,0,48,'maxReflections'),maxEvidenceBytes:int(value.maxEvidenceBytes ?? LIMITS.maxEvidenceBytes,1024,524288,'maxEvidenceBytes'),
    maxProviderCandidates:int(value.maxProviderCandidates ?? LIMITS.maxProviderCandidates,1,128,'maxProviderCandidates'),
    maxProviderExcerptChars:int(value.maxProviderExcerptChars ?? LIMITS.maxProviderExcerptChars,128,8000,'maxProviderExcerptChars')});
}
function legacyProviderInput(task,input) {
  const candidates=input.candidates.map((c)=>({candidateId:required(c.candidateId ?? c.ref,'ref'),ref:required(c.candidateId ?? c.ref,'ref'),
    summary:String(c.summary ?? c.statement ?? ''),semanticKey:c.semanticKey ?? null,temporalStatus:c.temporalStatus ?? null,authority:c.authority ?? 'UNRESOLVED',
    retrievalIntentIds:c.retrievalIntentIds ?? task.metadata?.retrievalIntentIds ?? [],entityRefs:c.entityRefs ?? [],relationshipRefs:c.relationshipRefs ?? [],
    eventRefs:c.eventRefs ?? [],claimRefs:c.claimRefs ?? [],temporalHints:c.temporalHints ?? (c.temporalStatus?[c.temporalStatus]:[]),
    authorityClass:c.authorityClass ?? (AUTHORITIES.has(c.authority)?c.authority:CandidateAuthorityClass.UNKNOWN),
    truthStatusHint:c.truthStatusHint ?? (TRUTH.has(c.temporalStatus)?c.temporalStatus:CandidateTruthStatus.UNKNOWN),
    perspective:c.perspective ?? {scope:HistorianPerspectiveScope.WORLD},evidenceRefs:c.evidenceRefs ?? [c.ref],sourceRevisionRefs:c.sourceRevisionRefs ?? task.sourceRevisionSet,
    channel:c.channel ?? HistorianMemoryChannel.HISTORICAL_STATE,representationText:String(c.summary ?? c.statement ?? '')}));
  const bounded=buildBoundedProviderPayload({taskSlice:{taskId:task.taskId,retrievalIntentIds:task.metadata?.retrievalIntentIds ?? [],activeEntityIds:input.activeEntities ?? [],
    sceneRefs:input.sceneRefs ?? [],sourceRevisionSet:task.sourceRevisionSet,worldRevision:task.worldRevision,sceneRevision:task.sceneRevision},
    selectedContext:candidates.map((c)=>({ref:c.candidateId,excerpt:c.summary,structuredFacts:[{temporalStatus:c.temporalStatus,authority:c.authority,semanticKey:c.semanticKey}]}))});
  return freeze({...bounded,intent:input.intent ?? null,activeEntities:[...(input.activeEntities ?? [])],sceneRefs:[...(input.sceneRefs ?? [])],candidates,
    maxRefs:Number(input.maxRefs ?? Math.min(8,candidates.length)),sourceRevisionSet:[...task.sourceRevisionSet],worldRevision:task.worldRevision});
}
function providerSlice(x,max=LIMITS.maxProviderExcerptChars) {
  return {candidateId:x.candidateId,artifactRef:structuredClone(x.artifactRef),channel:x.channel,retrievalIntentIds:[...x.retrievalIntentIds],
    entityRefs:[...x.entityRefs],relationshipRefs:[...x.relationshipRefs],eventRefs:[...x.eventRefs],claimRefs:[...x.claimRefs],temporalHints:[...x.temporalHints],
    authorityClass:x.authorityClass,truthStatusHint:x.truthStatusHint,perspective:structuredClone(x.perspective),evidenceRefs:[...x.evidenceRefs],
    sourceRevisionRefs:[...x.sourceRevisionRefs],dependencyRevisions:[...x.dependencyRevisions],provenance:structuredClone(x.provenance),
    rankSignals:structuredClone(x.rankSignals),representationText:x.representationText==null?null:String(x.representationText).slice(0,max)};
}
function rankSignals(value={}) {
  const allowed=new Set(['intentMatch','entityOverlap','threadOverlap','relationshipRelevance','eventOverlap','locationOverlap','temporalFit','continuity','significance','recency','perspectiveCompatibility','provenanceQuality']);
  const out={};for(const[key,v]of Object.entries(value)){if(!allowed.has(key))fail(FailureCode.SCHEMA_INVALID,`unsupported rank signal: ${key}`);out[key]=unit(v,key);}return freeze(out);
}
function provenance(values){if(!Array.isArray(values))fail(FailureCode.SCHEMA_INVALID,'provenance must be array');return values.slice(0,64).map((x)=>typeof x==='string'?{ref:required(x,'provenance ref')}:structuredClone(x));}
function channelFor(type){const x=String(type).toUpperCase();if(x.includes('REFLECTION'))return HistorianMemoryChannel.REFLECTION;if(x.includes('RELATIONSHIP'))return HistorianMemoryChannel.RELATIONSHIP_EVENT;
  if(x.includes('SCENE'))return HistorianMemoryChannel.SCENE_EPISODE;if(x.includes('EXPERIENCE'))return HistorianMemoryChannel.EXPERIENCE;if(x.includes('CAUSAL'))return HistorianMemoryChannel.CAUSAL_EVENT;
  if(x.includes('HYPOTHESIS'))return HistorianMemoryChannel.UNRESOLVED_HYPOTHESIS;if(x.includes('STATE'))return HistorianMemoryChannel.HISTORICAL_STATE;return HistorianMemoryChannel.EPISODIC_MEMORY;}
function perspectiveFingerprint(v){const p=normalizePerspective(v);return [p.scope,p.characterRef ?? '',p.allowUncertain?'U1':'U0',p.allowFalseBelief?'F1':'F0'].join(':');}
function selectedRefs(values,allowed,max){if(!Array.isArray(values))fail(FailureCode.SCHEMA_INVALID,'refs must be array');const raw=values.map((x)=>required(x,'ref'));const out=[...new Set(raw)];if(out.length!==raw.length)fail(FailureCode.SCHEMA_INVALID,'duplicate Historian refs');if(out.length>Number(max))fail(FailureCode.SCHEMA_INVALID,'too many refs');for(const x of out)if(!allowed.has(x))fail(FailureCode.UNKNOWN_REFERENCE,`Unknown Historian ref: ${x}`);return out;}
function uncertaintyEnum(v){if(!['LOW','MEDIUM','HIGH','UNRESOLVED'].includes(v))fail(FailureCode.SCHEMA_INVALID,`invalid uncertainty: ${v}`);return v;}
function parseObject(t){if(typeof t!=='string')fail(FailureCode.MALFORMED_OUTPUT,'Historian output must be JSON text');try{const v=JSON.parse(t.trim());if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('not object');return v;}catch(e){fail(FailureCode.MALFORMED_OUTPUT,`Historian JSON parse failed: ${e.message}`);}}
function evidenceIdentity(x){return x.artifactRef?.artifactId?`${x.artifactRef.artifactId}@${x.artifactRef.revision}`:x.candidateId ?? x.ref;}
function bestSignal(s={}){const v=Object.values(s).map(Number).filter(Number.isFinite);return v.length?Math.max(...v):0;}
function sameSet(a=[],b=[]){const aa=[...new Set(a)].sort(),bb=[...new Set(b)].sort();return aa.length===bb.length&&aa.every((x,i)=>x===bb[i]);}
function degraded(task,error,sealed,extras={}){return freeze({kind:'HistorianWorkerResult',status:'DEGRADED',task,...extras,failure:{code:error?.code ?? FailureCode.PROVIDER_FAILURE,message:error?.message ?? String(error)},
  candidateSet:null,destination:sealed?ResultDestination.NEXT_TURN:ResultDestination.FOREGROUND,authorityGranted:false,memoryMutation:false});}
function strings(v,max,name){if(!Array.isArray(v))fail(FailureCode.SCHEMA_INVALID,`${name} must be array`);const out=[...new Set(v.map((x)=>required(x,name)))];if(out.length>max)fail(FailureCode.SCHEMA_INVALID,`${name} exceeds ${max}`);return out;}
function int(v,min,max,name){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)fail(FailureCode.SCHEMA_INVALID,`${name} must be ${min}..${max}`);return n;}
function unit(v,name){const n=Number(v);if(!Number.isFinite(n)||n<0||n>1)fail(FailureCode.SCHEMA_INVALID,`${name} must be 0..1`);return n;}
function text(v,max,name){if(typeof v!=='string')fail(FailureCode.SCHEMA_INVALID,`${name} must be string`);return v.slice(0,max);}
function required(v,name){if(typeof v!=='string'||!v.trim())fail(FailureCode.SCHEMA_INVALID,`${name} must be non-empty string`);return v.trim();}
function opt(v){return v==null?null:required(v,'optional string');}
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function freeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const x of Object.values(v))freeze(x);return v;}
