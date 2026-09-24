const names=['Buffer','process','crypto','TextEncoder'],descriptors=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)])),hostProcess=globalThis.process;
const hide=(name)=>Object.defineProperty(globalThis,name,{value:undefined,writable:true,configurable:true,enumerable:descriptors.get(name)?.enumerable??false});
const restore=(name)=>{const descriptor=descriptors.get(name);if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];};
let report=null,error=null;
try{
  for(const name of names)hide(name);
  const [{Area52CognitiveCore},{hashPacket}]=await Promise.all([import('../src/cognitive-core.js'),import('../src/context-seal.js')]);
  const core=new Area52CognitiveCore();core.importAndLearn({id:'browser-source',sourceType:'LORE',content:'The Relic is intact.',at:0});
  const published=core.publishGenerationContext({turnId:'browser:turn',correlationId:'browser:corr',query:'What is the Relic state?',intent:'CURRENT',anchorEntityIds:['relic'],activeThreads:[{threadId:'inspect-relic',subjectRefs:['relic'],objective:'Inspect the Relic state',priority:8,sourceRevisionIds:['browser-source@1'],evidenceRefs:['browser-source@1']}],sealedAt:1});
  const delivered=core.deliverGenerationContext({published,generationId:'browser:generation',modelProfileId:'RECENCY_WEIGHTED',userInput:'What is the Relic state?'});
  const trace=core.audit.diagnostics.traceTurn('browser:turn');
  report={published:Boolean(published?.packet),sealValid:hashPacket(published.packet)===published.sealReceipt.packetHash,activeThread:published.packet.activeThreads?.[0]?.threadId==='inspect-relic',deliveryReady:delivered.ok===true,promptPlan:Boolean(delivered.plan?.promptPlanId),diagnosticTrace:trace.status==='OK',nodeGlobalsAbsent:names.every(name=>globalThis[name]===undefined)};
}catch(e){error=e;}finally{for(const name of names)restore(name);}
if(error)throw error;for(const [name,pass] of Object.entries(report))console.log(`${pass?'PASS':'FAIL'} ${name}`);const passed=Object.values(report).every(Boolean);console.log(`Core browser-runtime acceptance: ${Object.values(report).filter(Boolean).length}/${Object.values(report).length}`);if(!passed)hostProcess.exitCode=1;
