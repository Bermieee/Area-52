const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter((value)=>typeof value==='string'&&value.trim()).map((value)=>value.trim()))].sort();

export const MEMORY_TRANSPORT_EXCERPT_VERSION='1.0.0';

export function createMemoryTransportExcerpt({
  text='',
  maxCharacters,
  artifactRef=null,
  sourceRevisionRefs=[],
  evidenceRefs=[],
  provenanceRef=null,
  transportPurpose='MEMORY_SIDE_INPUT',
}={}){
  const limit=Math.max(1,Number(maxCharacters)||1);
  const original=String(text??'');
  const excerpt=original.slice(0,limit);
  const omittedCharacters=Math.max(0,original.length-excerpt.length);
  const sourceRefs=uniq(sourceRevisionRefs);
  const evidence=uniq(evidenceRefs);
  const drillback={
    kind:'MemoryTransportDrillbackReference',
    contractVersion:MEMORY_TRANSPORT_EXCERPT_VERSION,
    artifactRef:clone(artifactRef),
    provenanceRef:provenanceRef==null?null:String(provenanceRef),
    artifactRevision:artifactRef?.revision??null,
    sourceRevisionRefs:sourceRefs.slice(0,64),
    sourceRevisionCount:sourceRefs.length,
    sourceRevisionRefsComplete:sourceRefs.length<=64,
    evidenceRefs:evidence.slice(0,128),
    evidenceRefCount:evidence.length,
    evidenceRefsComplete:evidence.length<=128,
    exactSourceDrillback:true,
    exhaustiveEvidenceTransported:false,
  };
  const coverage={
    kind:'MemoryTransportCoverage',
    contractVersion:MEMORY_TRANSPORT_EXCERPT_VERSION,
    transportPurpose:String(transportPurpose),
    coverageComplete:omittedCharacters===0,
    exhaustiveEvidenceTransported:false,
    originalCharacters:original.length,
    transmittedCharacters:excerpt.length,
    omittedCharacters,
    limitCharacters:limit,
    reasonCode:omittedCharacters?'MEMORY_TRANSPORT_EXCERPT_BOUND':null,
    canonicalKnowledgeDropped:false,
  };
  return Object.freeze({
    kind:'MemoryTransportExcerpt',
    contractVersion:MEMORY_TRANSPORT_EXCERPT_VERSION,
    excerpt,
    coverage:Object.freeze(coverage),
    drillback:Object.freeze(drillback),
    structuredFacts:Object.freeze([Object.freeze(clone(coverage)),Object.freeze(clone(drillback))]),
  });
}
