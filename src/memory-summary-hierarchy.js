import {
  AuthorityClass,
  KnowledgeStatus,
  MEMORY_LIMITS,
  MemoryArtifactKind,
  PerspectiveScope,
  createArtifactReference,
  createCandidateNomination,
  deepClone,
  requiredString,
  stableHash,
  stableStringify,
  uniqStrings,
} from './memory-contracts.js';

export const MEMORY_SUMMARY_COMPILER_REVISION='memory-summary-local-v1';
export const MEMORY_SUMMARY_POLICY_REVISION='memory-summary-policy-v1';

export const SummaryScopeLevel=Object.freeze({
  SCENE:'SCENE',
  CHAPTER:'CHAPTER',
  SESSION:'SESSION',
  ARC:'ARC',
  STORY:'STORY',
});

const LEVEL_ORDER=Object.freeze({
  SCENE:0,
  CHAPTER:1,
  SESSION:1,
  ARC:2,
  STORY:3,
});

const SUMMARY_KIND=Object.freeze({
  SCENE:MemoryArtifactKind.SCENE_SUMMARY,
  CHAPTER:MemoryArtifactKind.CHAPTER_SUMMARY,
  SESSION:MemoryArtifactKind.SESSION_SUMMARY,
  ARC:MemoryArtifactKind.ARC_SUMMARY,
  STORY:MemoryArtifactKind.STORY_SUMMARY,
});

const TOKEN_RE=/[a-z0-9][a-z0-9'-]{1,}/g;
const STOP=new Set(['the','a','an','and','or','of','to','in','on','at','for','with','is','was','were','be','been','about','tell','me','what','who','where','when','how','did','does','do']);

function tokens(value) {
  return [...new Set((String(value??'').toLowerCase().match(TOKEN_RE)??[]).filter((t)=>!STOP.has(t)))];
}

function normalizeExact(value) {
  return String(value??'').replace(/\s+/g,' ').trim();
}

function boundedNumber(value,{min=-Infinity,max=Infinity,fallback=0}={}) {
  const n=Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min,Math.min(max,n));
}

function normalizeSelector(input={}) {
  const numberOrNull=(value)=>value==null?null:Number(value);
  return {
    appendSequenceStart:numberOrNull(input.appendSequenceStart),
    appendSequenceEnd:numberOrNull(input.appendSequenceEnd),
    worldRevisionStart:numberOrNull(input.worldRevisionStart),
    worldRevisionEnd:numberOrNull(input.worldRevisionEnd),
    sceneRevisionStart:numberOrNull(input.sceneRevisionStart),
    sceneRevisionEnd:numberOrNull(input.sceneRevisionEnd),
    narrativeTimeStart:numberOrNull(input.narrativeTimeStart),
    narrativeTimeEnd:numberOrNull(input.narrativeTimeEnd),
  };
}

function within(value,start,end) {
  if (value==null) return start==null&&end==null;
  if (start!=null&&Number(value)<Number(start)) return false;
  if (end!=null&&Number(value)>Number(end)) return false;
  return true;
}

function selectorMatches(selector,row) {
  const hasSelector=Object.values(selector).some((value)=>value!=null);
  if (!hasSelector) return false;
  return within(row.appendSequence,selector.appendSequenceStart,selector.appendSequenceEnd)
    && within(row.worldRevision,selector.worldRevisionStart,selector.worldRevisionEnd)
    && within(row.sceneRevision,selector.sceneRevisionStart,selector.sceneRevisionEnd)
    && within(row.occurredAt,selector.narrativeTimeStart,selector.narrativeTimeEnd);
}

function intersection(values) {
  if (!values.length) return [];
  let out=new Set(values[0]??[]);
  for (const list of values.slice(1)) {
    const next=new Set(list??[]);
    out=new Set([...out].filter((value)=>next.has(value)));
  }
  return [...out].sort();
}

function claimText(claim) {
  const status=claim.status??claim.truthStatus??KnowledgeStatus.HISTORICAL;
  return '['+status+'] '+claim.subjectId+' '+claim.predicate+' = '+stableStringify(claim.value)+' {claim:'+claim.id+'}';
}

function summarizeRange(rows) {
  if (!rows.length) {
    return {
      evidenceCount:0,
      appendSequence:{start:null,end:null},
      worldRevision:{start:null,end:null},
      sceneRevision:{start:null,end:null},
      narrativeTime:{start:null,end:null},
    };
  }
  const finite=(key)=>rows.map((row)=>row[key]).filter((value)=>Number.isFinite(Number(value))).map(Number);
  const bounds=(list)=>list.length?{start:Math.min(...list),end:Math.max(...list)}:{start:null,end:null};
  return {
    evidenceCount:rows.length,
    appendSequence:bounds(finite('appendSequence')),
    worldRevision:bounds(finite('worldRevision')),
    sceneRevision:bounds(finite('sceneRevision')),
    narrativeTime:bounds(finite('occurredAt')),
  };
}

function artifactTypeFor(level) {
  const type=SUMMARY_KIND[level];
  if (!type) throw new Error('MEMORY_SUMMARY_LEVEL_UNSUPPORTED:'+String(level));
  return type;
}

function uniqueById(rows) {
  const map=new Map();
  for (const row of rows) if (row?.id&&!map.has(row.id)) map.set(row.id,row);
  return [...map.values()];
}

function representativeRows(rows,limit) {
  if (rows.length<=limit) return [...rows];
  const indexes=new Set([0,rows.length-1]);
  const slots=Math.max(2,limit);
  for (let i=1;i<slots-1;i+=1) indexes.add(Math.round(i*(rows.length-1)/(slots-1)));
  return [...indexes].sort((a,b)=>a-b).slice(0,limit).map((index)=>rows[index]);
}

function scopeRef(level,scopeId) {
  return String(level)+':'+String(scopeId);
}

export class MemorySummaryHierarchy {
  constructor({graph,experienceStore,snapshot=null}={}) {
    if (!graph||!experienceStore) throw new TypeError('MemorySummaryHierarchy requires graph and experienceStore');
    this.graph=graph;
    this.experienceStore=experienceStore;
    this.scopes=new Map();
    this.artifacts=new Map();
    this.historyByScope=new Map();
    this.currentByScope=new Map();
    this.workQueue=[];
    this.definitionSequence=0;
    this.artifactSequence=0;
    this.workSequence=0;
    this.diagnostics=[];
    this.costCounters={
      compileWorkUnits:0,
      compileEvidenceExamined:0,
      compileChildArtifactsRead:0,
      historianQueries:0,
      historianSummaryArtifactsExamined:0,
      historianBaseQueriesAvoided:0,
      historianBaseQueriesUsed:0,
    };
    if (snapshot) this.restore(snapshot);
  }

  defineScope({
    level,
    scopeId,
    parentScopeRefs=[],
    childScopeRefs=[],
    evidenceRefs=[],
    episodeLogicalIds=[],
    sourceSelector={},
    narrativeTimeRange=null,
    provenance=[],
    summaryPolicyRevision=MEMORY_SUMMARY_POLICY_REVISION,
    compilerRevision=MEMORY_SUMMARY_COMPILER_REVISION,
    maxCharacters=MEMORY_LIMITS.maxSummaryCharacters,
  }={}) {
    const normalizedLevel=requiredString(level,'summaryScope.level').toUpperCase();
    if (!(normalizedLevel in LEVEL_ORDER)) throw new Error('MEMORY_SUMMARY_LEVEL_UNSUPPORTED:'+normalizedLevel);
    const id=requiredString(scopeId,'summaryScope.scopeId');
    const ref=scopeRef(normalizedLevel,id);
    const previous=this.scopes.get(ref);
    const definitionRevision=Number(previous?.definitionRevision??0)+1;
    const scope={
      kind:'MemorySummaryScope',
      contractVersion:'1.0.0',
      scopeRef:ref,
      level:normalizedLevel,
      scopeId:id,
      definitionRevision,
      parentScopeRefs:uniqStrings(parentScopeRefs,MEMORY_LIMITS.maxSummaryChildScopes),
      childScopeRefs:uniqStrings(childScopeRefs,MEMORY_LIMITS.maxSummaryChildScopes),
      evidenceRefs:uniqStrings(evidenceRefs,MEMORY_LIMITS.maxSummaryEvidenceRefs),
      episodeLogicalIds:uniqStrings(episodeLogicalIds,MEMORY_LIMITS.maxSummaryEpisodeLogicalIds),
      sourceSelector:normalizeSelector(sourceSelector),
      narrativeTimeRange:narrativeTimeRange==null?null:deepClone(narrativeTimeRange),
      provenance:deepClone(provenance).slice(0,64),
      summaryPolicyRevision:requiredString(summaryPolicyRevision,'summaryScope.summaryPolicyRevision'),
      compilerRevision:requiredString(compilerRevision,'summaryScope.compilerRevision'),
      maxCharacters:Math.max(
        MEMORY_LIMITS.minSummaryCharacters,
        Math.min(MEMORY_LIMITS.maxSummaryCharacters,Number(maxCharacters)||MEMORY_LIMITS.maxSummaryCharacters),
      ),
      updatedSequence:++this.definitionSequence,
      authorityGranted:false,
      settlementAuthority:false,
      contextSealAuthority:false,
    };
    this.scopes.set(ref,scope);
    this.markScopeConeStale(ref,'SCOPE_DEFINITION_CHANGED',{includeDescendants:false});
    this.enqueueRebuild([ref],{reason:'SCOPE_DEFINITION_CHANGED',includeDescendants:true,includeAncestors:true});
    return deepClone(scope);
  }

  scope(ref) {
    const row=this.scopes.get(ref);
    return row?deepClone(row):null;
  }

  parentsOf(ref) {
    const direct=new Set(this.scopes.get(ref)?.parentScopeRefs??[]);
    for (const row of this.scopes.values()) if (row.childScopeRefs.includes(ref)) direct.add(row.scopeRef);
    return [...direct].filter((id)=>this.scopes.has(id)).sort();
  }

  descendantsOf(ref) {
    const out=new Set();
    const queue=[...(this.scopes.get(ref)?.childScopeRefs??[])];
    while (queue.length) {
      const current=queue.shift();
      if (out.has(current)||!this.scopes.has(current)) continue;
      out.add(current);
      queue.push(...(this.scopes.get(current)?.childScopeRefs??[]));
    }
    return [...out];
  }

  ancestorsOf(ref) {
    const out=new Set();
    const queue=this.parentsOf(ref);
    while (queue.length) {
      const current=queue.shift();
      if (out.has(current)||!this.scopes.has(current)) continue;
      out.add(current);
      queue.push(...this.parentsOf(current));
    }
    return [...out];
  }

  evidenceForScope(scope) {
    const ids=new Set(scope.evidenceRefs);
    for (const id of this.graph.evidenceOrder??[]) {
      const row=this.graph.evidenceRecord(id);
      if (row&&selectorMatches(scope.sourceSelector,row)) ids.add(id);
      if (ids.size>MEMORY_LIMITS.maxSummaryEvidenceRefs) throw new Error('MEMORY_SUMMARY_EVIDENCE_BOUND_EXCEEDED');
    }
    const episodes=new Map(this.experienceStore.currentEpisodes({freshOnly:true}).map((row)=>[row.logicalId,row]));
    for (const logicalId of scope.episodeLogicalIds) {
      const episode=episodes.get(logicalId);
      if (!episode) continue;
      for (const id of episode.evidenceRefs) ids.add(id);
    }
    for (const childRef of scope.childScopeRefs) {
      const child=this.currentArtifact(childRef,{freshOnly:true});
      if (!child) throw new Error('MEMORY_SUMMARY_CHILD_UNAVAILABLE:'+childRef);
      for (const id of child.exactEvidenceRefs) ids.add(id);
    }
    if (ids.size>MEMORY_LIMITS.maxSummaryEvidenceRefs) throw new Error('MEMORY_SUMMARY_EVIDENCE_BOUND_EXCEEDED');
    const rows=[...ids].map((id)=>this.graph.evidenceRecord(id)).filter(Boolean)
      .filter((row)=>this.graph.evidenceFresh(row.id))
      .sort((a,b)=>a.appendSequence-b.appendSequence||a.id.localeCompare(b.id));
    return rows;
  }

  relevantClaims(evidenceIds) {
    const evidenceSet=new Set(evidenceIds);
    const rows=uniqueById([
      ...this.graph.currentProjection({includeStale:false}),
      ...this.graph.historicalClaims({includeUnresolved:true,includeStale:false}),
    ]);
    return rows.filter((claim)=>(claim.evidenceIds??[]).some((id)=>evidenceSet.has(id)))
      .sort((a,b)=>Number(a.settlementSequence??0)-Number(b.settlementSequence??0)||a.id.localeCompare(b.id));
  }

  relevantUnresolvedSets(evidenceIds) {
    const evidenceSet=new Set(evidenceIds);
    return this.graph.unresolvedSets({includeStale:false}).filter((set)=>
      (set.claims??[]).some((claim)=>(claim.evidenceIds??[]).some((id)=>evidenceSet.has(id))),
    );
  }

  relevantReflections(evidenceIds) {
    const evidenceSet=new Set(evidenceIds);
    return this.experienceStore.currentReflections({freshOnly:true}).filter((reflection)=>
      [...(reflection.supportEvidenceRefs??[]),...(reflection.contradictionEvidenceRefs??[])].some((id)=>evidenceSet.has(id)),
    );
  }

  dependencyFingerprint(scope,rows,childArtifacts,claims,reflections) {
    return stableHash(stableStringify({
      scopeRef:scope.scopeRef,
      definitionRevision:scope.definitionRevision,
      compilerRevision:scope.compilerRevision,
      summaryPolicyRevision:scope.summaryPolicyRevision,
      evidence:rows.map((row)=>[row.id,row.sourceRevisionId,row.contentHash,row.appendSequence]),
      children:childArtifacts.map((row)=>[row.scopeRef,row.id,row.revision,row.dependencyFingerprint]),
      claims:claims.map((row)=>[row.id,row.status,row.settlementDecisionId,row.sourceRevisionIds]),
      reflections:reflections.map((row)=>[row.id,row.revision,row.freshness]),
    }));
  }

  buildRepresentation({scope,rows,claims,unresolvedSets,reflections,maxCharacters}) {
    const hardRules=rows.filter((row)=>row.authorityClass===AuthorityClass.SOURCE_CANON||row.evidenceKind==='SOURCE');
    const essentials=[
      '['+scope.level+' '+scope.scopeId+'] DERIVED NAVIGATION ONLY — exact sources remain authoritative.',
      ...hardRules.map((row)=>'[SOURCE RULE '+row.id+'] '+normalizeExact(row.exactContent)),
      ...claims.map(claimText),
      ...unresolvedSets.map((set)=>{
        const alternatives=(set.claims??[]).map((claim)=>stableStringify(claim.value)).join(' | ');
        return '[UNRESOLVED '+String(set.slotKey??set.key??'set')+'] '+alternatives;
      }),
      '[DRILLBACK] '+rows.length+' exact evidence record(s) retained by source range.',
    ];
    const essentialText=essentials.join('\n');
    if (essentialText.length>maxCharacters) {
      const error=new Error('MEMORY_SUMMARY_BUDGET_IMPOSSIBLE');
      error.details={requiredCharacters:essentialText.length,maxCharacters};
      throw error;
    }
    const optional=[];
    for (const reflection of reflections) {
      optional.push('[INFERRED NON-CANON '+reflection.id+'] '+normalizeExact(reflection.statement));
    }
    const reps=representativeRows(rows,MEMORY_LIMITS.maxSummaryRepresentativeEvidence);
    for (const row of reps) optional.push('[EVENT '+row.id+' @ '+String(row.occurredAt)+'] '+normalizeExact(row.exactContent));
    let text=essentialText;
    let includedOptional=0;
    for (const line of optional) {
      if ((text+'\n'+line).length>maxCharacters) continue;
      text+='\n'+line;
      includedOptional+=1;
    }
    return {
      text,
      essentialCharacters:essentialText.length,
      includedOptional,
      omittedOptional:Math.max(0,optional.length-includedOptional),
      representativeEvidenceRefs:reps.map((row)=>row.id),
    };
  }

  makeWorkUnit(ref) {
    const scope=this.scopes.get(ref);
    if (!scope) throw new Error('MEMORY_SUMMARY_SCOPE_UNKNOWN:'+String(ref));
    const childArtifacts=scope.childScopeRefs.map((childRef)=>this.currentArtifact(childRef,{freshOnly:true})).filter(Boolean);
    const fence=stableHash(stableStringify({
      scopeRef:ref,
      definitionRevision:scope.definitionRevision,
      currentChildIds:childArtifacts.map((row)=>row.id),
      graphRevision:this.graph.revisionRef(),
      experienceRevisionRefs:this.experienceStore.memoryRevisionRefs(),
    }));
    return {
      kind:'MemorySummaryCompactionWorkUnit',
      contractVersion:'1.0.0',
      workUnitId:'memory-summary-work:'+stableHash(ref+'|'+scope.definitionRevision+'|'+fence),
      scopeRef:ref,
      scopeLevel:scope.level,
      expectedDefinitionRevision:scope.definitionRevision,
      expectedDependencyFence:fence,
      compilerRevision:scope.compilerRevision,
      summaryPolicyRevision:scope.summaryPolicyRevision,
      runtimeSchedulingAuthority:false,
      physicalWorkerAuthority:false,
      contextSealAuthority:false,
      canonicalMutationAuthority:false,
    };
  }

  currentWorkFence(ref) {
    return this.makeWorkUnit(ref).expectedDependencyFence;
  }

  compileWorkUnit(workUnit,{maxCharacters=null}={}) {
    if (!workUnit||workUnit.kind!=='MemorySummaryCompactionWorkUnit') throw new TypeError('MemorySummaryCompactionWorkUnit required');
    const scope=this.scopes.get(workUnit.scopeRef);
    if (!scope) throw new Error('MEMORY_SUMMARY_SCOPE_UNKNOWN:'+String(workUnit.scopeRef));
    if (scope.definitionRevision!==workUnit.expectedDefinitionRevision) throw new Error('MEMORY_SUMMARY_WORK_FENCE_CHANGED');
    if (this.currentWorkFence(scope.scopeRef)!==workUnit.expectedDependencyFence) throw new Error('MEMORY_SUMMARY_WORK_FENCE_CHANGED');
    return this.compileScope(scope.scopeRef,{maxCharacters});
  }

  compileScope(ref,{maxCharacters=null}={}) {
    const scope=this.scopes.get(ref);
    if (!scope) throw new Error('MEMORY_SUMMARY_SCOPE_UNKNOWN:'+String(ref));
    const childArtifacts=scope.childScopeRefs.map((childRef)=>{
      const artifact=this.currentArtifact(childRef,{freshOnly:true});
      if (!artifact) throw new Error('MEMORY_SUMMARY_CHILD_UNAVAILABLE:'+childRef);
      return artifact;
    });
    const rows=this.evidenceForScope(scope);
    if (!rows.length) throw new Error('MEMORY_SUMMARY_NO_GROUNDED_SOURCE:'+ref);
    const evidenceIds=rows.map((row)=>row.id);
    const claims=this.relevantClaims(evidenceIds);
    const unresolvedSets=this.relevantUnresolvedSets(evidenceIds);
    const reflections=this.relevantReflections(evidenceIds);
    const cap=Math.max(
      MEMORY_LIMITS.minSummaryCharacters,
      Math.min(scope.maxCharacters,maxCharacters==null?scope.maxCharacters:Number(maxCharacters)||scope.maxCharacters),
    );
    const fingerprint=this.dependencyFingerprint(scope,rows,childArtifacts,claims,reflections);
    const current=this.currentArtifact(ref,{freshOnly:false});
    if (current&&current.state==='CURRENT'&&current.freshness==='FRESH'&&current.dependencyFingerprint===fingerprint&&current.budget.maxCharacters===cap) {
      return {...deepClone(current),reused:true};
    }
    const compiled=this.buildRepresentation({scope,rows,claims,unresolvedSets,reflections,maxCharacters:cap});
    const sourceRevisionSet=uniqStrings(rows.map((row)=>row.sourceRevisionId),MEMORY_LIMITS.maxSummarySourceRevisionRefs);
    const history=this.historyByScope.get(ref)??[];
    const revision=history.length+1;
    const artifactId='memory-summary:'+stableHash(ref+'|'+revision+'|'+fingerprint+'|'+stableHash(compiled.text));
    if (current&&current.state==='CURRENT') {
      const prior=this.artifacts.get(current.id);
      if (prior) {
        prior.state='HISTORICAL';
        prior.freshness='STALE';
        prior.replacedByArtifactId=artifactId;
      }
    }
    const fullyKnownBy=intersection(rows.map((row)=>row.knownBy??[]));
    const entityRefs=uniqStrings([
      ...rows.flatMap((row)=>row.participants??[]),
      ...claims.flatMap((claim)=>[claim.subjectId,typeof claim.value==='string'?claim.value:null].filter(Boolean)),
      ...reflections.flatMap((reflection)=>reflection.subjectRefs??[]),
    ],MEMORY_LIMITS.maxSummaryEntityRefs);
    const sourceRange=summarizeRange(rows);
    const sourceRangeHash=stableHash(stableStringify(evidenceIds));
    const artifact={
      kind:'MemoryHierarchicalSummary',
      contractVersion:'1.0.0',
      artifactType:artifactTypeFor(scope.level),
      id:artifactId,
      scopeRef:ref,
      scopeId:scope.scopeId,
      scopeLevel:scope.level,
      revision,
      definitionRevision:scope.definitionRevision,
      parentScopeRefs:[...scope.parentScopeRefs],
      childScopeRefs:[...scope.childScopeRefs],
      childArtifactRefs:childArtifacts.map((row)=>({
        artifactId:row.id,
        scopeRef:row.scopeRef,
        revision:row.revision,
        sourceRangeHash:row.sourceRangeHash,
      })),
      exactEvidenceRefs:evidenceIds,
      exactSourceRevisionSet:sourceRevisionSet,
      sourceRange,
      sourceRangeHash,
      narrativeTimeRange:scope.narrativeTimeRange??deepClone(sourceRange.narrativeTime),
      temporalClaims:claims.map((claim)=>({
        id:claim.id,
        subjectId:claim.subjectId,
        predicate:claim.predicate,
        value:deepClone(claim.value),
        status:claim.status,
        authorityClass:claim.authorityClass,
        evidenceIds:[...(claim.evidenceIds??[])],
        sourceRevisionIds:[...(claim.sourceRevisionIds??[])],
      })),
      unresolvedSetRefs:unresolvedSets.map((set)=>String(set.slotKey??set.key??stableHash(stableStringify(set)))),
      inferredReflectionRefs:reflections.map((row)=>row.id),
      representationText:compiled.text,
      representativeEvidenceRefs:compiled.representativeEvidenceRefs,
      entityRefs,
      knowledgeFence:{
        perspective:PerspectiveScope.WORLD,
        fullyKnownBy,
        evidenceKnowledge:rows.map((row)=>({evidenceId:row.id,knownBy:[...(row.knownBy??[])]})),
      },
      summaryPolicyRevision:scope.summaryPolicyRevision,
      compilerRevision:scope.compilerRevision,
      dependencyFingerprint:fingerprint,
      provenance:[
        ...deepClone(scope.provenance),
        {
          kind:'MemorySummaryCompilation',
          compilerRevision:scope.compilerRevision,
          summaryPolicyRevision:scope.summaryPolicyRevision,
          sourceRangeHash,
          childArtifactIds:childArtifacts.map((row)=>row.id),
        },
      ],
      budget:{
        maxCharacters:cap,
        actualCharacters:compiled.text.length,
        essentialCharacters:compiled.essentialCharacters,
        omittedOptional:compiled.omittedOptional,
      },
      cost:{
        evidenceExamined:rows.length,
        childArtifactsRead:childArtifacts.length,
        claimRecordsRead:claims.length,
        reflectionRecordsRead:reflections.length,
      },
      authorityClass:AuthorityClass.DERIVED,
      truthStatus:KnowledgeStatus.HISTORICAL,
      independentEvidence:false,
      navigationOnly:true,
      worldTruthAuthority:false,
      settlementAuthority:false,
      admissionAuthority:false,
      contextInjectionAuthority:false,
      contextSealAuthority:false,
      freshness:'FRESH',
      state:'CURRENT',
      createdSequence:++this.artifactSequence,
      replacedByArtifactId:null,
      reused:false,
    };
    this.artifacts.set(artifact.id,artifact);
    this.historyByScope.set(ref,[...history,artifact.id]);
    this.currentByScope.set(ref,artifact.id);
    this.costCounters.compileWorkUnits+=1;
    this.costCounters.compileEvidenceExamined+=rows.length;
    this.costCounters.compileChildArtifactsRead+=childArtifacts.length;
    return deepClone(artifact);
  }

  artifactIsFresh(artifact) {
    if (!artifact||artifact.state!=='CURRENT'||artifact.freshness!=='FRESH') return false;
    if (this.currentByScope.get(artifact.scopeRef)!==artifact.id) return false;
    if (!artifact.exactSourceRevisionSet.every((ref)=>this.graph.isSourceRevisionActive(ref))) return false;
    const scope=this.scopes.get(artifact.scopeRef);
    if (!scope||scope.definitionRevision!==artifact.definitionRevision) return false;
    for (const child of artifact.childArtifactRefs) {
      const current=this.currentByScope.get(child.scopeRef);
      if (current!==child.artifactId) return false;
      const row=this.artifacts.get(child.artifactId);
      if (!row||row.freshness!=='FRESH'||row.state!=='CURRENT') return false;
    }
    return true;
  }

  refreshFreshness() {
    const stale=[];
    for (const id of this.currentByScope.values()) {
      const artifact=this.artifacts.get(id);
      if (!artifact) continue;
      if (!this.artifactIsFresh(artifact)) {
        artifact.freshness='STALE';
        stale.push(artifact.id);
      }
    }
    return stale.sort();
  }

  currentArtifact(ref,{freshOnly=true}={}) {
    const id=this.currentByScope.get(ref);
    const artifact=id?this.artifacts.get(id):null;
    if (!artifact) return null;
    if (freshOnly&&!this.artifactIsFresh(artifact)) return null;
    return deepClone(artifact);
  }

  currentArtifacts({freshOnly=true}={}) {
    this.refreshFreshness();
    return [...this.currentByScope.entries()].map(([ref,id])=>this.artifacts.get(id))
      .filter(Boolean)
      .filter((row)=>!freshOnly||this.artifactIsFresh(row))
      .map(deepClone)
      .sort((a,b)=>LEVEL_ORDER[a.scopeLevel]-LEVEL_ORDER[b.scopeLevel]||a.scopeRef.localeCompare(b.scopeRef));
  }

  artifactHistory(ref) {
    return (this.historyByScope.get(ref)??[]).map((id)=>deepClone(this.artifacts.get(id))).filter(Boolean);
  }

  exactDrillback(artifactOrId,{offset=0,limit=MEMORY_LIMITS.maxSummaryDrillbackRows}={}) {
    const artifact=typeof artifactOrId==='string'?this.artifacts.get(artifactOrId):artifactOrId;
    if (!artifact||artifact.kind!=='MemoryHierarchicalSummary') return [];
    const start=Math.max(0,Number(offset)||0);
    const cap=Math.max(1,Math.min(MEMORY_LIMITS.maxSummaryDrillbackRows,Number(limit)||MEMORY_LIMITS.maxSummaryDrillbackRows));
    return artifact.exactEvidenceRefs.slice(start,start+cap).map((id)=>this.graph.exactEvidence(id)).filter(Boolean);
  }

  markScopeConeStale(ref,reason,{includeDescendants=false}={}) {
    const affected=new Set([ref,...this.ancestorsOf(ref),...(includeDescendants?this.descendantsOf(ref):[])]);
    const staleArtifactIds=[];
    for (const scopeId of affected) {
      const id=this.currentByScope.get(scopeId);
      const artifact=id?this.artifacts.get(id):null;
      if (artifact&&artifact.state==='CURRENT') {
        artifact.freshness='STALE';
        artifact.staleReason=reason;
        staleArtifactIds.push(artifact.id);
      }
    }
    return {affectedScopeRefs:[...affected].sort(),staleArtifactIds:staleArtifactIds.sort()};
  }

  invalidateSourceRevision(sourceRevisionId,{reason='SOURCE_REVISION_INVALIDATED'}={}) {
    const affected=[];
    for (const [ref,id] of this.currentByScope.entries()) {
      const artifact=this.artifacts.get(id);
      if (artifact?.exactSourceRevisionSet.includes(sourceRevisionId)) affected.push(ref);
    }
    const allScopes=new Set();
    const staleArtifactIds=[];
    for (const ref of affected) {
      const receipt=this.markScopeConeStale(ref,reason);
      receipt.affectedScopeRefs.forEach((id)=>allScopes.add(id));
      staleArtifactIds.push(...receipt.staleArtifactIds);
    }
    if (allScopes.size) this.enqueueRebuild([...allScopes],{reason,includeDescendants:false,includeAncestors:false});
    const receipt={
      kind:'MemorySummaryInvalidationReceipt',
      sourceRevisionId,
      reason,
      affectedScopeRefs:[...allScopes].sort(),
      staleArtifactIds:[...new Set(staleArtifactIds)].sort(),
      unrelatedScopesPreserved:this.currentByScope.size-allScopes.size,
    };
    this.pushDiagnostic(receipt);
    return receipt;
  }

  invalidateEvidenceRefs(evidenceRefs=[],reason='DEPENDENCY_CHANGED') {
    const refs=new Set(evidenceRefs);
    const affected=[];
    for (const [ref,id] of this.currentByScope.entries()) {
      const artifact=this.artifacts.get(id);
      if (artifact?.exactEvidenceRefs.some((id)=>refs.has(id))) affected.push(ref);
    }
    const all=new Set();
    for (const ref of affected) this.markScopeConeStale(ref,reason).affectedScopeRefs.forEach((id)=>all.add(id));
    if (all.size) this.enqueueRebuild([...all],{reason,includeDescendants:false,includeAncestors:false});
    return [...all].sort();
  }

  onEvidenceAppended(evidence) {
    const affected=[];
    for (const scope of this.scopes.values()) if (selectorMatches(scope.sourceSelector,evidence)) affected.push(scope.scopeRef);
    for (const ref of affected) this.markScopeConeStale(ref,'NEW_EVIDENCE');
    if (affected.length) this.enqueueRebuild(affected,{reason:'NEW_EVIDENCE',includeDescendants:false,includeAncestors:true});
    return affected.sort();
  }

  onEpisodePublished(episode) {
    const affected=[...this.scopes.values()].filter((scope)=>scope.episodeLogicalIds.includes(episode.logicalId)).map((scope)=>scope.scopeRef);
    for (const ref of affected) this.markScopeConeStale(ref,'EPISODE_REVISION_CHANGED');
    if (affected.length) this.enqueueRebuild(affected,{reason:'EPISODE_REVISION_CHANGED',includeDescendants:false,includeAncestors:true});
    return affected.sort();
  }

  enqueueRebuild(scopeRefs=[],{reason='REBUILD_REQUESTED',includeDescendants=false,includeAncestors=true}={}) {
    const refs=new Set();
    for (const ref of scopeRefs) {
      if (!this.scopes.has(ref)) continue;
      refs.add(ref);
      if (includeDescendants) this.descendantsOf(ref).forEach((id)=>refs.add(id));
      if (includeAncestors) this.ancestorsOf(ref).forEach((id)=>refs.add(id));
    }
    const pending=new Set(this.workQueue.filter((row)=>row.state==='PENDING').map((row)=>row.scopeRef));
    for (const ref of refs) {
      if (pending.has(ref)) continue;
      const scope=this.scopes.get(ref);
      this.workQueue.push({
        kind:'MemorySummaryQueuedWork',
        id:'memory-summary-queue:'+stableHash(ref+'|'+String(++this.workSequence)+'|'+reason),
        scopeRef:ref,
        scopeLevel:scope.level,
        reason,
        state:'PENDING',
        queuedDefinitionRevision:scope.definitionRevision,
        attempts:0,
        lastError:null,
      });
      pending.add(ref);
    }
    return this.pendingWork();
  }

  pendingWork() {
    return this.workQueue.filter((row)=>row.state==='PENDING').map(deepClone)
      .sort((a,b)=>LEVEL_ORDER[a.scopeLevel]-LEVEL_ORDER[b.scopeLevel]||a.scopeRef.localeCompare(b.scopeRef));
  }

  nextWorkUnits({maxUnits=MEMORY_LIMITS.maxSummaryWorkUnits}={}) {
    return this.pendingWork().slice(0,Math.max(1,Math.min(MEMORY_LIMITS.maxSummaryWorkUnits,Number(maxUnits)||1)))
      .map((row)=>this.makeWorkUnit(row.scopeRef));
  }

  runCompaction({maxUnits=MEMORY_LIMITS.maxSummaryWorkUnits,maxCharacters=null}={}) {
    const cap=Math.max(1,Math.min(MEMORY_LIMITS.maxSummaryWorkUnits,Number(maxUnits)||1));
    const publishedArtifactIds=[];
    const reusedArtifactIds=[];
    const failures=[];
    let used=0;
    while (used<cap) {
      const pending=this.pendingWork();
      if (!pending.length) break;
      const row=pending[0];
      const queueRow=this.workQueue.find((item)=>item.id===row.id);
      queueRow.attempts+=1;
      try {
        const unit=this.makeWorkUnit(row.scopeRef);
        const artifact=this.compileWorkUnit(unit,{maxCharacters});
        if (artifact.reused) reusedArtifactIds.push(artifact.id);
        else publishedArtifactIds.push(artifact.id);
        queueRow.state='COMPLETED';
        queueRow.completedArtifactId=artifact.id;
      } catch (error) {
        const message=error?.message??String(error);
        queueRow.lastError=message;
        if (message.startsWith('MEMORY_SUMMARY_CHILD_UNAVAILABLE:')) {
          const childRef=message.slice('MEMORY_SUMMARY_CHILD_UNAVAILABLE:'.length);
          this.enqueueRebuild([childRef],{reason:'PARENT_BLOCKED_ON_CHILD',includeDescendants:true,includeAncestors:false});
          failures.push({scopeRef:row.scopeRef,code:message,retryable:true});
        } else {
          queueRow.state='FAILED';
          failures.push({scopeRef:row.scopeRef,code:message,retryable:false,details:deepClone(error?.details??null)});
        }
      }
      used+=1;
    }
    const result={
      kind:'MemorySummaryCompactionBatch',
      state:this.pendingWork().length?'CHECKPOINTED':'COMPLETED',
      usedWorkUnits:used,
      publishedArtifactIds,
      reusedArtifactIds,
      failures,
      pendingWorkUnits:this.pendingWork().length,
      checkpoint:{
        queueRevision:'memory-summary-queue:'+stableHash(stableStringify(this.workQueue.map((row)=>[row.id,row.state,row.attempts,row.completedArtifactId??null]))),
        pendingScopeRefs:this.pendingWork().map((row)=>row.scopeRef),
      },
      runtimeSchedulingAuthority:false,
      physicalWorkerAuthority:false,
      contextSealAuthority:false,
    };
    this.pushDiagnostic(result);
    return deepClone(result);
  }

  classifyResolution(request={}) {
    const hint=String(request.resolutionHint??'AUTO').toUpperCase();
    if (['EXACT','SCENE','CHAPTER','SESSION','ARC','STORY'].includes(hint)) return hint;
    const text=String(request.query??'');
    if (request.precisionRequired||/\b(who|which|exact|immediately|directly|quote|source|before|after|when|where)\b/i.test(text)) return 'EXACT';
    if (request.breadth==='BROAD'||request.temporalDistance==='DISTANT'||/\b(overview|summary|recap|story|arc|history|what happened|over time|long[- ]?term)\b/i.test(text)) return 'STORY';
    return 'SCENE';
  }

  summaryScore(artifact,queryTokens,activeEntityIds,preferred) {
    const textTokens=new Set(tokens(artifact.representationText+' '+artifact.entityRefs.join(' ')));
    const matched=queryTokens.filter((token)=>textTokens.has(token));
    const lexical=queryTokens.length?matched.length/queryTokens.length:0;
    const entityHits=activeEntityIds.filter((id)=>artifact.entityRefs.includes(id)).length;
    const entityOverlap=activeEntityIds.length?entityHits/activeEntityIds.length:0;
    const order=LEVEL_ORDER[artifact.scopeLevel];
    let resolutionFit=0.4;
    if (preferred==='STORY') resolutionFit=artifact.scopeLevel==='STORY'?1:artifact.scopeLevel==='ARC'?0.9:artifact.scopeLevel==='SCENE'?0.55:0.7;
    else if (preferred==='ARC') resolutionFit=artifact.scopeLevel==='ARC'?1:artifact.scopeLevel==='STORY'?0.75:0.65;
    else if (preferred==='SCENE') resolutionFit=artifact.scopeLevel==='SCENE'?1:['CHAPTER','SESSION'].includes(artifact.scopeLevel)?0.75:0.45;
    else resolutionFit=artifact.scopeLevel===preferred?1:0.5;
    const relevance=Math.max(lexical,entityOverlap);
    return {
      lexical,
      entityOverlap,
      resolutionFit,
      normalized:Math.max(0,Math.min(1,lexical*0.68+entityOverlap*0.17+resolutionFit*0.15)),
      eligible:relevance>0,
    };
  }

  nominationsFromSummaries(request,preferred) {
    const queryTokens=tokens(request.query);
    const activeEntityIds=uniqStrings(request.activeEntityIds??[],64);
    const perspective=request.perspectiveConstraint??{scope:PerspectiveScope.WORLD};
    const budget=request.budgetCharacters==null?Infinity:Math.max(1,Number(request.budgetCharacters)||1);
    const all=this.currentArtifacts({freshOnly:true});
    const tierOrder=preferred==='STORY'
      ? [['STORY'],['ARC'],['CHAPTER','SESSION'],['SCENE']]
      : preferred==='ARC'
        ? [['ARC'],['CHAPTER','SESSION'],['STORY'],['SCENE']]
        : preferred==='SCENE'
          ? [['SCENE'],['CHAPTER','SESSION'],['ARC'],['STORY']]
          : [[preferred],['SCENE'],['CHAPTER','SESSION'],['ARC'],['STORY']];
    let examined=0;
    let scored=[];
    let selectedTier=[];
    for (const tier of tierOrder) {
      const tierScored=[];
      for (const artifact of all) {
        if (!tier.includes(artifact.scopeLevel)) continue;
        examined+=1;
        if (examined>MEMORY_LIMITS.maxHistorianExaminedArtifacts) break;
        if (artifact.representationText.length>budget) continue;
        if (perspective.scope===PerspectiveScope.CHARACTER_KNOWLEDGE) {
          const characterRef=perspective.characterRef??perspective.characterId;
          if (!characterRef||!artifact.knowledgeFence.fullyKnownBy.includes(characterRef)) continue;
        }
        const score=this.summaryScore(artifact,queryTokens,activeEntityIds,preferred);
        if (!score.eligible) continue;
        tierScored.push({artifact,score});
      }
      if (tierScored.length) {
        scored=tierScored;
        selectedTier=tier;
        break;
      }
      if (examined>=MEMORY_LIMITS.maxHistorianExaminedArtifacts) break;
    }
    this.costCounters.historianSummaryArtifactsExamined+=examined;
    scored.sort((a,b)=>b.score.normalized-a.score.normalized||b.score.resolutionFit-a.score.resolutionFit||a.artifact.scopeRef.localeCompare(b.artifact.scopeRef));
    const deduped=[];
    const coverage=new Set();
    for (const item of scored) {
      if (coverage.has(item.artifact.sourceRangeHash)) continue;
      coverage.add(item.artifact.sourceRangeHash);
      deduped.push(item);
    }
    const cap=Math.max(1,Math.min(MEMORY_LIMITS.maxHistorianCandidates,Number(request.maxCandidates)||MEMORY_LIMITS.maxHistorianCandidates));
    const picked=deduped.slice(0,cap);
    const intentId=request.retrievalIntentId??('memory-intent:'+stableHash(String(request.mode??'EXPLICIT_HISTORY')+'|'+String(request.query??'').toLowerCase()));
    const nominations=picked.map(({artifact,score})=>createCandidateNomination({
      nominationId:'memory-summary-nomination:' + stableHash(intentId+'|'+artifact.id),
      candidateId:'memory-summary-candidate:' + stableHash(artifact.id),
      evidenceIdentity:'summary-range:'+artifact.sourceRangeHash,
      artifactRef:createArtifactReference({
        artifactId:artifact.id,
        artifactType:artifact.artifactType,
        owner:'MEMORY',
        revision:artifact.revision,
        sourceRevisionSet:artifact.exactSourceRevisionSet.slice(0,MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact),
        worldRevision:artifact.sourceRange.worldRevision.end,
        sceneRevision:artifact.scopeLevel==='SCENE'?artifact.sourceRange.sceneRevision.end:null,
        contentHash:stableHash(artifact.representationText),
        provenanceRef:'memory-summary-provenance:'+artifact.id,
      }),
      artifactRevision:artifact.revision,
      sourceRevisionRefs:artifact.exactSourceRevisionSet.slice(0,MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact),
      claimRefs:artifact.temporalClaims.map((row)=>row.id).slice(0,64),
      eventRefs:artifact.representativeEvidenceRefs.slice(0,64),
      entityRefs:artifact.entityRefs.slice(0,64),
      relationshipRefs:[],
      retrievalIntentIds:[intentId],
      rankSignals:{
        intentMatch:score.lexical,
        entityOverlap:score.entityOverlap,
        temporalFit:score.resolutionFit,
        significance:0.7,
        recency:0,
        perspectiveCompatibility:1,
        deterministicLocal:true,
        resolutionAware:true,
      },
      normalizedRank:score.normalized,
      temporalHints:[artifact.scopeLevel,'RANGE:'+String(artifact.sourceRange.narrativeTime.start)+'..'+String(artifact.sourceRange.narrativeTime.end)],
      authorityClass:AuthorityClass.DERIVED,
      truthStatusHint:artifact.unresolvedSetRefs.length?KnowledgeStatus.UNRESOLVED:KnowledgeStatus.HISTORICAL,
      provenance:artifact.provenance,
      evidenceRefs:artifact.representativeEvidenceRefs.slice(0,64),
      dependencyRevisions:[artifact.id,artifact.compilerRevision,artifact.summaryPolicyRevision].slice(0,64),
      representationRef:'memory-summary-record:'+artifact.id,
      representationRevision:artifact.revision,
      representationText:artifact.representationText,
      metadata:{
        memoryKind:artifact.artifactType,
        historianChannel:'HIERARCHICAL_SUMMARY',
        resolutionLevel:artifact.scopeLevel,
        summaryArtifactId:artifact.id,
        summaryScopeRef:artifact.scopeRef,
        sourceRange:deepClone(artifact.sourceRange),
        sourceRangeHash:artifact.sourceRangeHash,
        exactSourceRevisionCount:artifact.exactSourceRevisionSet.length,
        exactEvidenceCount:artifact.exactEvidenceRefs.length,
        exactSourceDrillback:true,
        drillbackRequiredForClaimAuthority:true,
        independentEvidence:false,
        navigationOnly:true,
        unresolvedSetRefs:[...artifact.unresolvedSetRefs],
        perspective:deepClone(perspective),
        retrievalRecordRef:'memory-summary-record:'+artifact.id,
        retrievalRankAuthority:false,
        truthAuthorityGranted:false,
        memoryMutation:false,
        contextInjectionAuthority:false,
        candidateBusAdmissionAuthority:false,
        settlementAuthority:false,
        contextSealAuthority:false,
      },
      worldRevision:artifact.sourceRange.worldRevision.end,
      sceneRevision:artifact.scopeLevel==='SCENE'?artifact.sourceRange.sceneRevision.end:null,
    }));
    return {nominations,examined,matched:scored.length,selectedTier};
  }

  applyBudgetToBase(base,request) {
    if (request.budgetCharacters==null) return base;
    const budget=Math.max(1,Number(request.budgetCharacters)||1);
    const kept=(base.nominations??[]).filter((row)=>String(row.representationText??'').length<=budget);
    if (!kept.length&&(base.nominations??[]).length) {
      return {
        ...base,
        nominations:[],
        status:'DEGRADED',
        diagnostics:{...(base.diagnostics??{}),reason:'BUDGET_NO_SAFE_RESOLUTION',returned:0,boundedOut:(base.nominations??[]).length},
      };
    }
    return {...base,nominations:kept,diagnostics:{...(base.diagnostics??{}),returned:kept.length}};
  }

  queryHistorian(request={},baseQuery) {
    this.costCounters.historianQueries+=1;
    const preferred=this.classifyResolution(request);
    if (preferred==='EXACT') {
      this.costCounters.historianBaseQueriesUsed+=1;
      const base=this.applyBudgetToBase(baseQuery(request),request);
      return {
        ...base,
        diagnostics:{...(base.diagnostics??{}),resolutionPolicy:'EXACT',summaryArtifactsExamined:0,baseQueryUsed:true},
      };
    }
    const summary=this.nominationsFromSummaries(request,preferred);
    if (!summary.nominations.length) {
      this.costCounters.historianBaseQueriesUsed+=1;
      const base=this.applyBudgetToBase(baseQuery(request),request);
      return {
        ...base,
        diagnostics:{...(base.diagnostics??{}),resolutionPolicy:'FALLBACK_EXACT',summaryArtifactsExamined:summary.examined,baseQueryUsed:true},
      };
    }
    this.costCounters.historianBaseQueriesAvoided+=1;
    const intentId=request.retrievalIntentId??('memory-intent:'+stableHash(String(request.mode??'EXPLICIT_HISTORY')+'|'+String(request.query??'').toLowerCase()));
    return {
      kind:'MemoryHistorianQueryResult',
      contractVersion:'1.0.0',
      query:String(request.query??''),
      mode:request.mode??'EXPLICIT_HISTORY',
      retrievalIntentId:intentId,
      historianRevision:this.revisionRef(),
      nominations:summary.nominations,
      diagnostics:{
        examined:summary.examined,
        matched:summary.matched,
        returned:summary.nominations.length,
        boundedOut:Math.max(0,summary.matched-summary.nominations.length),
        resolutionPolicy:preferred,
        summaryArtifactsExamined:summary.examined,
        baseQueryUsed:false,
        deterministic:true,
        duplicateCoverageSuppressed:true,
      },
      status:'OK',
      authorityGranted:false,
      admissionAuthority:false,
      settlementAuthority:false,
      contextSealAuthority:false,
    };
  }

  drillDown(nominationOrArtifact) {
    const artifactId=typeof nominationOrArtifact==='string'
      ? nominationOrArtifact
      : nominationOrArtifact?.metadata?.summaryArtifactId??nominationOrArtifact?.artifactRef?.artifactId;
    const artifact=this.artifacts.get(artifactId);
    return artifact?this.exactDrillback(artifact):[];
  }

  revisionRef() {
    const current=[...this.currentByScope.entries()].map(([ref,id])=>[ref,id,this.artifacts.get(id)?.freshness]).sort();
    return 'memory-summary-hierarchy:'+stableHash(stableStringify({current,pending:this.pendingWork().map((row)=>row.scopeRef)}));
  }

  pushDiagnostic(row) {
    this.diagnostics.push(deepClone(row));
    if (this.diagnostics.length>MEMORY_LIMITS.maxDiagnostics) this.diagnostics.splice(0,this.diagnostics.length-MEMORY_LIMITS.maxDiagnostics);
  }

  status() {
    const current=this.currentArtifacts({freshOnly:false});
    const fresh=current.filter((row)=>this.artifactIsFresh(row));
    const snapshotEstimate=stableStringify({
      scopes:[...this.scopes.values()],
      artifacts:[...this.artifacts.values()],
      workQueue:this.workQueue,
    }).length*2;
    return {
      kind:'MemorySummaryHierarchyStatus',
      revision:this.revisionRef(),
      scopes:this.scopes.size,
      artifacts:this.artifacts.size,
      currentArtifacts:current.length,
      freshCurrentArtifacts:fresh.length,
      staleCurrentArtifacts:current.length-fresh.length,
      pendingWorkUnits:this.pendingWork().length,
      retainedArtifactRevisions:this.artifacts.size,
      exactEvidenceRefsRetained:[...this.artifacts.values()].reduce((sum,row)=>sum+row.exactEvidenceRefs.length,0),
      estimatedRetainedUtf16Bytes:snapshotEstimate,
      costCounters:deepClone(this.costCounters),
      limits:{
        maxSummaryScopes:MEMORY_LIMITS.maxSummaryScopes,
        maxSummaryEvidenceRefs:MEMORY_LIMITS.maxSummaryEvidenceRefs,
        maxSummarySourceRevisionRefs:MEMORY_LIMITS.maxSummarySourceRevisionRefs,
        maxSummaryCharacters:MEMORY_LIMITS.maxSummaryCharacters,
        maxSummaryWorkUnits:MEMORY_LIMITS.maxSummaryWorkUnits,
        maxSummaryDrillbackRows:MEMORY_LIMITS.maxSummaryDrillbackRows,
      },
      providerRequired:false,
      embeddingRequired:false,
      externalDatabaseRequired:false,
      runtimeSchedulingAuthority:false,
      contextSealAuthority:false,
      diagnostics:deepClone(this.diagnostics).slice(-MEMORY_LIMITS.maxDiagnostics),
    };
  }

  snapshot() {
    return {
      kind:'MemorySummaryHierarchySnapshot',
      scopes:[...this.scopes.values()].map(deepClone),
      artifacts:[...this.artifacts.values()].map(deepClone),
      historyByScope:[...this.historyByScope.entries()].map(([key,value])=>[key,[...value]]),
      currentByScope:[...this.currentByScope.entries()],
      workQueue:deepClone(this.workQueue),
      definitionSequence:this.definitionSequence,
      artifactSequence:this.artifactSequence,
      workSequence:this.workSequence,
      diagnostics:deepClone(this.diagnostics),
      costCounters:deepClone(this.costCounters),
    };
  }

  restore(snapshot) {
    this.scopes=new Map((snapshot?.scopes??[]).map((row)=>[row.scopeRef,deepClone(row)]));
    this.artifacts=new Map((snapshot?.artifacts??[]).map((row)=>[row.id,deepClone(row)]));
    this.historyByScope=new Map((snapshot?.historyByScope??[]).map(([key,value])=>[key,[...value]]));
    this.currentByScope=new Map(snapshot?.currentByScope??[]);
    this.workQueue=deepClone(snapshot?.workQueue??[]);
    this.definitionSequence=Number(snapshot?.definitionSequence??0);
    this.artifactSequence=Number(snapshot?.artifactSequence??0);
    this.workSequence=Number(snapshot?.workSequence??0);
    this.diagnostics=deepClone(snapshot?.diagnostics??[]).slice(-MEMORY_LIMITS.maxDiagnostics);
    this.costCounters={
      compileWorkUnits:0,
      compileEvidenceExamined:0,
      compileChildArtifactsRead:0,
      historianQueries:0,
      historianSummaryArtifactsExamined:0,
      historianBaseQueriesAvoided:0,
      historianBaseQueriesUsed:0,
      ...(snapshot?.costCounters??{}),
    };
  }
}
