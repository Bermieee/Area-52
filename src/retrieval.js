import { KnowledgeStatus, createCandidateBusResult } from './contracts.js';
const TOKENS=/[a-z0-9]+/g;
const STOP=new Set(['the','a','an','is','by','at','in','can','did','what','where','before','after','to','of','now','it']);
const tokenize=(text)=>new Set((String(text).toLowerCase().match(TOKENS)??[]).filter(x=>!STOP.has(x)));
const SYNONYMS=new Map([
 ['weapon',new Set(['blade','sword'])],['inn',new Set(['tavern'])],['carry',new Set(['carried','location'])],['carried',new Set(['location'])],['find',new Set(['location'])],['leave',new Set(['left','location'])],['left',new Set(['location'])],['survive',new Set(['survived','destroyed'])],['survived',new Set(['survive','destroyed'])],['happened',new Set(['state','location','memberOf'])],['joined',new Set(['memberOf'])],['member',new Set(['memberOf'])]
]);
function claimText(claim){return`${claim.subjectId} ${claim.predicate} ${claim.value} ${claim.status} ${claim.claimType??''}`;}
function lexicalScore(q,claim){const text=tokenize(claimText(claim));let score=0;for(const token of q)if(text.has(token))score+=1;return score;}
function semanticScore(q,claim){const text=tokenize(claimText(claim));let score=0;for(const token of q){const expanded=SYNONYMS.get(token);if(expanded&&[...expanded].some(word=>text.has(word)))score+=.75;}return score;}

export class MinimalRetrieval {
  constructor({graph}){this.graph=graph;}
  exact(query){const q=tokenize(query);return this.graph.allClaims().map(claim=>({claim,score:lexicalScore(q,claim)})).filter(x=>x.score>0);}
  semantic(query,scorer=null){const q=tokenize(query);return this.graph.allClaims().map(claim=>({claim,score:scorer?scorer(query,claim):semanticScore(q,claim)})).filter(x=>x.score>0);}
  graphNeighborhood(entityIds=[]){const out=[];for(const entityId of entityIds)for(const claim of this.graph.neighbors(entityId))out.push({claim,score:1});return out;}
  temporal(entityIds=[]){return this.graph.allClaims().filter(c=>entityIds.includes(c.subjectId)||entityIds.includes(c.value)).sort((a,b)=>Number(a.temporal?.validFrom??0)-Number(b.temporal?.validFrom??0)).map(claim=>({claim,score:1.1}));}
  conflicts(entityIds=[]){return this.graph.unresolvedClaims().filter(c=>!entityIds.length||entityIds.includes(c.subjectId)||entityIds.includes(c.value)).map(claim=>({claim,score:1.25}));}

  retrieve(query,{intent='CURRENT',anchorEntityIds=[]}={}){
    const channels=[['exact',this.exact(query)],['semantic',this.semantic(query)],['graph',this.graphNeighborhood(anchorEntityIds)]];
    if(['TEMPORAL','HISTORICAL'].includes(intent))channels.push(['temporal',this.temporal(anchorEntityIds)]);
    if(['CONTRADICTION','CURRENT','TEMPORAL'].includes(intent))channels.push(['conflict',this.conflicts(anchorEntityIds)]);
    const merged=new Map();
    for(const[channel,rows]of channels)for(const{claim,score}of rows){const existing=merged.get(claim.id)??{claim,scoreSignals:{sparse:0,dense:0,graphDistance:null,temporal:0,conflict:0},intents:new Set()};if(channel==='exact')existing.scoreSignals.sparse=Math.max(existing.scoreSignals.sparse,score);if(channel==='semantic')existing.scoreSignals.dense=Math.max(existing.scoreSignals.dense,score);if(channel==='graph')existing.scoreSignals.graphDistance=1;if(channel==='temporal')existing.scoreSignals.temporal=Math.max(existing.scoreSignals.temporal,score);if(channel==='conflict')existing.scoreSignals.conflict=Math.max(existing.scoreSignals.conflict,score);existing.intents.add(channel);merged.set(claim.id,existing);}
    return[...merged.values()].map(({claim,scoreSignals,intents})=>createCandidateBusResult({candidateId:`candidate:${claim.id}`,sourceType:'CLAIM',sourceId:claim.id,entityIds:[claim.subjectId,...(typeof claim.value==='string'?[claim.value]:[])],claimIds:[claim.id],scoreSignals,retrievalIntents:[intent,...[...intents].sort()],temporalStatus:claim.status??KnowledgeStatus.UNRESOLVED,provenance:claim.provenance})).sort((a,b)=>{const score=x=>(x.scoreSignals.sparse??0)+(x.scoreSignals.dense??0)+(x.scoreSignals.graphDistance?1:0)+(x.scoreSignals.temporal??0)+(x.scoreSignals.conflict??0);return score(b)-score(a)||a.candidateId.localeCompare(b.candidateId);});
  }
}
