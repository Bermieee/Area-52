import {AuthorityClass,KnowledgeStatus,createArtifactReference,createCandidateNomination,deepClone,stableHash,stableStringify,uniqStrings,unitNumber} from './memory-contracts.js';

export const MEMORY_CAUSAL_EVENT_VERSION='1.0.0';
const TOKEN_RE=/[a-z0-9][a-z0-9'-]{1,}/g;
const STOP=new Set(['the','a','an','and','or','of','to','in','on','at','for','with','is','was','were','be','been','about','tell','me','what','who','where','when','how','did','does','do','why']);
const tokens=v=>[...new Set((String(v??'').toLowerCase().match(TOKEN_RE)??[]).filter(t=>!STOP.has(t)))];
const overlap=(a,b)=>{const s=new Set(b);return a.length?a.filter(x=>s.has(x)).length/a.length:0;};

export class MemoryCausalEventStore{
  constructor({graph,snapshot=null,maxEvents=2048,maxHypotheses=2048}={}){
    if(!graph)throw new TypeError('MemoryCausalEventStore requires graph');
    this.graph=graph;this.maxEvents=maxEvents;this.maxHypotheses=maxHypotheses;
    this.events=new Map();this.eventHistory=new Map();this.currentEvent=new Map();
    this.hypotheses=new Map();this.hypothesisHistory=new Map();this.currentHypothesis=new Map();this.sequence=0;
    if(snapshot)this.restore(snapshot);
  }
  recordEvent({eventId,description,evidenceRefs=[],sourceRevisionRefs=[],entityRefs=[],occurredAt=null,temporalOrderRefs=[],perspective={scope:'WORLD'},provenance=[]}={}){
    const logical=String(eventId??'').trim();if(!logical)throw new TypeError('eventId required');
    const evidence=uniqStrings(evidenceRefs,128);if(!evidence.length)throw new TypeError('event evidenceRefs required');
    for(const id of evidence)if(!this.graph.evidenceRecord(id))throw new Error('MEMORY_EVENT_EVIDENCE_UNKNOWN:'+id);
    const sources=uniqStrings([...sourceRevisionRefs,...evidence.map(id=>this.graph.evidenceRecord(id)?.sourceRevisionId).filter(Boolean)],64);
    const history=this.eventHistory.get(logical)??[],revision=history.length+1;
    const fingerprint=stableHash(stableStringify({logical,description,evidence,sources,entityRefs,occurredAt,temporalOrderRefs,perspective}));
    const priorId=this.currentEvent.get(logical),prior=priorId?this.events.get(priorId):null;if(prior?.fingerprint===fingerprint)return deepClone(prior);
    const id='memory-event:'+stableHash(logical+'|'+revision+'|'+fingerprint);if(prior){prior.state='HISTORICAL';prior.freshness='STALE';prior.replacedBy=id;}
    const row={kind:'MemoryEvent',artifactType:'EVENT_MEMORY',id,eventId:logical,revision,description:String(description??'').trim(),evidenceRefs:evidence,sourceRevisionRefs:sources,
      entityRefs:uniqStrings(entityRefs,64),occurredAt,temporalOrderRefs:deepClone((temporalOrderRefs??[]).slice(0,64)).map(x=>({relation:['PRECEDES','FOLLOWS','OVERLAPS'].includes(String(x?.relation).toUpperCase())?String(x.relation).toUpperCase():'PRECEDES',eventRef:String(x?.eventRef??'')})).filter(x=>x.eventRef),
      perspective:deepClone(perspective),provenance:deepClone(provenance).slice(0,64),authorityClass:AuthorityClass.OBSERVED,truthStatusHint:KnowledgeStatus.HISTORICAL,
      state:'CURRENT',freshness:sources.every(x=>this.graph.isSourceRevisionActive(x))?'FRESH':'STALE',createdSequence:++this.sequence,fingerprint,causalClaim:false,
      canonicalMutationAuthority:false,settlementAuthority:false};
    this.events.set(id,row);this.eventHistory.set(logical,[...history,id]);this.currentEvent.set(logical,id);this.#trim();return deepClone(row);
  }
  recordHypothesis({hypothesisId,hypothesisSetId,causeEventRefs=[],effectEventRef,statement,evidenceRefs=[],supportEvidenceRefs=[],contradictionEvidenceRefs=[],sourceRevisionRefs=[],entityRefs=[],confidence=.5,perspective={scope:'WORLD'},provenance=[]}={}){
    const logical=String(hypothesisId??'').trim(),setId=String(hypothesisSetId??'').trim(),effect=String(effectEventRef??'').trim();
    if(!logical||!setId||!effect||!String(statement??'').trim())throw new TypeError('hypothesisId, hypothesisSetId, effectEventRef and statement required');
    const support=uniqStrings([...(supportEvidenceRefs??[]),...(evidenceRefs??[])],128),contradictions=uniqStrings(contradictionEvidenceRefs,128);
    for(const id of [...support,...contradictions])if(!this.graph.evidenceRecord(id))throw new Error('MEMORY_HYPOTHESIS_EVIDENCE_UNKNOWN:'+id);
    const sources=uniqStrings([...sourceRevisionRefs,...[...support,...contradictions].map(id=>this.graph.evidenceRecord(id)?.sourceRevisionId).filter(Boolean)],64);
    const history=this.hypothesisHistory.get(logical)??[],revision=history.length+1;
    const fingerprint=stableHash(stableStringify({logical,setId,causeEventRefs,effect,statement,support,contradictions,sources,entityRefs,confidence,perspective}));
    const priorId=this.currentHypothesis.get(logical),prior=priorId?this.hypotheses.get(priorId):null;if(prior?.fingerprint===fingerprint)return deepClone(prior);
    const id='memory-hypothesis:'+stableHash(logical+'|'+revision+'|'+fingerprint);if(prior){prior.state='HISTORICAL';prior.freshness='STALE';prior.replacedBy=id;}
    const row={kind:'MemoryCausalHypothesis',artifactType:'CAUSAL_HYPOTHESIS',id,hypothesisId:logical,hypothesisSetId:setId,revision,causeEventRefs:uniqStrings(causeEventRefs,64),effectEventRef:effect,
      statement:String(statement).trim(),supportEvidenceRefs:support,contradictionEvidenceRefs:contradictions,evidenceRefs:uniqStrings([...support,...contradictions],128),sourceRevisionRefs:sources,
      entityRefs:uniqStrings(entityRefs,64),confidence:unitNumber(confidence,'hypothesis.confidence'),perspective:deepClone(perspective),provenance:deepClone(provenance).slice(0,64),
      authorityClass:AuthorityClass.UNRESOLVED,truthStatusHint:KnowledgeStatus.UNRESOLVED,status:'UNRESOLVED',state:'CURRENT',
      freshness:sources.every(x=>this.graph.isSourceRevisionActive(x))?'FRESH':'STALE',createdSequence:++this.sequence,fingerprint,confidenceGrantsCanon:false,repetitionGrantsCanon:false,
      canonicalMutationAuthority:false,settlementAuthority:false};
    this.hypotheses.set(id,row);this.hypothesisHistory.set(logical,[...history,id]);this.currentHypothesis.set(logical,id);this.#trim();return deepClone(row);
  }
  query({query='',mode='CONTINUITY_RECALL',retrievalIntentId=null,selection={},maxCandidates=16}={}){
    const q=tokens(query),ranked=[],chat=String(selection?.chatId??'').trim();
    const inChat=refs=>!chat||refs.every(id=>String(this.graph.evidenceRecord(id)?.metadata?.chatId??'')===chat);
    for(const row of this.events.values()){
      if(row.state!=='CURRENT'||row.freshness!=='FRESH'||!inChat(row.evidenceRefs))continue;
      const score=overlap(q,tokens([row.description,...row.entityRefs,row.eventId].join(' ')));if(!score&&mode!=='EVENT_CAUSAL_RECALL')continue;ranked.push({row,score:Math.max(score,mode==='EVENT_CAUSAL_RECALL'?.18:0),channel:'CAUSAL_EVENT'});
    }
    for(const row of this.hypotheses.values()){
      if(row.state!=='CURRENT'||row.freshness!=='FRESH'||!inChat(row.evidenceRefs))continue;
      const score=overlap(q,tokens([row.statement,...row.entityRefs,...row.causeEventRefs,row.effectEventRef].join(' ')));if(!score&&mode!=='EVENT_CAUSAL_RECALL')continue;ranked.push({row,score:Math.max(score,mode==='EVENT_CAUSAL_RECALL'?.16:0),channel:'UNRESOLVED_HYPOTHESIS'});
    }
    ranked.sort((a,b)=>b.score-a.score||b.row.createdSequence-a.row.createdSequence);
    const intentId=retrievalIntentId??('memory-causal-intent:'+stableHash(String(mode)+'|'+String(query).toLowerCase()));
    const nominations=ranked.slice(0,Math.max(1,Math.min(32,Number(maxCandidates)||16))).map(({row,score,channel})=>{
      const hypothesis=channel==='UNRESOLVED_HYPOTHESIS';
      return createCandidateNomination({
        nominationId:'memory-causal-nomination:'+stableHash(intentId+'|'+row.id),candidateId:'memory-causal-candidate:'+stableHash(row.id),
        evidenceIdentity:(hypothesis?'hypothesis:':'event:')+stableHash(row.id),
        artifactRef:createArtifactReference({artifactId:row.id,artifactType:row.artifactType,owner:'MEMORY',revision:row.revision,sourceRevisionSet:row.sourceRevisionRefs,provenanceRef:'memory-causal:'+row.id}),
        artifactRevision:row.revision,sourceRevisionRefs:row.sourceRevisionRefs,eventRefs:hypothesis?[...row.causeEventRefs,row.effectEventRef]:[row.eventId],
        entityRefs:row.entityRefs,retrievalIntentIds:[intentId],rankSignals:{intentMatch:score,entityOverlap:0,temporalFit:1,significance:hypothesis?row.confidence:.6,recency:1,perspectiveCompatibility:1},
        normalizedRank:Math.max(0,Math.min(1,score)),authorityClass:hypothesis?AuthorityClass.UNRESOLVED:AuthorityClass.OBSERVED,
        truthStatusHint:hypothesis?KnowledgeStatus.UNRESOLVED:KnowledgeStatus.HISTORICAL,provenance:row.provenance,evidenceRefs:row.evidenceRefs,dependencyRevisions:[...row.sourceRevisionRefs,row.id],
        representationRef:'memory-causal-record:'+row.id,representationRevision:row.revision,representationText:hypothesis?row.statement:row.description,
        metadata:{historianChannel:channel,causalMemory:true,perspective:deepClone(row.perspective),hypothesisSetId:hypothesis?row.hypothesisSetId:null,temporalOrderRefs:hypothesis?[]:deepClone(row.temporalOrderRefs),
          confidenceGrantsCanon:false,repetitionGrantsCanon:false,exactSourceDrillback:true,settlementAuthority:false,contextSealAuthority:false},
      });
    });
    return{kind:'MemoryCausalQueryResult',contractVersion:MEMORY_CAUSAL_EVENT_VERSION,status:'OK',nominations,diagnostics:{examined:ranked.length,returned:nominations.length},authorityGranted:false,settlementAuthority:false};
  }
  drillDown(nominationOrRef){
    const ref=typeof nominationOrRef==='string'?nominationOrRef:nominationOrRef?.representationRef??nominationOrRef?.metadata?.retrievalRecordRef;
    const id=String(ref??'').replace(/^memory-causal-record:/,''),row=this.events.get(id)??this.hypotheses.get(id);if(!row)return[];
    return row.evidenceRefs.map(eid=>this.graph.exactEvidence(eid)).filter(Boolean);
  }
  invalidateSourceRevision(sourceRevisionId){
    const source=String(sourceRevisionId),affectedEvents=[],affectedHypotheses=[];
    for(const row of this.events.values())if(row.state==='CURRENT'&&row.sourceRevisionRefs.includes(source)){row.freshness='STALE';affectedEvents.push(row.id);}
    for(const row of this.hypotheses.values())if(row.state==='CURRENT'&&row.sourceRevisionRefs.includes(source)){row.freshness='STALE';affectedHypotheses.push(row.id);}
    return{kind:'MemoryCausalInvalidationReceipt',sourceRevisionId:source,affectedEvents,affectedHypotheses,unrelatedMutation:false,historicalVersionsPreserved:true};
  }
  status(){return{kind:'MemoryCausalEventStatus',eventCount:this.events.size,hypothesisCount:this.hypotheses.size,activeEvents:[...this.events.values()].filter(x=>x.state==='CURRENT'&&x.freshness==='FRESH').length,
    activeHypotheses:[...this.hypotheses.values()].filter(x=>x.state==='CURRENT'&&x.freshness==='FRESH').length,revision:this.revisionRef()};}
  revisionRef(){return'memory-causal:'+stableHash(stableStringify({events:[...this.events.values()].map(x=>[x.id,x.revision,x.freshness]),hypotheses:[...this.hypotheses.values()].map(x=>[x.id,x.revision,x.freshness])}));}
  snapshot(){return{kind:'MemoryCausalEventSnapshot',contractVersion:MEMORY_CAUSAL_EVENT_VERSION,events:[...this.events.entries()].map(([k,v])=>[k,deepClone(v)]),eventHistory:[...this.eventHistory.entries()],currentEvent:[...this.currentEvent.entries()],
    hypotheses:[...this.hypotheses.entries()].map(([k,v])=>[k,deepClone(v)]),hypothesisHistory:[...this.hypothesisHistory.entries()],currentHypothesis:[...this.currentHypothesis.entries()],sequence:this.sequence};}
  restore(s){this.events=new Map((s?.events??[]).map(([k,v])=>[k,deepClone(v)]));this.eventHistory=new Map(s?.eventHistory??[]);this.currentEvent=new Map(s?.currentEvent??[]);
    this.hypotheses=new Map((s?.hypotheses??[]).map(([k,v])=>[k,deepClone(v)]));this.hypothesisHistory=new Map(s?.hypothesisHistory??[]);this.currentHypothesis=new Map(s?.currentHypothesis??[]);this.sequence=Number(s?.sequence??0);}
  #trim(){while(this.events.size>this.maxEvents){const [id,row]=this.events.entries().next().value;if(row.state==='CURRENT')break;this.events.delete(id);}while(this.hypotheses.size>this.maxHypotheses){const [id,row]=this.hypotheses.entries().next().value;if(row.state==='CURRENT')break;this.hypotheses.delete(id);}}
}
