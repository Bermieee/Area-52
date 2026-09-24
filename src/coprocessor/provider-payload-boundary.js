const BLOCKED=new Set(['conversation','fullConversation','chatHistory','lorebook','fullLorebook','memory','allMemory','privateDiagnostics','rawPrompt','chainOfThought','reasoning']);

export function buildBoundedProviderPayload({taskSlice={},sourceReferences=[],selectedContext=[],diagnosticMetadata={}}={}){
  return Object.freeze({
    kind:'BoundedProviderPayload',minimumNecessary:true,referenceFirst:true,
    taskSlice:Object.freeze(boundedObject(taskSlice,32)),
    sourceReferences:Object.freeze(sourceReferences.slice(0,128).map(referenceOnly)),
    selectedContext:Object.freeze(selectedContext.slice(0,64).map(contextSlice)),
    diagnosticMetadata:Object.freeze(boundedObject(diagnosticMetadata,24)),
  });
}

export function assertProviderPayloadBoundary(payload){
  const visit=(value)=>{
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){for(const item of value)visit(item);return;}
    for(const[key,child]of Object.entries(value)){
      if(BLOCKED.has(key))throw new TypeError(\`Provider payload contains blocked whole-brain field: \${key}\`);
      visit(child);
    }
  };
  visit(payload);return true;
}

function referenceOnly(value){
  if(typeof value==='string')return Object.freeze({ref:value});
  if(!value||typeof value!=='object')return Object.freeze({ref:String(value)});
  return Object.freeze(boundedObject({ref:value.ref??value.id??value.artifactId??null,revision:value.revision??null,kind:value.kind??null},8));
}
function contextSlice(value){
  if(typeof value==='string')return Object.freeze({excerpt:clip(value)});
  if(!value||typeof value!=='object')return Object.freeze({excerpt:clip(String(value))});
  return Object.freeze(boundedObject({ref:value.ref??value.id??null,revision:value.revision??null,excerpt:value.excerpt??value.text??value.summary??null,provenanceRef:value.provenanceRef??null},12));
}
function boundedObject(value,maxKeys){
  const out={};
  for(const[key,raw]of Object.entries(value??{}).slice(0,maxKeys)){
    if(BLOCKED.has(key))continue;
    if(typeof raw==='string')out[key]=clip(raw);
    else if(Array.isArray(raw))out[key]=raw.slice(0,64).map((item)=>typeof item==='string'?clip(item):safeScalarObject(item));
    else out[key]=safeScalarObject(raw);
  }
  return out;
}
function safeScalarObject(value){
  if(value==null||typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='string')return clip(value);
  if(typeof value!=='object')return String(value);
  const out={};
  for(const[key,raw]of Object.entries(value).slice(0,24)){
    if(BLOCKED.has(key))continue;
    if(raw==null||['number','boolean'].includes(typeof raw))out[key]=raw;
    else if(typeof raw==='string')out[key]=clip(raw);
  }
  return out;
}
function clip(value){const text=String(value??'');return text.length>2048?\`\${text.slice(0,2048)}…[clipped]\`:text;}
