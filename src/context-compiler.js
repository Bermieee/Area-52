import { KnowledgeStatus, createCompiledContextPacket } from './contracts.js';
import { stableHash } from './browser-runtime-utils.js';
import {normalizeActiveThreads,buildSemanticPriority,computeSemanticSizing,defaultRepresentationEligibility,semanticPriorityForFact} from './context-compiler-contracts.js';

const sectionFor=(classification)=>classification===KnowledgeStatus.CURRENT?'current':[KnowledgeStatus.HISTORICAL,KnowledgeStatus.SUPERSEDED].includes(classification)?'historical':'unresolved';
const factKey=(claim,section)=>`${section}|${claim.subjectId}|${claim.predicate}|${JSON.stringify(claim.value)}`;
const hash=(value)=>stableHash(String(value),{length:16,alreadyString:true});
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();

function boundedEvidenceText(value,limit=12000){
  const text=String(value??''),cap=Math.max(1,Number(limit)||12000);
  if(text.length<=cap)return{text,coverage:{complete:true,policy:'FULL',sourceCharacters:text.length,includedCharacters:text.length,omittedCharacters:0}};
  const marker='\n…[bounded evidence excerpt; source drillback retained]…\n',usable=Math.max(1,cap-marker.length),head=Math.ceil(usable/2),tail=Math.max(0,usable-head);
  const bounded=(text.slice(0,head)+marker+text.slice(Math.max(head,text.length-tail))).slice(0,cap);
  return{text:bounded,coverage:{complete:false,policy:'HEAD_TAIL_WITH_SOURCE_DRILLBACK',sourceCharacters:text.length,includedCharacters:Math.min(text.length,head+tail),omittedCharacters:Math.max(0,text.length-head-tail),headCharacters:head,tailCharacters:tail}};
}
function externalRow(evidence){
  const semantic=evidence.semantic??null,bounded=boundedEvidenceText(evidence.representationText??evidence.extensions?.representationText??'');
  return {
    id:'context-evidence:'+evidence.evidenceId,
    evidenceId:evidence.evidenceId,
    sourceClass:evidence.sourceClass,
    a:evidence.authorityClass,
    temporalStatus:evidence.temporalStatus,
    cf:evidence.confidence,
    text:bounded.text,
    textCoverage:bounded.coverage,
    semantic:semantic?structuredClone(semantic):null,
    hardRule:Boolean(evidence.hardRule),
    artifactRef:structuredClone(evidence.artifactRef),
    sourceRevisionRefs:uniq(evidence.sourceRevisionRefs??[]),
    dependencyRevisionRefs:uniq(evidence.dependencyRevisionRefs??[]),
    provenanceRefs:uniq(evidence.provenanceRefs??[]),
  };
}

// Deterministic rank of admitted external evidence (row 34): stable sort, admission order breaks ties.
function rankExternal(rows){
  const num=(v)=>Number.isFinite(Number(v))&&v!==null&&v!==''?Number(v):null;
  const keyOf=(x,index)=>{const m=x.retrievalMetadata??{},p=m.precision??{};
    return{hard:x.hardRule?1:0,finalRank:num(p.finalRank),score:num(p.score)??num(m.fusionScore),inputRank:num(m.inputRank),index};};
  return rows.map((x,index)=>({x,k:keyOf(x,index)})).sort((a,b)=>{
    if(a.k.hard!==b.k.hard)return b.k.hard-a.k.hard;
    if(a.k.finalRank!==null&&b.k.finalRank!==null&&a.k.finalRank!==b.k.finalRank)return a.k.finalRank-b.k.finalRank;
    if(a.k.finalRank!==null&&b.k.finalRank===null)return -1;if(a.k.finalRank===null&&b.k.finalRank!==null)return 1;
    if(a.k.score!==null&&b.k.score!==null&&a.k.score!==b.k.score)return b.k.score-a.k.score;
    if(a.k.inputRank!==null&&b.k.inputRank!==null&&a.k.inputRank!==b.k.inputRank)return a.k.inputRank-b.k.inputRank;
    return a.k.index-b.k.index;
  }).map((row)=>row.x);
}

export class ContextCompiler {
  constructor({graph,maxFactsPerSection=12,isCurrentRevision=()=>true}){this.graph=graph;this.maxFactsPerSection=maxFactsPerSection;this.isCurrentRevision=isCurrentRevision;}
  compile(input){return this.compileDetailed(input).packet;}
  compileDetailed({query,intent,truthResults,activeThreads=[],knowledgeEvidence=[]}){
    const threadState=normalizeActiveThreads(activeThreads,{isCurrentRevision:this.isCurrentRevision}),threads=threadState.admitted;
    const evidenceByClaim=new Map(),evidenceById=new Map();
    for(const evidence of knowledgeEvidence??[]){
      if(evidence?.evidenceId)evidenceById.set(evidence.evidenceId,evidence);
      for(const claimId of evidence?.claimIds??[]){const rows=evidenceByClaim.get(claimId)??[];rows.push(evidence);evidenceByClaim.set(claimId,rows);}
    }
    const buckets={current:new Map(),historical:new Map(),unresolved:new Map()},provenanceIndex={},knowledgeTraceIndex={},dependencies=new Set();
    for(const result of truthResults){
      if(!result.usableForIntent)continue;
      for(const claimId of result.claimIds){
        const claim=this.graph.getClaim(claimId);if(!claim)continue;
        const section=sectionFor(result.classification),key=factKey(claim,section);let fact=buckets[section].get(key);
        if(!fact){fact={e:claim.subjectId,p:claim.predicate,v:claim.value,a:claim.authorityClass,cf:claim.confidence,id:claim.id,_supportIds:[],_from:claim.temporal?.validFrom??null,_to:claim.temporal?.validUntil??null,_status:result.classification,_knowledge:[]};buckets[section].set(key,fact);}
        fact._supportIds.push(claim.id);fact.cf=Math.max(fact.cf,claim.confidence);if(fact._from===null||Number(claim.temporal?.validFrom??0)<Number(fact._from))fact._from=claim.temporal?.validFrom??fact._from;
        const refs=claim.provenance?.sourceRevisionIds??[],knowledge=evidenceByClaim.get(claim.id)??[];fact._knowledge.push(...knowledge);
        const knowledgeRefs=knowledge.flatMap(x=>x?.sourceRevisionRefs??[]),existing=provenanceIndex[fact.id]??[];
        provenanceIndex[fact.id]=uniq([...existing,...refs,...knowledgeRefs]);for(const ref of [...refs,...knowledgeRefs])dependencies.add(ref);
      }
    }

    const admittedExternal=[];
    for(const result of truthResults){
      if(!result.usableForIntent||!result.knowledgeEvidenceId)continue;
      const evidence=evidenceById.get(result.knowledgeEvidenceId);if(!evidence)continue;
      admittedExternal.push(evidence);
      const refs=uniq([...(evidence.sourceRevisionRefs??[]),...(evidence.dependencyRevisionRefs??[])]);
      for(const ref of refs)dependencies.add(ref);
      const semantic=evidence.semantic;
      if(semantic?.subjectId&&semantic?.predicate&&Object.hasOwn(semantic,'value')){
        const classification=result.classification??evidence.temporalStatus??KnowledgeStatus.UNRESOLVED;
        const section=sectionFor(classification),synthetic={
          subjectId:String(semantic.subjectId),predicate:String(semantic.predicate),value:structuredClone(semantic.value),
          authorityClass:evidence.authorityClass,confidence:Number(evidence.confidence??1),
          id:'knowledge-fact:'+evidence.evidenceId,
          temporal:{validFrom:evidence.extensions?.originWorldRevision??null,validUntil:null},
        },key=factKey(synthetic,section);
        if(!buckets[section].has(key))buckets[section].set(key,{e:synthetic.subjectId,p:synthetic.predicate,v:synthetic.value,a:synthetic.authorityClass,cf:synthetic.confidence,id:synthetic.id,_supportIds:[],_from:synthetic.temporal.validFrom,_to:null,_status:classification,_knowledge:[evidence]});
        provenanceIndex[synthetic.id]=refs;
      }
    }

    for(const thread of threads){provenanceIndex[thread.id]=[...thread.sourceRevisionIds];for(const ref of thread.sourceRevisionIds)dependencies.add(ref);}
    const finalize=(map,section)=>{
      const ranked=[...map.values()].map(f=>{
      const out={e:f.e,p:f.p,v:f.v,a:f.a,cf:f.cf,id:f.id};const sourceRefs=uniq(provenanceIndex[f.id]??[]);if(sourceRefs.length)out.sr=sourceRefs;const support=uniq(f._supportIds);if(support.length>1)out.supportIds=support;if(section!=='current')out.t=[f._from,f._to,f._status];
      const knowledge=[...new Map((f._knowledge??[]).map(x=>[x.evidenceId,x])).values()];
      if(knowledge.length){
        out.q=knowledge.map(x=>({evidenceId:x.evidenceId,sourceClass:x.sourceClass,authorityClass:x.authorityClass,temporalStatus:x.temporalStatus,currentApplicability:x.currentApplicability??null,hardRule:Boolean(x.hardRule)}));
        knowledgeTraceIndex[f.id]=knowledge.map(x=>({evidenceId:x.evidenceId,artifactRef:structuredClone(x.artifactRef),sourceRevisionRefs:[...(x.sourceRevisionRefs??[])],dependencyRevisionRefs:[...(x.dependencyRevisionRefs??[])],provenanceRefs:[...(x.provenanceRefs??[])],retrievalChannels:[...(x.candidateLineage?.nominationChannels??[])],precisionReasons:[...(x.retrievalMetadata?.precision?.reasonCodes??[])],contradictionSetId:x.contradictionSetId??null,hypothesisSetId:x.hypothesisSetId??null}));
      }return out;
    }).sort((a,b)=>{const pa=semanticPriorityForFact(a,section,threads).score,pb=semanticPriorityForFact(b,section,threads).score;return pb-pa||a.e.localeCompare(b.e)||a.p.localeCompare(b.p)||String(a.v).localeCompare(String(b.v));}).slice(0,this.maxFactsPerSection);

    const currentPick=finalize(buckets.current,'current'),historicalPick=finalize(buckets.historical,'historical'),unresolvedPick=finalize(buckets.unresolved,'unresolved');
    const current=currentPick.rows,historical=historicalPick.rows,unresolvedRows=unresolvedPick.rows;
    const exactExternal=[...new Map(admittedExternal.map(x=>[x.evidenceId,x])).values()];
    // Cap ledger row 34: when a section has more rows than its budget, it keeps the best-ranked ones, not the first ones
    // admitted. Rank comes from signals the evidence already carries (hard rule, precision rank, score, input rank);
    // admission order breaks ties. Kept rows stay in admission order, so a section within its budget is unchanged.
    // What is left out is counted (metadata.externalKnowledge), not silently dropped.
    const pick=(rows)=>{
      if(rows.length<=this.maxFactsPerSection)return{rows:rows.map(externalRow),boundedOut:0};
      const keep=new Set(rankExternal(rows).slice(0,this.maxFactsPerSection));
      return{rows:rows.filter((x)=>keep.has(x)).map(externalRow),boundedOut:rows.length-keep.size};
    };
    const lorePick=pick(exactExternal.filter(x=>['SOURCE_LORE','DERIVED_REPRESENTATION'].includes(x.sourceClass)));
    const memoryPick=pick(exactExternal.filter(x=>!['SOURCE_LORE','DERIVED_REPRESENTATION','TEMPORAL_STATE'].includes(x.sourceClass)));
    const relevantLore=lorePick.rows,episodicMemory=memoryPick.rows;
    for(const row of [...relevantLore,...episodicMemory]){
      const evidence=evidenceById.get(row.evidenceId),refs=uniq([...(evidence?.sourceRevisionRefs??[]),...(evidence?.dependencyRevisionRefs??[])]);
      provenanceIndex[row.id]=refs;
    }

    const keptIds=new Set([...current,...historical,...unresolvedRows,...threads,...relevantLore,...episodicMemory].map(f=>f.id));
    for(const id of Object.keys(provenanceIndex))if(!keptIds.has(id))delete provenanceIndex[id];
    const dependenciesList=[...dependencies].sort(),idMaterial=[...current,...historical,...unresolvedRows,...relevantLore,...episodicMemory].map(f=>f.id);if(threads.length)idMaterial.push(...threads.map(t=>t.id));
    const packet=createCompiledContextPacket({id:`packet:${intent.toLowerCase()}:${hash(idMaterial.sort().join('|')||'empty')}`,query,intent,current,historical,unresolved:unresolvedRows,activeThreads:threads,provenanceIndex,dependencies:dependenciesList});
    if(relevantLore.length)packet.relevantLore=relevantLore;
    if(episodicMemory.length)packet.episodicMemory=episodicMemory;
    if(Object.keys(knowledgeTraceIndex).length)packet.knowledgeTraceIndex=knowledgeTraceIndex;
    const semanticSizing=computeSemanticSizing({current,historical,unresolved:unresolvedRows,activeThreads:threads,provenanceIndex,dependencies:dependenciesList});
    const metadata={kind:'ContextCompilerMetadata',semanticPriority:buildSemanticPriority({current,historical,unresolved:unresolvedRows,activeThreads:threads}),semanticSizing,representationEligibility:defaultRepresentationEligibility(),threadDiagnostics:{admittedThreadIds:threads.map(t=>t.threadId),staleThreadIds:threadState.staleThreadIds},claimCoverage:{current:{total:currentPick.total,included:current.length,boundedOut:currentPick.boundedOut},historical:{total:historicalPick.total,included:historical.length,boundedOut:historicalPick.boundedOut},unresolved:{total:unresolvedPick.total,included:unresolvedRows.length,boundedOut:unresolvedPick.boundedOut},policy:'SEMANTIC_PRIORITY_RANK'},externalKnowledge:{admitted:exactExternal.length,relevantLore:relevantLore.length,episodicMemory:episodicMemory.length,loreBoundedOut:lorePick.boundedOut,memoryBoundedOut:memoryPick.boundedOut,ranking:'HARD_RULE>PRECISION_RANK>SCORE>INPUT_RANK>ADMISSION'}};
    return{packet,metadata};
  }
}
