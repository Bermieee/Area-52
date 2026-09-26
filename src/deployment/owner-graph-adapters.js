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
  try{
    const adapters=memoryInterface?.adapters??memoryInterface;
    if(typeof adapters?.resolveHistorian!=='function')return new Set();
    const result=adapters.resolveHistorian({
      kind:'HistorianMemoryRequest',
      query:'',
      mode:'EXPLICIT_HISTORY',
      memoryRevisionRefs:[],
      limits:{maxArtifacts:1,maxEvidenceBytes:256},
    });
    return new Set((result?.memoryRevisionRefs??[]).map(String));
  }catch{return new Set();}
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
        temporalStatus:String(nomination?.temporalHints?.[0]??'CURRENT').toUpperCase(),
        authorityClass:nomination?.authorityClass??'DERIVED',
        sourceRevisionRefs,
        dependencyRevisionRefs:bounded(nomination?.dependencyRevisions??[],32),
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
  return Object.freeze({
    providerId:'LORE_OWNER_GRAPH',
    owner:'LORE_INTELLIGENCE',
    semanticsVersion:'LORE_OWNER_GRAPH_V1',
    metadata:{sourceKind:'LORE_OWNER',authority:'REFERENCE_ONLY'},
    isRevisionCurrent:(revisionId)=>currentLoreRevisionSet(loreInterface).has(String(revisionId)),
    query(request={}){
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
  return Object.freeze({
    providerId:'MEMORY_OWNER_GRAPH',
    owner:'MEMORY_TEMPORAL',
    semanticsVersion:'MEMORY_OWNER_GRAPH_V1',
    metadata:{sourceKind:'MEMORY_OWNER',authority:'REFERENCE_ONLY'},
    isRevisionCurrent:(revisionId)=>currentMemoryRevisionSet(memoryInterface).has(String(revisionId)),
    query(request={}){
      try{
        const result=adapters.queryHistorian({
          query:String(request.query??''),
          mode:request.intentKind==='HISTORICAL'?'EXPLICIT_HISTORY':'AUTO',
          limits:{maxCandidates:Math.max(1,Math.min(Number(request.maxCandidates)||32,64))},
        });
        return {
          providerRevision:(result?.memoryRevisionRefs??[]).join('|')||null,
          edges:candidateEdges({providerId:'MEMORY_OWNER_GRAPH',owner:'MEMORY_TEMPORAL',sourceKind:'MEMORY',rows:result?.nominations,maxEdges:request.maxEdges}),
        };
      }catch{return {providerRevision:null,edges:[]};}
    },
  });
}

export function createSceneOwnerGraphProvider(sceneRuntime){
  if(!sceneRuntime?.graph?.exportState)return null;
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
    isRevisionCurrent:(revisionId)=>currentSceneRevisionSet(sceneRuntime).has(String(revisionId)),
    query(request={}){
      const maxEdges=Math.max(1,Math.min(Number(request.maxEdges)||128,256));
      try{
        const state=sceneRuntime.graph.exportState();
        const edges=[];
        for(const row of state?.edges??[]){
          const refs=bounded(row?.evidenceRefs??[],32);
          if(!refs.length)continue;
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
            authorityClass:row.authorityClass??(['EVIDENCE_CAUSES','EVIDENCE_SUPPORTS'].includes(String(row.edgeType))?'INFERRED':'OBSERVED'),
            sourceRevisionRefs:refs,
            dependencyRevisionRefs:bounded(row.derivedFrom??[],32),
            provenanceRefs:bounded(row.provenance??[],32),
            evidenceRefs:refs,
            claimRefs:[],
            eventRefs:[],
            relationshipRefs:[String(row.edgeId)],
            artifactRef:{artifactId:String(row.edgeId),artifactType:'SceneGraphEdge',revision:1},
            artifactRevision:1,
            providerRevision:state?.version??1,
            representationText:null,
            hardRule:false,
            providerWeight:1,
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
