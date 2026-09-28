const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();
const bounded=(values,limit=64)=>uniq(values).slice(0,Math.max(1,Number(limit)||64));
const safeText=(value,limit=2400)=>String(value??'').slice(0,limit);

function currentLoreRevisionSet(loreInterface){
  try{
    return new Set((loreInterface?.status?.()?.entries??[])
      .filter(row=>row?.sourceState!=='REMOVED'&&row?.sourceRevisionId)
      .map(row=>String(row.sourceRevisionId)));
  }catch{return new Set();}
}

function currentMemoryRevisionSet(memoryInterface){
  const refs=new Set();
  try{
    const adapters=memoryInterface?.adapters??memoryInterface;
    const snapshot=typeof adapters?.snapshot==='function'?adapters.snapshot():null;
    for(const [revisionId,state] of snapshot?.graph?.sourceRevisionState??[]){
      if(state?.state==='ACTIVE')refs.add(String(revisionId));
    }
    for(const revisionId of memoryInterface?.status?.()?.revisionRefs??[])refs.add(String(revisionId));
    for(const revisionId of adapters?.status?.()?.revisionRefs??[])refs.add(String(revisionId));
  }catch{}
  return refs;
}

function temporalHintStatus(value){
  const hint=Array.isArray(value)?value[0]:value;
  if(hint&&typeof hint==='object')return String(hint.status??hint.temporalStatus??hint.kind??'UNRESOLVED').toUpperCase();
  return String(hint??'CURRENT').toUpperCase();
}

function safeDrillbackRefs(nomination,drillback=[]){
  const refs=(drillback??[]).slice(0,24).map(row=>({
    kind:'OWNER_SOURCE_REF',sourceId:row?.sourceId??null,sourceRevisionId:row?.sourceRevisionId??null,
    lorebookId:row?.lorebookId??null,uid:row?.uid??null,representationRef:row?.representationRef??null,
  })).filter(row=>row.sourceRevisionId||row.representationRef);
  refs.push({
    kind:'OWNER_ARTIFACT_REF',artifactRef:clone(nomination?.artifactRef??null),representationRef:nomination?.representationRef??null,
    sourceRevisionRefs:bounded(nomination?.sourceRevisionRefs??[],16),evidenceRefs:bounded(nomination?.evidenceRefs??[],16),
    claimRefs:bounded(nomination?.claimRefs??[],16),eventRefs:bounded(nomination?.eventRefs??[],16),relationshipRefs:bounded(nomination?.relationshipRefs??[],16),
  });
  return refs.slice(0,32);
}

function currentSceneRevisionSet(sceneRuntime){
  const refs=new Set();
  try{
    for(const record of sceneRuntime?.registry?.list?.()??[]){
      const scene=sceneRuntime.registry.current(record.sceneId);
      for(const ref of scene?.sourceRevisionRefs??[])refs.add(String(ref));
      for(const state of Object.values(scene?.fields??{})){
        for(const ref of state?.evidenceRefs??[])refs.add(String(ref));
      }
    }
  }catch{}
  return refs;
}

function candidateEdges({providerId,owner,sourceKind,rows,maxEdges=128}){
  const edges=[];
  for(const row of rows??[]){
    const nomination=row?.nomination??row;
    const drillback=Array.isArray(row?.drillback)?row.drillback:[];
    const sourceRevisionRefs=bounded([
      ...(nomination?.sourceRevisionRefs??[]),
      ...drillback.map(source=>source?.sourceRevisionId),
    ],32);
    if(!sourceRevisionRefs.length)continue;
    const entityRefs=bounded(nomination?.entityRefs??[],32);
    if(!entityRefs.length)continue;
    const artifactId=String(nomination?.artifactRef?.artifactId??nomination?.candidateId??nomination?.nominationId??sourceRevisionRefs[0]);
    const artifactType=String(nomination?.artifactRef?.artifactType??'OWNER_RETRIEVAL');
    const target=sourceKind.toLowerCase()+':artifact:'+artifactId;
    for(const entityRef of entityRefs){
      if(edges.length>=maxEdges)break;
      edges.push({
        edgeId:providerId+':'+artifactId+':'+entityRef,
        fromEntityId:String(entityRef),
        toEntityId:target,
        edgeMeaning:sourceKind==='LORE'?'SUPPORTED_BY_LORE_SOURCE':'SUPPORTED_BY_MEMORY',
        sourceKind:sourceKind+'_OWNER',
        temporalStatus:temporalHintStatus(nomination?.temporalHints),
        authorityClass:nomination?.authorityClass??'DERIVED',
        sourceRevisionRefs,
        dependencyRevisionRefs:bounded(nomination?.dependencyRevisions??[],32),
        identityRevisionRefs:bounded(nomination?.identityRevisionRefs??[],32),
        drillbackRefs:safeDrillbackRefs(nomination,drillback),
        provenanceRefs:bounded((nomination?.provenance??[]).map(value=>typeof value==='string'?value:value?.ref??value?.id),32),
        evidenceRefs:bounded(nomination?.evidenceRefs??[],32),
        claimRefs:bounded(nomination?.claimRefs??[],32),
        eventRefs:bounded(nomination?.eventRefs??[],32),
        relationshipRefs:bounded(nomination?.relationshipRefs??[],32),
        artifactRef:{artifactId,artifactType,revision:nomination?.artifactRevision??1},
        artifactRevision:nomination?.artifactRevision??1,
        providerRevision:nomination?.representationRevision??null,
        representationText:safeText(nomination?.representationText??drillback?.[0]?.selectedRepresentation?.content??drillback?.[0]?.exactAuthoredText),
        representationRef:nomination?.representationRef??drillback?.[0]?.representationRef??null,
        representationRevision:nomination?.representationRevision??drillback?.[0]?.selectedRepresentation?.representationRevision??null,
        evidenceIdentity:clone(nomination?.evidenceIdentity??null),
        perspective:clone(nomination?.metadata?.perspective??null),
        hardRule:false,
        providerWeight:1,
        owner,
      });
    }
    if(edges.length>=maxEdges)break;
  }
  return edges;
}

export function createLoreOwnerGraphProvider(loreInterface){
  if(typeof loreInterface?.query!=='function')return null;
  let queryRevisionSet=null;
  return Object.freeze({
    providerId:'LORE_OWNER_GRAPH',
    owner:'LORE_INTELLIGENCE',
    semanticsVersion:'LORE_OWNER_GRAPH_V1',
    metadata:{sourceKind:'LORE_OWNER',authority:'REFERENCE_ONLY'},
    isRevisionCurrent:(revisionId)=>(queryRevisionSet??=currentLoreRevisionSet(loreInterface)).has(String(revisionId)),
    query(request={}){
      queryRevisionSet=null;
      try{
        const packet=loreInterface.query({query:String(request.query??''),intent:'AUTO'});
        return {
          providerRevision:packet?.indexRevision??packet?.ontologyRevision??null,
          edges:candidateEdges({providerId:'LORE_OWNER_GRAPH',owner:'LORE_INTELLIGENCE',sourceKind:'LORE',rows:packet?.nominations,maxEdges:request.maxEdges}),
        };
      }catch{return {providerRevision:null,edges:[]};}
    },
  });
}

export function createMemoryOwnerGraphProvider(memoryInterface){
  const adapters=memoryInterface?.adapters??memoryInterface;
  if(typeof adapters?.queryHistorian!=='function')return null;
  let queryRevisionSet=null;
  return Object.freeze({
    providerId:'MEMORY_OWNER_GRAPH',
    owner:'MEMORY_TEMPORAL',
    semanticsVersion:'MEMORY_OWNER_GRAPH_V1',
    metadata:{sourceKind:'MEMORY_OWNER',authority:'REFERENCE_ONLY'},
    isRevisionCurrent:(revisionId)=>(queryRevisionSet??=currentMemoryRevisionSet(memoryInterface)).has(String(revisionId)),
    query(request={}){
      queryRevisionSet=null;
      try{
        const result=adapters.queryHistorian({
          query:String(request.query??''),
          mode:request.intentKind==='HISTORICAL'?'EXPLICIT_HISTORY':'AUTO',
          limits:{maxCandidates:Math.max(1,Math.min(Number(request.maxCandidates)||32,64))},
        });
        const current=currentMemoryRevisionSet(memoryInterface);
        queryRevisionSet=current;
        const edges=candidateEdges({providerId:'MEMORY_OWNER_GRAPH',owner:'MEMORY_TEMPORAL',sourceKind:'MEMORY',rows:result?.nominations,maxEdges:request.maxEdges});
        for(const edge of edges)edge.dependencyRevisionRefs=edge.dependencyRevisionRefs.filter(ref=>current.has(String(ref)));
        return {
          providerRevision:(result?.historianRevision??(result?.memoryRevisionRefs??[]).join('|'))||null,
          edges,
        };
      }catch{return {providerRevision:null,edges:[]};}
    },
  });
}

export function createSceneOwnerGraphProvider(sceneRuntime){
  if(!sceneRuntime?.graph?.exportState)return null;
  let queryRevisionSet=null;
  const temporalStatusFor=(row)=>{
    if(row?.temporalStatus)return String(row.temporalStatus).toUpperCase();
    if(String(row?.edgeType??'')==='SCENE_FLASHBACK')return'HISTORICAL';
    const sceneIds=[row?.fromSceneId,row?.toSceneId].filter(Boolean);
    if(sceneIds.length&&sceneIds.every(sceneId=>sceneRuntime.registry?.get?.(sceneId)?.lifecycle==='CLOSED'))return'HISTORICAL';
    return sceneIds.length?'CURRENT':'UNRESOLVED';
  };
  return Object.freeze({
    providerId:'SCENE_OWNER_GRAPH',
    owner:'SCENE_LIFECYCLE',
    semanticsVersion:'SCENE_OWNER_GRAPH_V1',
    metadata:{sourceKind:'SCENE_OWNER',authority:'REFERENCE_ONLY'},
    isRevisionCurrent:(revisionId)=>(queryRevisionSet??=currentSceneRevisionSet(sceneRuntime)).has(String(revisionId)),
    query(request={}){
      queryRevisionSet=currentSceneRevisionSet(sceneRuntime);
      const maxEdges=Math.max(1,Math.min(Number(request.maxEdges)||128,256));
      try{
        const state=sceneRuntime.graph.exportState();
        const historical=['HISTORICAL','TEMPORAL'].includes(String(request.intentKind??'CURRENT').toUpperCase());
        if(historical)for(const row of state?.edges??[])for(const ref of [...(row?.sourceRevisionRefs??[]),...(row?.evidenceRefs??[])])queryRevisionSet.add(String(ref));
        const edges=[];
        for(const row of state?.edges??[]){
          if(row?.status==='RETIRED'&&!historical)continue;
          const sceneIds=bounded([row?.sceneId,row?.fromSceneId,row?.toSceneId],16);
          const refs=bounded((row?.sourceRevisionRefs?.length?row.sourceRevisionRefs:sceneIds.flatMap(sceneId=>sceneRuntime.registry?.current?.(sceneId)?.sourceRevisionRefs??[])),32);
          if(!refs.length)continue;
          const evidenceRefs=bounded(row?.evidenceRefs??[],32);
          const from=row.fromSceneId??row.fromRef;
          const to=row.toSceneId??row.toRef;
          if(!from||!to)continue;
          edges.push({
            edgeId:String(row.edgeId),
            fromEntityId:String(from),
            toEntityId:String(to),
            edgeMeaning:String(row.edgeType??'SCENE_RELATED'),
            sourceKind:'SCENE_OWNER',
            temporalStatus:temporalStatusFor(row),
            temporal:{...(clone(row.temporalApplicability??{})??{}),sourceSceneRevision:row.sceneRevision??null,edgeStatus:row.status??'ACTIVE'},
            authorityClass:row.authorityClass??(['EVIDENCE_CAUSES','EVIDENCE_SUPPORTS'].includes(String(row.edgeType))?'INFERRED':'OBSERVED'),
            sourceRevisionRefs:refs,
            dependencyRevisionRefs:bounded(row.dependencyRevisionRefs??[],32),
            provenanceRefs:bounded([...(row.provenance??[]),...(row.derivedFrom??[])],32),
            evidenceRefs,
            drillbackRefs:sceneIds.map(sceneId=>({kind:'SCENE_SOURCE_REF',sceneId,sceneRevision:row.sceneRevision??sceneRuntime.registry?.current?.(sceneId)?.revision??null,episodeRef:clone(row.episodeRef??null),sourceRevisionRefs:bounded(row.sourceRevisionRefs?.length?row.sourceRevisionRefs:sceneRuntime.registry?.current?.(sceneId)?.sourceRevisionRefs??[],16),observedState:clone(row.observedState??null),temporalApplicability:clone(row.temporalApplicability??null)})),
            claimRefs:[],
            eventRefs:String(row.edgeType)==='EVENT_IN_SCENE'?[String(row.fromRef??'')].filter(Boolean):[],
            relationshipRefs:[String(row.edgeId)],
            artifactRef:clone(row.episodeRef??{artifactId:String(row.edgeId),artifactType:'SceneGraphEdge',revision:Math.max(1,Number(row.sceneRevision)||1)}),
            artifactRevision:row.episodeRef?.revision??Math.max(1,Number(row.sceneRevision)||1),
            providerRevision:state?.version??1,
            representationText:row.observedState?['Scene',sceneIds[0]??'',String(row.edgeType),String(row.fromRef??row.fromSceneId??''),JSON.stringify(row.observedState)].join(' '):null,
            hardRule:false,
            providerWeight:1,
            sceneRevision:Number(request.sceneRevision??0),
            status:row.status??'ACTIVE',
          });
          if(edges.length>=maxEdges)break;
        }
        return {providerRevision:state?.version??1,edges};
      }catch{return {providerRevision:null,edges:[]};}
    },
  });
}

export function createOwnerGraphProviders({loreInterface=null,memoryInterface=null,sceneRuntime=null}={}){
  return [
    createLoreOwnerGraphProvider(loreInterface),
    createMemoryOwnerGraphProvider(memoryInterface),
    createSceneOwnerGraphProvider(sceneRuntime),
  ].filter(Boolean);
}
