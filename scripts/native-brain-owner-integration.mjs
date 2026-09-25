import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Area52NativeBrain} from '../src/native-brain.js';

function scene(sceneId,sceneRevision,{location=null,activeCast=[]}={}){
  return{sceneId,sceneRevision,location,narrativeTime:'day '+sceneRevision,activeCast,activeThreads:[],objects:[],sourceRevisionRefs:[],provenance:['owner-integration:'+sceneId+':'+sceneRevision]};
}
function channels(prepared){
  return new Set((prepared.candidateEnvelope?.candidates??[]).flatMap(row=>(row.channelNominations??[]).map(n=>n.channelId)));
}
function externalModule(root,path){
  return import(pathToFileURL(resolve(root,path)).href);
}

const memoryRoot=process.env.AREA52_MEMORY_REF_ROOT;
const loreRoot=process.env.AREA52_LORE_REF_ROOT;
assert.ok(memoryRoot,'AREA52_MEMORY_REF_ROOT is required');
assert.ok(loreRoot,'AREA52_LORE_REF_ROOT is required');

const [{MemoryTemporalProducer},{createMemoryIntegrationSurface},{LoreIntelligenceService},{createLoreAuthoringService}]=await Promise.all([
  externalModule(memoryRoot,'src/memory-temporal-producer.js'),
  externalModule(memoryRoot,'src/memory-integration-surface.js'),
  externalModule(loreRoot,'src/lore-intelligence-service.js'),
  externalModule(loreRoot,'src/lore-authoring-service.js'),
]);

const memoryProducer=new MemoryTemporalProducer();
const memorySurface=createMemoryIntegrationSurface(memoryProducer);
const loreService=new LoreIntelligenceService();
loreService.acceptLorebook({
  id:'moon-orchard',title:'Moon Orchard',
  discovery:{kind:'SillyTavernCurrentLorebook',source:'WORLD_INFO',name:'Moon Orchard'},
  entries:[{uid:'orchids',content:'Moon orchids open beneath violet rain beside the eastern glass canal.',metadata:{title:'Moon Orchids',treePath:['Orchard','Flora'],order:1}}],
  fullSnapshot:true,
});
loreService.runStudy();

const authoring=createLoreAuthoringService(loreService);
const invalidationContract=authoring.worker1InvalidationContract();
assert.equal(invalidationContract.kind,'LoreSourceRevisionRetrievalInvalidationContract');
assert.equal(invalidationContract.contractVersion,1);
assert.equal(invalidationContract.invalidationPlan.retrievalMustFenceSourceRevision,true);

const brain=new Area52NativeBrain({loreInterface:loreService.brainInterface(),memoryInterface:memorySurface});
const prepared=await brain.prepareTurn({
  chatId:'chat:owner-integration',turnId:'owner-integration:1',generationId:'gen:owner-integration:1',
  query:'Where do Moon orchids open beneath violet rain?',intent:'CURRENT',
  scene:scene('glass-canal',1,{location:'Eastern Glass Canal',activeCast:['Nemi']}),
  executionLabel:'DETERMINISTIC_CROSS_OWNER',
});
assert.ok(channels(prepared).has('OWNER_LORE'));
assert.match(JSON.stringify(prepared.promptPlan),/Moon orchids open beneath violet rain/i);
assert.ok(prepared.contextSealReceipt?.sealedState);

const learned=await brain.completeTurn({
  turnId:'owner-integration:1',
  response:'Nemi crosses the eastern glass canal and enters the Moon Orchard.',
  knownBy:['Nemi'],
  observations:[{subjectId:'Nemi',predicate:'location',value:'Moon Orchard',at:1}],
});
assert.equal(learned.memoryWriteback.status,'ADMITTED');
assert.equal(learned.memorySettlementReceipts.length,1);
assert.equal(learned.memorySettlementReceipts[0].status,'APPLIED');
assert.equal(learned.rawExperienceRecoverable,true);
const memoryCurrent=memoryProducer.currentProjection({includeStale:true});
assert.ok(memoryCurrent.some(row=>row.subjectId==='Nemi'&&row.predicate==='location'&&row.value==='Moon Orchard'));

const priorSourceRevisionId=brain.readTurn('owner-integration:1').experience.sourceRevisionId;
const corrected=brain.correctTurn({
  turnId:'owner-integration:1',
  response:'Correction: Nemi stays beside the eastern glass canal instead of entering the Moon Orchard.',
  knownBy:['Nemi'],
  observations:[{subjectId:'Nemi',predicate:'location',value:'Eastern Glass Canal',at:1}],
});
assert.equal(corrected.memoryWriteback.status,'ADMITTED');
assert.equal(corrected.memorySettlementReceipts.length,1);
assert.equal(corrected.memorySettlementReceipts[0].status,'APPLIED');
assert.notEqual(corrected.sourceRevisionId,priorSourceRevisionId);
const correctedProjection=memoryProducer.currentProjection({includeStale:true});
assert.ok(correctedProjection.some(row=>row.subjectId==='Nemi'&&row.predicate==='location'&&row.value==='Eastern Glass Canal'));

console.log('NATIVE_BRAIN_OWNER_INTEGRATION',JSON.stringify({
  pass:true,
  loreContract:invalidationContract.kind,
  loreChannel:'OWNER_LORE',
  memorySurface:memorySurface.kind,
  memoryWriteback:learned.memoryWriteback.status,
  memorySettlement:learned.memorySettlementReceipts[0].status,
  correctedMemorySettlement:corrected.memorySettlementReceipts[0].status,
  oldSourceRevisionActive:brain.core.registry.isActiveRevision(priorSourceRevisionId),
  contextSealed:Boolean(prepared.contextSealReceipt?.sealedState),
  externalDatabaseRequired:brain.diagnostics().nativeRequirements.externalDatabaseRequired,
  remoteModelRequired:brain.diagnostics().nativeRequirements.remoteModelRequired,
}));
