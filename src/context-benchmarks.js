import { utf8ByteLength } from './browser-runtime-utils.js';

export const BenchmarkMeasurementState=Object.freeze({MEASURED:'MEASURED',REPLAYED:'REPLAYED',NOT_MEASURED:'NOT_MEASURED',NOT_APPLICABLE:'NOT_APPLICABLE'});
const bytes=(value)=>utf8ByteLength(JSON.stringify(value));
const factKey=(f)=>JSON.stringify([f.e??f.subjectId,f.p??f.predicate,f.v??f.value]);
const validState=(state)=>Object.values(BenchmarkMeasurementState).includes(state);
export function semanticPacketProjection(packet){
  const out={kind:packet.kind,id:packet.id,query:packet.query,intent:packet.intent,current:packet.current??[],historical:packet.historical??[],unresolved:packet.unresolved??[],provenanceIndex:packet.provenanceIndex??{},dependencies:packet.dependencies??[]};
  if((packet.activeThreads??[]).length)out.activeThreads=packet.activeThreads;return out;
}

export function benchmarkContextCompression({rawRepresentation,compiledPacket,requirements={}}){
  const compiledFacts=[...(compiledPacket.current??[]),...(compiledPacket.historical??[]),...(compiledPacket.unresolved??[])],compiledKeys=new Set(compiledFacts.map(factKey)),facts=requirements.facts??[];
  const factualRetention=facts.length?facts.filter(f=>compiledKeys.has(factKey(f))).length/facts.length:1;
  const temporal=requirements.temporal??[];const temporalRetention=temporal.length?temporal.filter(req=>{const fact=compiledFacts.find(f=>factKey(f)===factKey(req));return fact&&Array.isArray(fact.t)&&(req.status===undefined||fact.t[2]===req.status)&&(req.validFrom===undefined||fact.t[0]===req.validFrom)&&(req.validUntil===undefined||fact.t[1]===req.validUntil);}).length/temporal.length:1;
  const unresolved=requirements.unresolved??[],unresolvedKeys=new Set((compiledPacket.unresolved??[]).map(factKey)),contradictionRetention=unresolved.length?unresolved.filter(f=>unresolvedKeys.has(factKey(f))).length/unresolved.length:1;
  const provenance=requirements.provenance??[];const provenanceRetention=provenance.length?provenance.filter(({factId,sourceRevisionIds})=>{const actual=compiledPacket.provenanceIndex?.[factId]??[];return sourceRevisionIds.every(id=>actual.includes(id));}).length/provenance.length:1;
  const relationships=requirements.relationships??[],relationshipRetention=relationships.length?relationships.filter(f=>compiledKeys.has(factKey(f))).length/relationships.length:1;
  const requiredThreads=requirements.activeThreads??[],actualThreads=new Set((compiledPacket.activeThreads??[]).map(x=>x.threadId??x.id)),unresolvedThreadRetention=requiredThreads.length?requiredThreads.filter(x=>actualThreads.has(x.threadId??x.id??x)).length/requiredThreads.length:1;
  const rawBytes=bytes(rawRepresentation),compiledBytes=bytes(semanticPacketProjection(compiledPacket));
  return{kind:'ContextCompressionBenchmark',measurementState:BenchmarkMeasurementState.MEASURED,rawBytes,compiledBytes,compressionRatio:rawBytes?Number((compiledBytes/rawBytes).toFixed(6)):1,factualRetention,temporalRetention,contradictionRetention,unresolvedThreadRetention,provenanceRetention,relationshipRetention,latencyMs:null,runtimeDependency:'AREA52_JS',portability:'BROWSER_AND_NODE',pass:[factualRetention,temporalRetention,contradictionRetention,unresolvedThreadRetention,provenanceRetention,relationshipRetention].every(x=>x===1)};
}

export function createExternalCompressorRequest({requestId,compressorId='LLMLINGUA2',inputText,requirements={},model='microsoft/llmlingua-2-xlm-roberta-large-meetingbank',targetRate=.5}={}){
  if(typeof requestId!=='string'||!requestId||typeof inputText!=='string')throw new TypeError('external compressor request requires requestId and inputText');
  return{kind:'ExternalCompressorBenchmarkRequest',schemaVersion:'1',requestId,compressorId,model,targetRate:Number(targetRate),inputText,requirements:structuredClone(requirements),commandTemplate:'python scripts/run_llmlingua2_benchmark.py --input <request.json> --output <result.json>',resultSchema:'ExternalCompressorBenchmarkResult@1'};
}
export function importExternalCompressorResult(input){
  if(!input||input.kind!=='ExternalCompressorBenchmarkResult')throw new TypeError('invalid ExternalCompressorBenchmarkResult');if(!validState(input.measurementState))throw new TypeError('invalid benchmark measurement state');
  const metric=(name)=>input[name]===null||input[name]===undefined?null:Number(input[name]);
  return{kind:'ExternalCompressorBenchmarkResult',schemaVersion:String(input.schemaVersion??'1'),requestId:String(input.requestId),compressorId:String(input.compressorId),measurementState:input.measurementState,inputBytes:metric('inputBytes'),outputBytes:metric('outputBytes'),compressionRatio:metric('compressionRatio'),factualRetention:metric('factualRetention'),temporalRetention:metric('temporalRetention'),unresolvedThreadRetention:metric('unresolvedThreadRetention'),contradictionRetention:metric('contradictionRetention'),relationshipRetention:metric('relationshipRetention'),provenanceRetention:metric('provenanceRetention'),latencyMs:metric('latencyMs'),runtimeDependency:input.runtimeDependency??null,portability:input.portability??null,evidenceRef:input.evidenceRef??null,metricStates:structuredClone(input.metricStates??{})};
}
export function compareCompressionBenchmarks(area52,external=null){
  const ext=external?importExternalCompressorResult(external):{kind:'ExternalCompressorBenchmarkResult',compressorId:'LLMLINGUA2',measurementState:BenchmarkMeasurementState.NOT_MEASURED,inputBytes:null,outputBytes:null,compressionRatio:null,factualRetention:null,temporalRetention:null,unresolvedThreadRetention:null,contradictionRetention:null,relationshipRetention:null,provenanceRetention:null,latencyMs:null,runtimeDependency:'PYTHON+MODEL',portability:'EXTERNAL_BENCHMARK',evidenceRef:null,metricStates:{inputBytes:BenchmarkMeasurementState.NOT_MEASURED,outputBytes:BenchmarkMeasurementState.NOT_MEASURED,compressionRatio:BenchmarkMeasurementState.NOT_MEASURED,factualRetention:BenchmarkMeasurementState.NOT_MEASURED,temporalRetention:BenchmarkMeasurementState.NOT_MEASURED,unresolvedThreadRetention:BenchmarkMeasurementState.NOT_MEASURED,contradictionRetention:BenchmarkMeasurementState.NOT_MEASURED,relationshipRetention:BenchmarkMeasurementState.NOT_MEASURED,provenanceRetention:BenchmarkMeasurementState.NOT_MEASURED,latencyMs:BenchmarkMeasurementState.NOT_MEASURED}};
  return{kind:'ContextCompressionComparison',rows:[{compressorId:'AREA52_STRUCTURED',measurementState:area52.measurementState??BenchmarkMeasurementState.MEASURED,inputBytes:area52.rawBytes,outputBytes:area52.compiledBytes,compressionRatio:area52.compressionRatio,factualRetention:area52.factualRetention,temporalRetention:area52.temporalRetention,unresolvedThreadRetention:area52.unresolvedThreadRetention,contradictionRetention:area52.contradictionRetention,relationshipRetention:area52.relationshipRetention,provenanceRetention:area52.provenanceRetention,latencyMs:area52.latencyMs??null,runtimeDependency:area52.runtimeDependency??'AREA52_JS',portability:area52.portability??'BROWSER_AND_NODE'},ext],winner:null,rule:'Correctness dominates size; no winner is emitted without comparable measured evidence.'};
}

const ORDER_SECTIONS=['current','character','unresolved','supportingLore','historical'];
export function buildContextOrderVariants(sections={}){
  const values=Object.fromEntries(ORDER_SECTIONS.map(name=>[name,sections[name]??[]]));
  const orders=[['current','character','unresolved','supportingLore','historical'],['unresolved','current','character','supportingLore','historical'],['historical','supportingLore','current','character','unresolved'],['supportingLore','current','unresolved','character','historical'],['character','current','unresolved','historical','supportingLore']];
  return orders.map((order,index)=>({kind:'ContextOrderVariant',id:`context-order:${index+1}`,order,sections:order.map((name,position)=>({name,position,content:structuredClone(values[name])})),positionIndex:Object.fromEntries(order.map((name,position)=>[name,position]))}));
}
export function buildPositionSensitivityFixtures(sections={}, {distractorCount=24}={}){
  const values=Object.fromEntries(ORDER_SECTIONS.map(name=>[name,sections[name]??[]])),fixtures=[];const targets=['current','unresolved','character'];
  for(const target of targets)for(const [label,index] of [['EARLY',0],['MIDDLE',2],['LATE',4]]){const rest=ORDER_SECTIONS.filter(x=>x!==target),order=[...rest];order.splice(index,0,target);fixtures.push({kind:'PositionSensitivityFixture',id:`position:${target}:${label.toLowerCase()}`,target,position:label,order,sections:order.map(name=>({name,content:structuredClone(values[name])})),distractors:Array.from({length:distractorCount},(_,i)=>`distractor-${i}`)});}
  fixtures.push({kind:'PositionSensitivityFixture',id:'position:historical-before-current',target:'historical',position:'BEFORE_CURRENT',order:['historical','current','character','unresolved','supportingLore'],sections:[],distractors:[]});
  fixtures.push({kind:'PositionSensitivityFixture',id:'position:historical-after-current',target:'historical',position:'AFTER_CURRENT',order:['current','historical','character','unresolved','supportingLore'],sections:[],distractors:[]});
  fixtures.push({kind:'PositionSensitivityFixture',id:'position:lore-near-query',target:'supportingLore',position:'NEAR_QUERY',order:['current','character','unresolved','historical','supportingLore'],sections:[],distractors:[]});
  fixtures.push({kind:'PositionSensitivityFixture',id:'position:lore-far-query',target:'supportingLore',position:'FAR_QUERY',order:['supportingLore','historical','current','character','unresolved'],sections:[],distractors:Array.from({length:distractorCount*2},(_,i)=>`long-distractor-${i}`)});
  return fixtures;
}
export function createOrderMeasurement({measurementId,variantId,modelFamily,measurementState=BenchmarkMeasurementState.MEASURED,criticalCurrentRetention=null,unresolvedWarningRetention=null,characterStateRetention=null,continuityScore=null,estimatedTokens=null,latencyMs=null,evidenceRef=null}={}){
  if(!measurementId||!variantId||!modelFamily)throw new TypeError('order measurement requires IDs and modelFamily');if(!validState(measurementState))throw new TypeError('invalid measurement state');
  const n=(v)=>v===null||v===undefined?null:Number(v);return{kind:'ContextOrderMeasurement',schemaVersion:'1',measurementId,variantId,modelFamily,measurementState,criticalCurrentRetention:n(criticalCurrentRetention),unresolvedWarningRetention:n(unresolvedWarningRetention),characterStateRetention:n(characterStateRetention),continuityScore:n(continuityScore),estimatedTokens:n(estimatedTokens),latencyMs:n(latencyMs),evidenceRef};
}
export function compareContextOrderMeasurements(variants,measurements=[]){const byId=new Map(measurements.map(x=>[x.variantId,x]));return variants.map(variant=>({variantId:variant.id,order:[...variant.order],measurement:byId.get(variant.id)??null}));}
export function summarizeOrderMeasurements(measurements=[]){
  const rows=measurements.map(createOrderMeasurement),families=[...new Set(rows.map(x=>x.modelFamily))].sort();return{kind:'ContextOrderBenchmarkSummary',rows,families,measuredCount:rows.filter(x=>x.measurementState===BenchmarkMeasurementState.MEASURED).length,replayedCount:rows.filter(x=>x.measurementState===BenchmarkMeasurementState.REPLAYED).length,unmeasuredCount:rows.filter(x=>x.measurementState===BenchmarkMeasurementState.NOT_MEASURED).length,universalWinner:null,rule:'Ordering is model-profile presentation policy, never truth.'};
}
