import { KnowledgeStatus } from './contracts.js';
import { createCompilerReceipt } from './publication-contracts.js';
import { stableHash,utf8ByteLength } from './browser-runtime-utils.js';
import {buildSemanticPriority,computeSemanticSizing,semanticPriorityForFact} from './context-compiler-contracts.js';

const clone=(v)=>structuredClone(v);
const hash=(v)=>stableHash(String(v),{length:16,alreadyString:true});
const bytes=(v)=>utf8ByteLength(JSON.stringify(v));
const historical=new Set([KnowledgeStatus.HISTORICAL,KnowledgeStatus.SUPERSEDED]);
const unresolved=new Set([KnowledgeStatus.CONTRADICTED,KnowledgeStatus.UNCERTAIN,KnowledgeStatus.UNRESOLVED]);

function factFromClaim(claim,{status=claim.status,rich=false}={}){
  const fact={e:claim.subjectId,p:claim.predicate,v:claim.value,a:claim.authorityClass,cf:claim.confidence,id:claim.id};
  if(claim.temporal&&status!==KnowledgeStatus.CURRENT)fact.t=[claim.temporal.validFrom??null,claim.temporal.validUntil??null,status];
  if(rich){
    fact.status=status;
    fact.claimType=claim.claimType??'FACT';
    fact.semanticKey=claim.semanticKey??null;
    fact.validFrom=claim.temporal?.validFrom??null;
    fact.validUntil=claim.temporal?.validUntil??null;
  }
  return fact;
}

export class PublicationContextCompiler {
  constructor({graph,baseCompiler,maxFactsPerSection=12}){this.graph=graph;this.baseCompiler=baseCompiler;this.maxFactsPerSection=maxFactsPerSection;}

  compile({query,intent,truthAssessment,precisionResults=[],budgetBytes=2500,unknownSlots=[],rawEvidence=null,activeThreads=[]}){
    const base=this.baseCompiler.compile({query,intent,truthResults:truthAssessment.truthResults,activeThreads});
    const packet=clone(base);
    const rank=new Map(precisionResults.filter(x=>x.freshness==='FRESH').map(x=>[x.candidateId,x.finalRank]));
    const truthByCandidate=new Map(truthAssessment.truthResults.map(x=>[x.candidateId,x]));
    const provenanceIndex={...packet.provenanceIndex};
    const dependencies=new Set(packet.dependencies);

    for(const candidateId of truthAssessment.supportCandidateIds){
      const truth=truthByCandidate.get(candidateId);if(!truth||!historical.has(truth.classification))continue;
      for(const claimId of truth.claimIds){
        const claim=this.graph.getClaim(claimId);if(!claim)continue;
        const key=`${claim.subjectId}|${claim.predicate}|${JSON.stringify(claim.value)}`;
        let existing=packet.historical.find(f=>`${f.e}|${f.p}|${JSON.stringify(f.v)}`===key);
        if(!existing){existing=factFromClaim(claim,{status:truth.classification});packet.historical.push(existing);}
        const supports=[...new Set([existing.id,...(existing.supportIds??[]),claim.id])].sort();
        if(supports.length>1)existing.supportIds=supports;
        const refs=claim.provenance?.sourceRevisionIds??[];
        provenanceIndex[existing.id]=[...new Set([...(provenanceIndex[existing.id]??[]),...refs])].sort();
        refs.forEach(x=>dependencies.add(x));
      }
    }

    for(const unknown of unknownSlots){
      const supportClaims=[...new Set(unknown.supportClaimIds??[])].map(id=>this.graph.getClaim(id)).filter(Boolean);
      const id=`compiled-unknown:${hash(`${unknown.subjectId}|${unknown.predicate}|${supportClaims.map(c=>c.id).sort().join('|')}`)}`;
      if(packet.unresolved.some(f=>f.id===id))continue;
      const refs=[...new Set(supportClaims.flatMap(c=>c.provenance?.sourceRevisionIds??[]))].sort();
      packet.unresolved.push({e:unknown.subjectId,p:unknown.predicate,v:'unknown',a:'UNRESOLVED',cf:0,id,supportIds:supportClaims.map(c=>c.id).sort(),reason:unknown.reason??'no settled current value'});
      provenanceIndex[id]=refs;refs.forEach(x=>dependencies.add(x));
    }

    const candidateRankForFact=(fact)=>{const candidateIds=[`candidate:${fact.id}`,...(fact.supportIds??[]).map(id=>`candidate:${id}`)];return Math.min(...candidateIds.map(id=>rank.get(id)??Number.MAX_SAFE_INTEGER));};
    const sortRows=(rows,section)=>rows.sort((a,b)=>{
      const pa=semanticPriorityForFact(a,section,packet.activeThreads??[]).score,pb=semanticPriorityForFact(b,section,packet.activeThreads??[]).score;
      return pb-pa||candidateRankForFact(a)-candidateRankForFact(b)||a.e.localeCompare(b.e)||a.p.localeCompare(b.p)||String(a.v).localeCompare(String(b.v));
    });
    sortRows(packet.current,'current');sortRows(packet.historical,'historical');sortRows(packet.unresolved,'unresolved');
    packet.current=packet.current.slice(0,this.maxFactsPerSection);packet.historical=packet.historical.slice(0,this.maxFactsPerSection);packet.unresolved=packet.unresolved.slice(0,this.maxFactsPerSection);
    packet.provenanceIndex=provenanceIndex;packet.dependencies=[...dependencies].sort();
    packet.semanticPriority=buildSemanticPriority({current:packet.current,historical:packet.historical,unresolved:packet.unresolved,activeThreads:packet.activeThreads??[]});
    packet.semanticSizing=computeSemanticSizing(packet);
    const packetIdMaterial=[packet.current,packet.historical,packet.unresolved];if((packet.activeThreads??[]).length)packetIdMaterial.push(packet.activeThreads);
    packet.id=`packet:${intent.toLowerCase()}:pub:${hash(JSON.stringify(packetIdMaterial))}`;

    const requiredClaims=[...new Set([...truthAssessment.truthResults.filter(t=>t.usableForIntent).flatMap(t=>t.claimIds),...truthAssessment.supportCandidateIds.flatMap(id=>truthByCandidate.get(id)?.claimIds??[])])];
    const representedClaims=new Set([...packet.current,...packet.historical,...packet.unresolved].flatMap(f=>[f.id,...(f.supportIds??[])]));
    const factualRetention=requiredClaims.length?requiredClaims.filter(id=>representedClaims.has(id)).length/requiredClaims.length:1;
    const requiredUnresolved=truthAssessment.truthResults.filter(t=>unresolved.has(t.classification)).flatMap(t=>t.claimIds);
    const unresolvedRepresented=new Set(packet.unresolved.flatMap(f=>[f.id,...(f.supportIds??[])]));
    const contradictionRetention=requiredUnresolved.length?requiredUnresolved.filter(id=>unresolvedRepresented.has(id)).length/requiredUnresolved.length:1;
    const provenanceRetention=[...representedClaims].filter(id=>this.graph.getClaim(id)).every(id=>{const fact=[...packet.current,...packet.historical,...packet.unresolved].find(f=>f.id===id||(f.supportIds??[]).includes(id));return Boolean(fact&&(provenanceIndex[fact.id]??[]).length);})?1:0;
    const temporalClaims=requiredClaims.map(id=>this.graph.getClaim(id)).filter(c=>c&&c.temporal&&c.status!==KnowledgeStatus.CURRENT);
    const temporalFacts=[...packet.historical,...packet.unresolved];
    const temporalRetention=temporalClaims.length?temporalClaims.every(c=>temporalFacts.some(f=>f.id===c.id||(f.supportIds??[]).includes(c.id)))?1:0:1;
    const threadRetention=(packet.activeThreads??[]).length===base.activeThreads.length?1:0;

    const compactBytes=bytes(packet);
    const unsafe=factualRetention<1||temporalRetention<1||contradictionRetention<1||provenanceRetention<1||threadRetention<1;
    const budgetExceeded=budgetBytes!==null&&compactBytes>budgetBytes;
    let output=packet,representation='COMPACT',fallbackUsed=false,reason='compact semantic packet retained required cognition';

    if(unsafe||budgetExceeded){
      fallbackUsed=true;representation='RICH_FALLBACK';
      const richSections={current:[],historical:[],unresolved:[]};
      for(const truth of truthAssessment.truthResults){
        if(!truth.usableForIntent&&!truthAssessment.supportCandidateIds.includes(truth.candidateId))continue;
        for(const id of truth.claimIds){
          const claim=this.graph.getClaim(id);if(!claim)continue;
          const section=truth.classification===KnowledgeStatus.CURRENT?'current':historical.has(truth.classification)?'historical':'unresolved';
          richSections[section].push(factFromClaim(claim,{status:truth.classification,rich:true}));
        }
      }
      for(const unknown of unknownSlots)richSections.unresolved.push({e:unknown.subjectId,p:unknown.predicate,v:'unknown',a:'UNRESOLVED',cf:0,id:`compiled-unknown-rich:${hash(`${unknown.subjectId}|${unknown.predicate}`)}`,reason:unknown.reason??'no settled current value',supportIds:[...new Set(unknown.supportClaimIds??[])].sort()});
      sortRows(richSections.current,'current');sortRows(richSections.historical,'historical');sortRows(richSections.unresolved,'unresolved');
      const richIdMaterial=[richSections.current,richSections.historical,richSections.unresolved];if((packet.activeThreads??[]).length)richIdMaterial.push(packet.activeThreads);
      output={...packet,id:`packet:${intent.toLowerCase()}:rich:${hash(JSON.stringify(richIdMaterial))}`,representation,...richSections,provenanceIndex,dependencies:[...dependencies].sort()};
      output.semanticPriority=buildSemanticPriority({current:output.current,historical:output.historical,unresolved:output.unresolved,activeThreads:output.activeThreads??[]});output.semanticSizing=computeSemanticSizing(output);
      reason=unsafe?'compact representation failed retention checks; richer representation selected':'compact packet exceeded budget; correctness-preserving richer fallback selected rather than dropping required truth';
    }

    const receipt=createCompilerReceipt({id:`compiler-receipt:${output.id}`,packetId:output.id,representation,rawBytes:bytes(rawEvidence??truthAssessment.truthResults),compiledBytes:bytes(output),budgetBytes,budgetExceeded,fallbackUsed,factualRetention,temporalRetention,contradictionRetention,provenanceRetention,relationshipRetention:1,admittedClaimIds:requiredClaims.sort(),droppedClaimIds:requiredClaims.filter(id=>!representedClaims.has(id)).sort(),reason});
    return{packet:output,receipt};
  }
}
