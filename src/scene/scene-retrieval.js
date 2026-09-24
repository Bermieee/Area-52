import { RetrievalQuality, SceneRelationship } from './lifecycle-contracts.js';

const clone=(v)=>structuredClone(v);
const words=(s)=>new Set(String(s??'').toLowerCase().match(/[a-z0-9_'-]+/g)??[]);
const overlap=(a,b)=>{const aa=words(a),bb=words(b);if(!aa.size||!bb.size)return 0;let n=0;for(const x of aa)if(bb.has(x))n++;return n/Math.max(aa.size,bb.size);};

export class SceneRetrievalAdapter{
  constructor({episodeProvider,graph=null,maxResults=8,isSourceRevisionCurrent=()=>true}={}){this.episodeProvider=episodeProvider;this.graph=graph;this.maxResults=maxResults;this.isSourceRevisionCurrent=isSourceRevisionCurrent;}
  allEpisodes(){if(typeof this.episodeProvider==='function')return this.episodeProvider()??[];if(Array.isArray(this.episodeProvider))return this.episodeProvider;return [];}

  retrieve({query='',activeEntityRefs=[],locationRef=null,activeThreadRefs=[],currentSceneId=null,limit=this.maxResults,expectedSourceRevisionRefs=null}={}){
    const results=[];
    for(const episode of this.allEpisodes()){
      if((episode.sourceRevisionRefs??[]).some((ref)=>!this.isSourceRevisionCurrent(ref)))continue;
      if(expectedSourceRevisionRefs){
        const expected=new Set(expectedSourceRevisionRefs);const actual=new Set(episode.sourceRevisionRefs??[]);
        if([...actual].some((x)=>!expected.has(x)))continue;
      }
      const participantIds=(episode.participants??[]).map((x)=>x.characterId??x.entityId??x).filter(Boolean);
      const entityScore=activeEntityRefs.length?participantIds.filter((x)=>activeEntityRefs.includes(x)).length/activeEntityRefs.length:0;
      const loc=episode.location?.value?.location??episode.location?.value??null;
      const locationScore=locationRef&&loc===locationRef?1:0;
      const threads=(episode.threadsCarried??[]).map((x)=>typeof x==='string'?x:JSON.stringify(x));
      const threadScore=activeThreadRefs.length?activeThreadRefs.filter((x)=>threads.some((t)=>t.includes(x))).length/activeThreadRefs.length:0;
      const semantic=overlap(query,`${episode.compactSummary} ${threads.join(' ')} ${loc??''}`);
      const adjacency=currentSceneId&&this.graph?Math.min(1,(this.graph.neighbors(currentSceneId).some((e)=>e.fromSceneId===episode.sceneId||e.toSceneId===episode.sceneId)?1:0)):0;
      const recency=Math.min(1,(episode.sceneRevision??1)/100);
      const score=.4*semantic+.2*entityScore+.15*locationScore+.1*threadScore+.1*adjacency+.05*recency;
      if(score<=0)continue;
      const relationEdge=currentSceneId&&this.graph?this.graph.relation(episode.sceneId,currentSceneId)??this.graph.relation(currentSceneId,episode.sceneId):null;
      results.push({kind:'SceneRetrievalCandidate',episodeRef:clone(episode.artifactRef??{artifactId:episode.episodeId,artifactType:'SceneEpisode',revision:episode.sceneRevision}),sceneId:episode.sceneId,score,scoreSignals:{semantic,entity:entityScore,location:locationScore,thread:threadScore,adjacency,recency},sourceRange:clone(episode.sourceRange),sourceRevisionRefs:[...(episode.sourceRevisionRefs??[])],relationshipToCurrentScene:relationEdge?.edgeType??(episode.sceneId===currentSceneId?SceneRelationship.CONTINUES:'HISTORICAL'),relevantEntityRefs:participantIds.filter((x)=>activeEntityRefs.includes(x)),relevantThreadRefs:activeThreadRefs.filter((x)=>threads.some((t)=>t.includes(x))),retrievalReason:semantic>=.5?'semantic':entityScore?'entity':locationScore?'location':threadScore?'thread':adjacency?'adjacency':'weak'});
    }
    results.sort((a,b)=>b.score-a.score||a.sceneId.localeCompare(b.sceneId));return results.slice(0,limit);
  }

  quality(results,{minHigh=.55,minMixed=.2}={}){const top=results[0]?.score??0;return top>=minHigh?RetrievalQuality.HIGH:top>=minMixed?RetrievalQuality.MIXED:RetrievalQuality.LOW;}
}
