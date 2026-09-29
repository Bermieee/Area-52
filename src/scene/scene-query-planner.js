const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values,limit=32)=>[...new Set((values??[]).filter(Boolean).map(String))].slice(0,limit);
const normalizeText=(value)=>String(value??'').trim().replace(/\s+/g,' ');
function boundedQuery(value,limit=320){
  const text=normalizeText(value),cap=Math.max(1,Number(limit)||320);
  if(text.length<=cap)return{text,coverage:{complete:true,policy:'FULL',sourceCharacters:text.length,includedCharacters:text.length,omittedCharacters:0}};
  const marker=' … ';
  const usable=Math.max(1,cap-marker.length),head=Math.ceil(usable/2),tail=Math.max(0,usable-head);
  const bounded=text.slice(0,head).trimEnd()+marker+text.slice(Math.max(head,text.length-tail)).trimStart();
  return{text:bounded.slice(0,cap),coverage:{complete:false,policy:'HEAD_TAIL_DERIVED_QUERY',sourceCharacters:text.length,includedCharacters:Math.min(text.length,head+tail),omittedCharacters:Math.max(0,text.length-head-tail),headCharacters:head,tailCharacters:tail}};
}
function boundedRefs(values,limit=32){
  const all=[...new Set((values??[]).filter(Boolean).map(String))],kept=all.slice(0,limit);
  return{values:kept,coverage:{complete:kept.length===all.length,total:all.length,included:kept.length,boundedOut:Math.max(0,all.length-kept.length),policy:'STABLE_RANKED_BOUND'}};
}
const clean=(value,limit=320)=>boundedQuery(value,limit).text;
const field=(scene,name)=>scene?.fields?.[name]?.value??null;

function refOf(value,...keys){if(typeof value==='string')return value;for(const key of keys){if(value?.[key])return String(value[key]);}return null;}
function intent({scene,index,intentKind,query,entityRefs=[],locationRefs=[],relationshipRefs=[],objectRefs=[],threadRefs=[],perspective='SCENE'}){
  const bounded=boundedQuery(query),entities=boundedRefs(entityRefs),locations=boundedRefs(locationRefs),relationships=boundedRefs(relationshipRefs),objects=boundedRefs(objectRefs),threads=boundedRefs(threadRefs);
  const sources=boundedRefs(scene.sourceRevisionRefs??[],64),provenance=boundedRefs(scene.provenance??[],64);
  return Object.freeze({
    kind:'SceneRetrievalIntent',contractVersion:'1.0.0',intentId:`scene-intent:${scene.sceneId}:${scene.revision}:${index}:${intentKind}`,
    intentKind,query:bounded.text,queryCoverage:bounded.coverage,sceneId:scene.sceneId,sceneRevision:scene.revision,
    entityRefs:entities.values,locationRefs:locations.values,relationshipRefs:relationships.values,objectRefs:objects.values,threadRefs:threads.values,
    sourceRevisionRefs:sources.values,provenanceRefs:provenance.values,perspective,
    referenceCoverage:{entityRefs:entities.coverage,locationRefs:locations.coverage,relationshipRefs:relationships.coverage,objectRefs:objects.coverage,threadRefs:threads.coverage,sourceRevisionRefs:sources.coverage,provenanceRefs:provenance.coverage},
    graphTraversal:{maxDepth:3,maxNodes:64,maxEdges:128,maxCandidates:32},
    authority:'RETRIEVAL_INTENT_ONLY',runtimeSchedulingAuthority:false,finalAdmissionAuthority:false,truthAuthority:false,contextSealAuthority:false,
  });
}

export class SceneQueryPlanner{
  constructor({maxIntents=8}={}){this.maxIntents=Math.max(1,Math.min(12,Number(maxIntents)||8));}
  plan({scene,userInput='',intent:mode='CURRENT'}={}){
    if(!scene?.sceneId||!scene?.revision)throw new TypeError('SceneQueryPlanner requires CurrentScene identity/revision');
    const cast=(field(scene,'activeCast')??[]).filter(row=>typeof row==='string'||row?.state==='PRESENT');
    const activeCastRefs=uniq(cast.map(row=>refOf(row,'characterId','entityId','id','ref')).filter(Boolean));
    const location=field(scene,'location'),locationRef=refOf(location,'locationRef','location','id','name');
    const threads=uniq((field(scene,'activeThreads')??[]).map(row=>refOf(row,'threadId','id','ref')??(typeof row==='string'?row:null)).filter(Boolean));
    const relationships=uniq((field(scene,'activeRelationships')??[]).map(row=>refOf(row,'relationshipId','id','ref')??(row?.kind?[row.from,row.kind,row.to].filter(Boolean).join(':'):null)).filter(Boolean));
    const objects=(field(scene,'immediateObjects')??[]).filter(row=>String(row?.state??'').toUpperCase()!=='MENTIONED_ONLY');
    const objectRefs=uniq(objects.map(row=>refOf(row,'objectId','objectRef','id','ref')).filter(Boolean));
    const rows=[];
    const add=(kind,query,extra={})=>{if(rows.length>=this.maxIntents)return;rows.push(intent({scene,index:rows.length+1,intentKind:kind,query,...extra}));};
    if(clean(userInput))add('DIRECT_QUERY',userInput,{entityRefs:activeCastRefs,locationRefs:locationRef?[locationRef]:[],threadRefs:threads});
    if(activeCastRefs.length)add('ACTIVE_CAST_CONTEXT',`Current active cast: ${activeCastRefs.join(', ')}`,{entityRefs:activeCastRefs});
    if(locationRef)add('LOCATION_CONTEXT',`Current scene location: ${locationRef}`,{locationRefs:[locationRef],entityRefs:activeCastRefs});
    if(relationships.length)add('RELATIONSHIP_CONTEXT',`Active scene relationships: ${relationships.join(', ')}`,{relationshipRefs:relationships,entityRefs:activeCastRefs});
    if(objectRefs.length)add('OBJECT_PROVENANCE',`Object continuity and provenance: ${objectRefs.join(', ')}`,{objectRefs,entityRefs:activeCastRefs});
    if(threads.length)add('ACTIVE_THREAD_CONTEXT',`Open scene threads: ${threads.join(', ')}`,{threadRefs:threads,entityRefs:activeCastRefs});
    const atmosphere=field(scene,'atmosphere')??{},threat=Object.entries(atmosphere).filter(([name,row])=>['danger','hostility','tension','urgency'].includes(name)&&Number(row?.score??0)>=.65).map(([name])=>name);
    if(threat.length)add('THREAT_CONTEXT',`Scene risk signals: ${threat.join(', ')}`,{entityRefs:activeCastRefs,locationRefs:locationRef?[locationRef]:[]});
    if(!rows.length)add('SCENE_CONTINUITY',`Scene continuity for ${scene.sceneId}`,{entityRefs:activeCastRefs,locationRefs:locationRef?[locationRef]:[]});
    return Object.freeze({kind:'SceneQueryPlan',contractVersion:'1.0.0',sceneId:scene.sceneId,sceneRevision:scene.revision,mode:String(mode),activeCastRefs,locationRef:locationRef??null,intents:Object.freeze(rows),bounded:true,runtimeSchedulingAuthority:false,finalAdmissionAuthority:false,truthAuthority:false});
  }
}
