import {
  AuthorityClass,
  HISTORIAN_COMPAT_VERSION,
  KnowledgeStatus,
  MEMORY_LIMITS,
  MemoryArtifactKind,
  PerspectiveScope,
  createArtifactReference,
  createCandidateNomination,
  deepClone,
  stableHash,
  stableStringify,
  uniqStrings,
} from './memory-contracts.js';
import {historianArtifactReference} from './memory-experience-store.js';

const TOKEN_RE=/[a-z0-9][a-z0-9'-]{1,}/g;
const STOP=new Set(['the','a','an','and','or','of','to','in','on','at','for','with','is','was','were','be','been','about','tell','me','what','who','where','when','how','did','does','do']);

const HistorianMemoryChannel=Object.freeze({
  SCENE_EPISODE:'SCENE_EPISODE',
  EXPERIENCE:'EXPERIENCE',
  EPISODIC_MEMORY:'EPISODIC_MEMORY',
  RELATIONSHIP_EVENT:'RELATIONSHIP_EVENT',
  REFLECTION:'REFLECTION',
  CAUSAL_EVENT:'CAUSAL_EVENT',
  UNRESOLVED_HYPOTHESIS:'UNRESOLVED_HYPOTHESIS',
  HISTORICAL_STATE:'HISTORICAL_STATE',
});

function tokenize(value) {
  return [...new Set((String(value??'').toLowerCase().match(TOKEN_RE)??[]).filter((t)=>!STOP.has(t)))];
}

function valueText(value) {
  if (value==null) return 'null';
  if (typeof value==='string'||typeof value==='number'||typeof value==='boolean') return String(value);
  return stableStringify(value);
}

function intersectKnownBy(evidenceRows) {
  if (!evidenceRows.length) return [];
  let current=null;
  for (const row of evidenceRows) {
    const set=new Set(row?.knownBy??[]);
    if (current==null) current=set;
    else current=new Set([...current].filter((id)=>set.has(id)));
  }
  return [...(current??new Set())].sort();
}

function perspectiveForRecord(record,requestPerspective) {
  const scope=requestPerspective?.scope??PerspectiveScope.WORLD;
  const characterRef=requestPerspective?.characterRef??requestPerspective?.characterId??null;
  if (scope===PerspectiveScope.WORLD) return {scope:PerspectiveScope.WORLD,characterRef:null,observedBy:[],heardFrom:[],beliefStatus:null};
  if (!characterRef || !record.knownBy.includes(characterRef)) return null;
  return {scope,characterRef,observedBy:[characterRef],heardFrom:[],beliefStatus:null};
}

function temporalHintsForClaim(claim) {
  const hints=[];
  if (claim.status) hints.push(String(claim.status));
  if (claim.temporal?.kind) hints.push(String(claim.temporal.kind));
  return [...new Set(hints)].slice(0,32);
}

function scoreRecord(record,{queryTokens,activeEntityIds,mode,currentSequence}) {
  const tokenSet=new Set(record.tokens);
  const matched=queryTokens.filter((token)=>tokenSet.has(token));
  const lexical=queryTokens.length?matched.length/queryTokens.length:0;
  const entityHits=activeEntityIds.filter((id)=>record.entityRefs.includes(id)||record.participants.includes(id)).length;
  const entityOverlap=activeEntityIds.length?entityHits/activeEntityIds.length:0;
  const historyMode=['EXPLICIT_HISTORY','RELATIONSHIP_HISTORY','EVENT_CAUSAL_RECALL','CONTINUITY_RECALL'].includes(mode);
  const typeFit=mode==='REFLECTION_RECALL'
    ? (record.channel===HistorianMemoryChannel.REFLECTION?1:0)
    : (record.channel===HistorianMemoryChannel.REFLECTION?0.25:(historyMode?1:0.6));
  const significance=Number(record.significance??0.5);
  const age=Math.max(0,currentSequence-Number(record.sequence??0));
  const recency=1/(1+age/25);
  const relevance=Math.max(lexical,entityOverlap);
  const recencyContribution=relevance>0?recency*0.08:0;
  const raw=lexical*0.58+entityOverlap*0.18+typeFit*0.12+significance*0.04+recencyContribution;
  return {
    matched,
    lexical,
    entityOverlap,
    typeFit,
    significance,
    recency,
    normalized:Math.max(0,Math.min(1,raw)),
    eligible:relevance>0,
  };
}

export class MemoryHistorianIndex {
  constructor({graph,experienceStore,snapshot=null}={}) {
    if (!graph||!experienceStore) throw new TypeError('MemoryHistorianIndex requires graph and experienceStore');
    this.graph=graph;
    this.experienceStore=experienceStore;
    this.records=new Map();
    this.inverted=new Map();
    this.revision='memory-historian:empty';
    this.sequence=0;
    this.diagnostics=[];
    if (snapshot) this.restore(snapshot);
  }

  build() {
    this.records.clear();
    this.inverted.clear();
    this.diagnostics=[];
    this.experienceStore.refreshFreshness();

    for (const episode of this.experienceStore.currentEpisodes({freshOnly:true})) {
      const evidenceRows=episode.evidenceRefs.map((id)=>this.graph.evidenceRecord(id)).filter(Boolean);
      const knownBy=episode.knownBy.length?episode.knownBy:intersectKnownBy(evidenceRows);
      const text=[episode.summary,...episode.participants,evidenceRows.map((row)=>row.exactContent).join(' ')].join(' ');
      this.addRecord({
        kind:'MemoryHistorianRecord',
        id:'historian-episode:' + stableHash(episode.id),
        artifactId:episode.id,
        artifactRevision:episode.revision,
        artifactType:episode.artifactType,
        channel:HistorianMemoryChannel.SCENE_EPISODE,
        representationText:episode.summary,
        tokens:tokenize(text).slice(0,MEMORY_LIMITS.maxIndexedTermsPerArtifact),
        sourceRevisionRefs:[...episode.sourceRevisionRefs],
        evidenceRefs:[...episode.evidenceRefs],
        claimRefs:[],
        relationshipRefs:[],
        eventRefs:episode.sceneId?[episode.sceneId]:[],
        entityRefs:[...episode.participants],
        participants:[...episode.participants],
        knownBy,
        timeBounds:deepClone(episode.timeBounds),
        authorityClass:AuthorityClass.OBSERVED,
        truthStatusHint:KnowledgeStatus.HISTORICAL,
        significance:episode.significance,
        sequence:episode.createdSequence,
        sceneRevision:episode.sceneRevision,
        worldRevision:null,
        provenance:[{ref:'memory-episode-provenance:'+episode.id}],
        dependencyRevisions:[...episode.sourceRevisionRefs,episode.id],
        freshness:'FRESH',
        exactDrillbackRefs:[...episode.evidenceRefs],
      });
    }

    for (const reflection of this.experienceStore.currentReflections({freshOnly:true})) {
      const evidenceRows=reflection.supportEvidenceRefs.map((id)=>this.graph.evidenceRecord(id)).filter(Boolean);
      const knownBy=intersectKnownBy(evidenceRows);
      const text=[reflection.statement,...reflection.subjectRefs,evidenceRows.map((row)=>row.exactContent).join(' ')].join(' ');
      this.addRecord({
        kind:'MemoryHistorianRecord',
        id:'historian-reflection:' + stableHash(reflection.id),
        artifactId:reflection.id,
        artifactRevision:reflection.revision,
        artifactType:reflection.artifactType,
        channel:HistorianMemoryChannel.REFLECTION,
        representationText:reflection.statement,
        tokens:tokenize(text).slice(0,MEMORY_LIMITS.maxIndexedTermsPerArtifact),
        sourceRevisionRefs:[...reflection.sourceRevisionRefs],
        evidenceRefs:[...reflection.supportEvidenceRefs],
        claimRefs:[],
        relationshipRefs:[],
        eventRefs:[],
        entityRefs:[...reflection.subjectRefs],
        participants:[...reflection.subjectRefs],
        knownBy,
        timeBounds:{start:null,end:null},
        authorityClass:AuthorityClass.INFERRED,
        truthStatusHint:KnowledgeStatus.UNRESOLVED,
        significance:Math.max(0,Math.min(1,reflection.confidence)),
        sequence:reflection.createdSequence,
        sceneRevision:null,
        worldRevision:null,
        provenance:[{ref:'memory-reflection-provenance:'+reflection.id}],
        dependencyRevisions:[...reflection.sourceRevisionRefs,reflection.id],
        freshness:'FRESH',
        exactDrillbackRefs:[...reflection.supportEvidenceRefs],
      });
    }

    for (const claim of this.graph.historicalClaims({includeUnresolved:true,includeStale:false})) {
      if (claim.status===KnowledgeStatus.CURRENT) continue;
      const evidenceRows=claim.evidenceIds.map((id)=>this.graph.evidenceRecord(id)).filter(Boolean);
      const knownBy=intersectKnownBy(evidenceRows);
      const unresolved=claim.status===KnowledgeStatus.UNRESOLVED;
      const text=[claim.subjectId,claim.predicate,valueText(claim.value),claim.status,claim.temporal?.kind??''].join(' ');
      this.addRecord({
        kind:'MemoryHistorianRecord',
        id:'historian-claim:' + stableHash(claim.id+'|'+claim.status),
        artifactId:claim.id,
        artifactRevision:1,
        artifactType:unresolved?MemoryArtifactKind.UNRESOLVED_HYPOTHESIS:MemoryArtifactKind.HISTORICAL_STATE,
        channel:unresolved?HistorianMemoryChannel.UNRESOLVED_HYPOTHESIS:HistorianMemoryChannel.HISTORICAL_STATE,
        representationText:(unresolved?'[UNRESOLVED] ':'[HISTORICAL] ')+claim.subjectId+' '+claim.predicate+' '+valueText(claim.value),
        tokens:tokenize(text).slice(0,MEMORY_LIMITS.maxIndexedTermsPerArtifact),
        sourceRevisionRefs:[...claim.sourceRevisionIds],
        evidenceRefs:[...claim.evidenceIds],
        claimRefs:[claim.id],
        relationshipRefs:[],
        eventRefs:[],
        entityRefs:[claim.subjectId,typeof claim.value==='string'?claim.value:null].filter(Boolean),
        participants:[claim.subjectId],
        knownBy,
        timeBounds:{start:claim.temporal?.validFrom??null,end:claim.temporal?.validUntil??null},
        authorityClass:unresolved?AuthorityClass.UNRESOLVED:claim.authorityClass,
        truthStatusHint:unresolved?KnowledgeStatus.UNRESOLVED:KnowledgeStatus.HISTORICAL,
        significance:0.7,
        sequence:claim.settlementSequence,
        sceneRevision:null,
        worldRevision:claim.settledWorldRevision,
        provenance:[{ref:'memory-claim-provenance:'+claim.id}],
        dependencyRevisions:[...claim.sourceRevisionIds,claim.settlementDecisionId].filter(Boolean),
        freshness:'FRESH',
        exactDrillbackRefs:[...claim.evidenceIds],
      });
    }

    this.revision='memory-historian:' + stableHash([...this.records.values()].map((r)=>r.id+'|'+r.artifactRevision+'|'+r.dependencyRevisions.join(',')).sort().join('|'));
    return this.status();
  }

  addRecord(record) {
    this.records.set(record.id,deepClone(record));
    for (const token of record.tokens) {
      const ids=this.inverted.get(token)??new Set();
      ids.add(record.id);
      this.inverted.set(token,ids);
    }
    this.sequence=Math.max(this.sequence,Number(record.sequence??0));
  }

  query({
    query,
    mode='EXPLICIT_HISTORY',
    retrievalIntentId=null,
    activeEntityIds=[],
    perspectiveConstraint={scope:PerspectiveScope.WORLD},
    maxCandidates=MEMORY_LIMITS.maxHistorianCandidates,
    allowedEvidenceIds=null,
  }={}) {
    const text=String(query??'').trim();
    if (!text) return this.degradedResult({query:text,mode,reason:'EMPTY_QUERY',status:'OK'});
    if (text.length>MEMORY_LIMITS.maxHistorianQueryCharacters) throw new Error('MEMORY_HISTORIAN_QUERY_LIMIT_EXCEEDED');
    const queryTokens=tokenize(text);
    const allowedEvidence=allowedEvidenceIds==null?null:new Set(allowedEvidenceIds);
    const recordAllowed=(record)=>!allowedEvidence||(
      (record?.evidenceRefs??[]).length>0
      && (record.evidenceRefs??[]).every((id)=>allowedEvidence.has(id))
    );
    const candidateIds=new Set();
    for (const token of queryTokens) {
      for (const id of this.inverted.get(token)??[]) {
        const record=this.records.get(id);
        if(!recordAllowed(record))continue;
        candidateIds.add(id);
        if (candidateIds.size>=MEMORY_LIMITS.maxHistorianExaminedArtifacts) break;
      }
      if (candidateIds.size>=MEMORY_LIMITS.maxHistorianExaminedArtifacts) break;
    }
    for (const entityId of activeEntityIds) {
      for (const record of this.records.values()) {
        if (!recordAllowed(record)) continue;
        if (record.entityRefs.includes(entityId)||record.participants.includes(entityId)) candidateIds.add(record.id);
        if (candidateIds.size>=MEMORY_LIMITS.maxHistorianExaminedArtifacts) break;
      }
      if (candidateIds.size>=MEMORY_LIMITS.maxHistorianExaminedArtifacts) break;
    }

    const intentId=retrievalIntentId??('memory-intent:'+stableHash(mode+'|'+text.toLowerCase()));
    const scored=[];
    for (const id of candidateIds) {
      const record=this.records.get(id);
      if (!record||record.freshness!=='FRESH'||!recordAllowed(record)) continue;
      const perspective=perspectiveForRecord(record,perspectiveConstraint);
      if (!perspective) continue;
      const score=scoreRecord(record,{queryTokens,activeEntityIds,mode,currentSequence:this.sequence});
      if (!score.eligible) continue;
      scored.push({record,score,perspective});
    }
    scored.sort((a,b)=>b.score.normalized-a.score.normalized||b.score.lexical-a.score.lexical||b.score.significance-a.score.significance||a.record.id.localeCompare(b.record.id));
    const cap=Math.max(1,Math.min(MEMORY_LIMITS.maxHistorianCandidates,Number(maxCandidates)||MEMORY_LIMITS.maxHistorianCandidates));
    const picked=scored.slice(0,cap);
    const nominations=picked.map(({record,score,perspective})=>createCandidateNomination({
      nominationId:'memory-nomination:' + stableHash(intentId+'|'+record.id),
      candidateId:'memory-candidate:' + stableHash(record.id),
      evidenceIdentity:record.claimRefs.length
        ? 'claim:'+stableHash(record.claimRefs.join('|'))
        : 'artifact:'+stableHash(record.artifactId+'|'+record.artifactRevision),
      artifactRef:createArtifactReference({
        artifactId:record.artifactId,
        artifactType:record.artifactType,
        owner:'MEMORY',
        revision:record.artifactRevision,
        sourceRevisionSet:record.sourceRevisionRefs,
        worldRevision:record.worldRevision,
        sceneRevision:record.sceneRevision,
        contentHash:stableHash(record.representationText),
        provenanceRef:record.provenance[0]?.ref??null,
      }),
      artifactRevision:record.artifactRevision,
      sourceRevisionRefs:record.sourceRevisionRefs,
      claimRefs:record.claimRefs,
      eventRefs:record.eventRefs,
      entityRefs:record.entityRefs,
      relationshipRefs:record.relationshipRefs,
      retrievalIntentIds:[intentId],
      rankSignals:{
        intentMatch:score.lexical,
        entityOverlap:score.entityOverlap,
        temporalFit:score.typeFit,
        significance:score.significance,
        recency:score.recency,
        perspectiveCompatibility:1,
        deterministicLocal:true,
      },
      normalizedRank:score.normalized,
      temporalHints:[record.truthStatusHint,...(record.timeBounds.start!=null?['START:'+record.timeBounds.start]:[]),...(record.timeBounds.end!=null?['END:'+record.timeBounds.end]:[])],
      authorityClass:record.channel===HistorianMemoryChannel.REFLECTION?AuthorityClass.INFERRED:record.authorityClass,
      truthStatusHint:record.channel===HistorianMemoryChannel.REFLECTION?KnowledgeStatus.UNRESOLVED:record.truthStatusHint,
      provenance:record.provenance,
      evidenceRefs:record.evidenceRefs,
      dependencyRevisions:record.dependencyRevisions,
      representationRef:record.id,
      representationRevision:record.artifactRevision,
      representationText:record.representationText,
      metadata:{
        memoryKind:record.artifactType,
        historianChannel:record.channel,
        participants:[...record.participants],
        timeBounds:deepClone(record.timeBounds),
        perspective,
        retrievalRecordRef:record.id,
        exactSourceDrillback:true,
        retrievalRankAuthority:false,
        truthAuthorityGranted:false,
        memoryMutation:false,
        contextInjectionAuthority:false,
        candidateBusAdmissionAuthority:false,
        settlementAuthority:false,
        contextSealAuthority:false,
      },
      worldRevision:record.worldRevision,
      sceneRevision:record.sceneRevision,
    }));
    return {
      kind:'MemoryHistorianQueryResult',
      contractVersion:'1.0.0',
      query:text,
      mode,
      retrievalIntentId:intentId,
      historianRevision:this.revision,
      nominations,
      diagnostics:{
        examined:Math.min(candidateIds.size,MEMORY_LIMITS.maxHistorianExaminedArtifacts),
        matched:scored.length,
        returned:nominations.length,
        boundedOut:Math.max(0,scored.length-nominations.length),
        perspectiveScope:perspectiveConstraint?.scope??PerspectiveScope.WORLD,
        deterministic:true,
      },
      status:'OK',
      authorityGranted:false,
      admissionAuthority:false,
      settlementAuthority:false,
      contextSealAuthority:false,
    };
  }

  drillDown(nominationOrRecordRef) {
    const ref=typeof nominationOrRecordRef==='string'?nominationOrRecordRef:nominationOrRecordRef?.metadata?.retrievalRecordRef;
    const record=this.records.get(ref);
    if (!record) return [];
    return record.exactDrillbackRefs.map((id)=>this.graph.exactEvidence(id)).filter(Boolean);
  }

  resolveHistorianMemoryRequest(request) {
    if (!request||request.kind!=='HistorianMemoryRequest') throw new TypeError('HistorianMemoryRequest required');
    if (request.contractVersion!==HISTORIAN_COMPAT_VERSION) throw new Error('MEMORY_HISTORIAN_CONTRACT_MISMATCH:'+String(request.contractVersion));
    const currentRevisionRefs=this.memoryRevisionRefs();
    const requested=request.memoryRevisionRefs??[];
    if (requested.length && stableStringify([...requested].sort())!==stableStringify([...currentRevisionRefs].sort())) {
      return {
        kind:'HistorianMemoryResolution',
        contractVersion:HISTORIAN_COMPAT_VERSION,
        status:'DEGRADED',
        artifacts:[],
        unavailableChannels:['MEMORY_REVISION_FENCE_CHANGED'],
        memoryRevisionRefs:[...requested],
        perspectiveStatus:request.perspectiveConstraint?.scope??PerspectiveScope.WORLD,
        evidenceBytes:0,
        authorityGranted:false,
        memoryMutation:false,
      };
    }
    const intents=request.retrievalIntents??[];
    const all=[];
    for (const intent of intents) {
      const result=this.query({
        query:intent.query??intent.intentId,
        mode:intent.mode??'CONTINUITY_RECALL',
        retrievalIntentId:intent.intentId,
        activeEntityIds:intent.entityRefs?.length?intent.entityRefs:request.activeEntityIds??[],
        perspectiveConstraint:request.perspectiveConstraint??{scope:PerspectiveScope.WORLD},
        maxCandidates:Math.min(Number(request.limits?.maxArtifacts??MEMORY_LIMITS.maxHistorianCandidates),MEMORY_LIMITS.maxHistorianCandidates),
      });
      all.push(...result.nominations);
    }
    const unique=new Map();
    for (const nomination of all) {
      const ref=nomination.metadata.retrievalRecordRef;
      if (!unique.has(ref)||nomination.normalizedRank>unique.get(ref).normalizedRank) unique.set(ref,nomination);
    }
    const limit=Math.min(Number(request.limits?.maxArtifacts??48),48);
    const artifacts=[...unique.values()].sort((a,b)=>b.normalizedRank-a.normalizedRank||a.candidateId.localeCompare(b.candidateId)).slice(0,limit).map((nomination)=>{
      const record=this.records.get(nomination.metadata.retrievalRecordRef);
      const p=nomination.metadata.perspective;
      return {
        candidateId:nomination.candidateId,
        artifactRef:deepClone(nomination.artifactRef),
        sourceRef:record?.sourceRevisionRefs[0]??null,
        episodeId:record?.channel===HistorianMemoryChannel.SCENE_EPISODE?record.artifactId:null,
        eventId:record?.eventRefs[0]??null,
        reflectionId:record?.channel===HistorianMemoryChannel.REFLECTION?record.artifactId:null,
        channel:record?.channel??HistorianMemoryChannel.EPISODIC_MEMORY,
        retrievalIntentIds:[...nomination.retrievalIntentIds],
        entityRefs:[...nomination.entityRefs],
        relationshipRefs:[...nomination.relationshipRefs],
        eventRefs:[...nomination.eventRefs],
        claimRefs:[...nomination.claimRefs],
        temporalHints:nomination.temporalHints.map(String),
        authorityClass:record?.channel===HistorianMemoryChannel.REFLECTION?AuthorityClass.INFERRED:nomination.authorityClass,
        truthStatusHint:nomination.truthStatusHint,
        provenance:deepClone(nomination.provenance),
        evidenceRefs:[...nomination.evidenceRefs],
        sourceRevisionRefs:[...nomination.sourceRevisionRefs],
        dependencyRevisions:[...nomination.dependencyRevisions],
        perspective:deepClone(p),
        representationText:nomination.representationText,
        rankSignals:{
          intentMatch:Number(nomination.rankSignals.intentMatch??0),
          entityOverlap:Number(nomination.rankSignals.entityOverlap??0),
          temporalFit:Number(nomination.rankSignals.temporalFit??0),
          significance:Number(nomination.rankSignals.significance??0),
          recency:Number(nomination.rankSignals.recency??0),
          perspectiveCompatibility:1,
        },
        sceneRelevance:null,
        semanticKey:record?.artifactId??nomination.candidateId,
        authorityGranted:false,
        memoryMutation:false,
      };
    });
    const bytes=JSON.stringify(artifacts).length;
    const maxBytes=Number(request.limits?.maxEvidenceBytes??MEMORY_LIMITS.maxHistorianEvidenceBytes);
    if (bytes>maxBytes) {
      return {
        kind:'HistorianMemoryResolution',
        contractVersion:HISTORIAN_COMPAT_VERSION,
        status:'DEGRADED',
        artifacts:[],
        unavailableChannels:['EVIDENCE_BUDGET_EXCEEDED'],
        memoryRevisionRefs:requested.length?[...requested]:currentRevisionRefs,
        perspectiveStatus:request.perspectiveConstraint?.scope??PerspectiveScope.WORLD,
        evidenceBytes:0,
        authorityGranted:false,
        memoryMutation:false,
      };
    }
    return {
      kind:'HistorianMemoryResolution',
      contractVersion:HISTORIAN_COMPAT_VERSION,
      status:'OK',
      artifacts,
      unavailableChannels:[],
      memoryRevisionRefs:requested.length?[...requested]:currentRevisionRefs,
      perspectiveStatus:request.perspectiveConstraint?.scope??PerspectiveScope.WORLD,
      evidenceBytes:bytes,
      authorityGranted:false,
      memoryMutation:false,
    };
  }

  memoryRevisionRefs() {
    return [this.graph.revisionRef(),...this.experienceStore.memoryRevisionRefs(),this.revision].sort();
  }

  degradedResult({query='',mode='EXPLICIT_HISTORY',reason='DEGRADED',status='DEGRADED'}={}) {
    return {
      kind:'MemoryHistorianQueryResult',
      contractVersion:'1.0.0',
      query,
      mode,
      retrievalIntentId:null,
      historianRevision:this.revision,
      nominations:[],
      diagnostics:{examined:0,matched:0,returned:0,boundedOut:0,reason},
      status,
      authorityGranted:false,
      admissionAuthority:false,
      settlementAuthority:false,
      contextSealAuthority:false,
    };
  }

  status() {
    const rows=[...this.records.values()];
    return {
      kind:'MemoryHistorianStatus',
      revision:this.revision,
      records:rows.length,
      episodeRecords:rows.filter((r)=>r.channel===HistorianMemoryChannel.SCENE_EPISODE).length,
      reflectionRecords:rows.filter((r)=>r.channel===HistorianMemoryChannel.REFLECTION).length,
      historicalStateRecords:rows.filter((r)=>r.channel===HistorianMemoryChannel.HISTORICAL_STATE).length,
      unresolvedRecords:rows.filter((r)=>r.channel===HistorianMemoryChannel.UNRESOLVED_HYPOTHESIS).length,
      indexedTerms:this.inverted.size,
      diagnostics:deepClone(this.diagnostics).slice(-MEMORY_LIMITS.maxDiagnostics),
      providerRequired:false,
      embeddingRequired:false,
      externalDatabaseRequired:false,
    };
  }

  snapshot() {
    return {
      kind:'MemoryHistorianIndexSnapshot',
      records:[...this.records.values()].map(deepClone),
      revision:this.revision,
      sequence:this.sequence,
      diagnostics:deepClone(this.diagnostics),
    };
  }

  restore(snapshot) {
    this.records=new Map();
    this.inverted=new Map();
    this.revision=snapshot?.revision??'memory-historian:empty';
    this.sequence=Number(snapshot?.sequence??0);
    this.diagnostics=deepClone(snapshot?.diagnostics??[]).slice(-MEMORY_LIMITS.maxDiagnostics);
    for (const record of snapshot?.records??[]) this.addRecord(record);
  }
}

export {HistorianMemoryChannel};
