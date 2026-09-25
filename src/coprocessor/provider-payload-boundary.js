const BLOCKED=new Set(['conversation','fullConversation','chatHistory','lorebook','fullLorebook','memory','allMemory','privateDiagnostics','rawPrompt','chainOfThought','reasoning']);

export function buildBoundedProviderPayload({taskSlice={},sourceReferences=[],selectedContext=[],diagnosticMetadata={}}={}){
  return Object.freeze({
    kind:'BoundedProviderPayload',minimumNecessary:true,referenceFirst:true,
    taskSlice:Object.freeze(sanitizeObject(taskSlice,{maxKeys:48,maxArray:64,maxDepth:5,maxString:2048})),
    sourceReferences:Object.freeze(sourceReferences.slice(0,128).map(referenceOnly)),
    selectedContext:Object.freeze(selectedContext.slice(0,64).map(contextSlice)),
    diagnosticMetadata:Object.freeze(sanitizeObject(diagnosticMetadata,{maxKeys:24,maxArray:32,maxDepth:3,maxString:768})),
  });
}

export function assertProviderPayloadBoundary(payload){
  const visit=(value)=>{
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){for(const item of value)visit(item);return;}
    for(const[key,child]of Object.entries(value)){
      if(BLOCKED.has(key))throw new TypeError('Provider payload contains blocked whole-brain field: '+key);
      visit(child);
    }
  };
  visit(payload);return true;
}

function referenceOnly(value){
  if(typeof value==='string')return Object.freeze({ref:value});
  if(!value||typeof value!=='object')return Object.freeze({ref:String(value)});
  return Object.freeze(sanitizeObject({
    ref:value.ref??value.id??value.artifactId??null,
    artifactId:value.artifactId??null,
    artifactType:value.artifactType??value.kind??null,
    revision:value.revision??null,
    kind:value.kind??null,
    owner:value.owner??null,
    storageDomain:value.storageDomain??null,
    sliceSelector:value.sliceSelector??null,
    contentHash:value.contentHash??null,
    provenanceRef:value.provenanceRef??null,
  },{maxKeys:16,maxArray:8,maxDepth:2,maxString:512}));
}

function contextSlice(value){
  if(typeof value==='string')return Object.freeze({excerpt:clip(value,2048)});
  if(!value||typeof value!=='object')return Object.freeze({excerpt:clip(String(value),2048)});
  return Object.freeze(sanitizeObject({
    ref:value.ref??value.id??value.artifactId??null,
    revision:value.revision??null,
    excerpt:value.excerpt??value.text??value.summary??null,
    structuredFacts:value.structuredFacts??value.facts??null,
    provenanceRef:value.provenanceRef??null,
  },{maxKeys:12,maxArray:64,maxDepth:4,maxString:2048}));
}

function sanitizeObject(value,bounds,depth=0){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const out={};
  for(const[key,raw]of Object.entries(value).slice(0,bounds.maxKeys)){
    if(BLOCKED.has(key))continue;
    out[key]=sanitizeValue(raw,bounds,depth+1);
  }
  return out;
}

function sanitizeValue(value,bounds,depth){
  if(value==null||typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='string')return clip(value,bounds.maxString);
  if(typeof value!=='object')return String(value);
  if(depth>=bounds.maxDepth)return '[depth-clipped]';
  if(Array.isArray(value))return value.slice(0,bounds.maxArray).map((item)=>sanitizeValue(item,bounds,depth+1));
  return sanitizeObject(value,bounds,depth);
}

function clip(value,max){const text=String(value??'');return text.length>max?text.slice(0,max)+'…[clipped]':text;}
