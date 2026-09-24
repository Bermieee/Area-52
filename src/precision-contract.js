import { PrecisionFreshness,createPrecisionResult } from './publication-contracts.js';

const WORDS=/[a-z0-9]+/g;
const words=(text)=>new Set(String(text).toLowerCase().match(WORDS)??[]);
const OPPOSITES=[
  ['kill','heal'],['enter','leave'],['trust','distrust'],['intact','destroyed'],
  ['present','departed'],['current','historical'],
];

function textFor(candidate,graph){
  if(typeof candidate.text==='string')return candidate.text;
  const claimId=candidate.claimIds?.[0];
  const claim=claimId&&graph?graph.getClaim(claimId):null;
  if(claim)return`${claim.subjectId} ${claim.predicate} ${claim.value} ${claim.status} ${claim.claimType??''}`;
  return`${candidate.sourceId??''} ${candidate.temporalStatus??''}`;
}

function scoreCandidate(query,candidate,{graph,intent}){
  const q=words(query),c=words(textFor(candidate,graph));
  let score=0;
  for(const token of q)if(c.has(token))score+=1;

  for(const[a,b]of OPPOSITES){
    if(q.has(a)&&c.has(a))score+=3;
    if(q.has(b)&&c.has(b))score+=3;
    if(q.has(a)&&c.has(b))score-=4;
    if(q.has(b)&&c.has(a))score-=4;
  }

  const status=String(candidate.temporalStatus??'');
  if(intent==='CURRENT'){
    if(status==='CURRENT')score+=2.5;
    if(['HISTORICAL','SUPERSEDED'].includes(status))score-=1;
    if(['CONTRADICTED','UNRESOLVED','UNCERTAIN'].includes(status))score+=1.25;
  }else if(intent==='HISTORICAL'||intent==='TEMPORAL'){
    if(['HISTORICAL','SUPERSEDED'].includes(status))score+=2;
  }else if(intent==='CONTRADICTION'){
    if(['CONTRADICTED','UNRESOLVED','UNCERTAIN'].includes(status))score+=3;
  }

  const signals=candidate.scoreSignals??{};
  score+=(signals.sparse??0)*.25+(signals.dense??0)*.2+(signals.graphDistance?0.3:0)+(signals.temporal??0)*.25+(signals.conflict??0)*.35;
  return Number(score.toFixed(6));
}

export class DeterministicPrecisionStub {
  constructor({graph=null,profileId='deterministic-intent-reference',profileRevision='1'}={}){
    this.graph=graph;this.profileId=profileId;this.profileRevision=profileRevision;
  }

  rank(candidates,{
    query,intent='CURRENT',worldRevision=0,sceneRevision=0,
    inputWorldRevision=worldRevision,inputSceneRevision=sceneRevision,runtimeProfile='REFERENCE',
  }={}){
    const scored=candidates.map(candidate=>({candidate,rawScore:scoreCandidate(query,candidate,{graph:this.graph,intent})}));
    scored.sort((a,b)=>b.rawScore-a.rawScore||a.candidate.candidateId.localeCompare(b.candidate.candidateId));
    const max=scored.length?Math.max(...scored.map(x=>x.rawScore)):0;
    const min=scored.length?Math.min(...scored.map(x=>x.rawScore)):0;
    const span=max-min||1;
    const freshness=inputWorldRevision===worldRevision&&inputSceneRevision===sceneRevision?PrecisionFreshness.FRESH:PrecisionFreshness.STALE;

    return scored.map((row,index)=>createPrecisionResult({
      candidateId:row.candidate.candidateId,rawScore:row.rawScore,
      normalizedScore:scored.length===1?1:Number(((row.rawScore-min)/span).toFixed(6)),
      finalRank:index+1,modelProfileId:this.profileId,modelProfileRevision:this.profileRevision,
      runtimeProfile,latencyMs:0,truncation:{applied:false},freshness,
      sourceRevisionIds:[...new Set(row.candidate.provenance?.sourceRevisionIds??[])].sort(),
      worldRevision:inputWorldRevision,sceneRevision:inputSceneRevision,
    }));
  }
}

export function rankIntentOpposites(query,texts,{intent='CURRENT'}={}){
  const stub=new DeterministicPrecisionStub();
  const candidates=texts.map((text,index)=>({
    candidateId:`fixture:${index+1}`,text,claimIds:[],sourceId:`fixture:${index+1}`,
    temporalStatus:/historical/i.test(text)?'HISTORICAL':'CURRENT',scoreSignals:{},
  }));
  return stub.rank(candidates,{query,intent}).map((result)=>({
    ...result,text:candidates.find(c=>c.candidateId===result.candidateId).text,
  }));
}
