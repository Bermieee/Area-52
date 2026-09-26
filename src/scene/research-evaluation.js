const clone=(value)=>value==null?value:structuredClone(value);
const tokenize=(value)=>new Set(String(value??'').toLowerCase().match(/[a-z0-9']+/g)??[]);
const overlap=(query,text)=>{const q=tokenize(query),t=tokenize(text);if(!q.size||!t.size)return 0;let common=0;for(const word of q)if(t.has(word))common++;return common/Math.sqrt(q.size*t.size);};
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))];

function temporalKindForText(text=''){
  const value=String(text).toLowerCase();
  if(/\b(flashback|years? earlier|long ago|remember(?:ed|s|ing)?)\b/.test(value))return'FLASHBACK';
  if(/\b(meanwhile|parallel)\b/.test(value))return'PARALLEL';
  return'CURRENT';
}
function fixedUnits(corpus,size){
  const rows=[];for(let i=0;i<corpus.length;i+=size){const slice=corpus.slice(i,i+size),kinds=uniq(slice.map(row=>row.temporalKind??temporalKindForText(row.text)));rows.push({unitId:`fixed:${i/size}`,sourceIds:slice.map(row=>row.id),summary:slice.map(row=>row.text).join(' '),temporalKind:kinds.length===1?kinds[0]:'MIXED'});}return rows;
}
function semanticUnits(episodes){return episodes.map(row=>({unitId:String(row.episodeId),sourceIds:uniq(row.sourceIds),summary:String(row.summary??''),temporalKind:String(row.temporalKind??temporalKindForText(row.summary)).toUpperCase()}));}
function expectedTemporal(query,semantic){
  const refs=new Set(query.expectedSourceIds??[]),matches=semantic.filter(unit=>[...refs].every(ref=>unit.sourceIds.includes(ref)));
  return matches[0]?.temporalKind??null;
}
function evaluate(units,queries,semanticReference){
  let completeness=0,trace=0,temporal=0,contextChars=0;
  const rows=[];
  for(const query of queries){
    const ranked=units.map(unit=>({unit,score:overlap(query.query,unit.summary)})).sort((a,b)=>b.score-a.score||a.unit.unitId.localeCompare(b.unit.unitId));
    const top=ranked[0]?.unit??{unitId:null,sourceIds:[],summary:'',temporalKind:'UNKNOWN'},expected=uniq(query.expectedSourceIds);
    const hit=expected.filter(ref=>top.sourceIds.includes(ref)).length,ratio=expected.length?hit/expected.length:1,expectedKind=query.expectedTemporalKind??expectedTemporal(query,semanticReference);
    completeness+=ratio;trace+=hit>0?1:0;temporal+=expectedKind==null?1:top.temporalKind===expectedKind?1:0;contextChars+=String(top.summary??'').length;
    rows.push({query:query.query,selectedUnitId:top.unitId,selectedSourceIds:[...top.sourceIds],expectedSourceIds:expected,eventCompleteness:ratio,sourceTraceable:hit>0,expectedTemporalKind:expectedKind,selectedTemporalKind:top.temporalKind,score:ranked[0]?.score??0});
  }
  const count=Math.max(1,queries.length),sourceUse=new Map();
  for(const unit of units)for(const ref of unit.sourceIds)sourceUse.set(ref,(sourceUse.get(ref)??0)+1);
  const rebuildScope=sourceUse.size?[...sourceUse.values()].reduce((sum,value)=>sum+value,0)/sourceUse.size:0;
  return{eventCompleteness:completeness/count,sourceTraceability:trace/count,temporalCorrectness:temporal/count,averageContextChars:contextChars/count,rebuildScopeAfterSingleEdit:rebuildScope,details:rows};
}

export function benchmarkSceneEpisodeRetrieval({corpus=[],semanticEpisodes=[],queries=[],fixedChunkSize=4}={}){
  const size=Math.max(1,Math.min(64,Number(fixedChunkSize)||4)),semantic=semanticUnits(semanticEpisodes),fixed=fixedUnits(corpus,size);
  if(!queries.length)throw new TypeError('Scene retrieval benchmark requires queries');
  if(!semantic.length||!fixed.length)throw new TypeError('Scene retrieval benchmark requires semantic episodes and fixed chunks');
  return Object.freeze({
    kind:'SceneEpisodeRetrievalBenchmark',contractVersion:'1.0.0',queryCount:queries.length,fixedChunkSize:size,
    semantic:clone(evaluate(semantic,queries,semantic)),fixed:clone(evaluate(fixed,queries,semantic)),
    corpusSourceCount:corpus.length,semanticEpisodeCount:semantic.length,fixedChunkCount:fixed.length,
    methodology:'DETERMINISTIC_LEXICAL_RETRIEVAL_TOP1',externalDependency:false,authorityGranted:false,
  });
}
