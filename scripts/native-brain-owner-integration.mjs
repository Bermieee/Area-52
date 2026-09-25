import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Area52NativeBrain} from '../src/native-brain.js';

function scene(sceneId,sceneRevision,{location=null,activeCast=[],relationship=null}={}){
  return{sceneId,sceneRevision,location,narrativeTime:'day '+sceneRevision,activeCast,activeThreads:[],objects:[],sceneRelationship:relationship,sourceRevisionRefs:[],provenance:['owner-integration:'+sceneId+':'+sceneRevision]};
}
function channels(prepared){return new Set((prepared.candidateEnvelope?.candidates??[]).flatMap(row=>(row.channelNominations??[]).map(n=>n.channelId)));}
function externalModule(root,path){return import(pathToFileURL(resolve(root,path)).href);}
function tracePrepared(label,prepared){
  return{
    label,
    turnId:prepared.selection.turnId,
    sceneRevision:prepared.selection.sceneRevision,
    worldRevision:prepared.selection.worldRevision,
    ownerSourceRevisionRefs:[...prepared.selection.ownerSourceRevisionRefs],
    admittedJobs:[...prepared.used.admittedJobs],
    skippedJobs:[...prepared.skipped.skippedJobs],
    paths:[...prepared.used.paths],
    truth:prepared.truthAssessment?.status??prepared.truthAssessment?.overallStatus??null,
    sealId:prepared.contextSealReceipt?.id??null,
    sealed:Boolean(prepared.contextSealReceipt?.sealedState),
    lore:prepared.loreSync?.status??null,
    memory:prepared.memorySync?.status??null,
  };
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
const rawMemorySurface=createMemoryIntegrationSurface(memoryProducer);
let memoryQueries=0;
const memorySurface={
  ...rawMemorySurface,
  adapters:{
    ...rawMemorySurface.adapters,
    queryHistorian:(request)=>{memoryQueries++;return rawMemorySurface.adapters.queryHistorian(request);},
  },
};
const loreService=new LoreIntelligenceService();
const firstLore=loreService.acceptLorebook({
  id:'moon-orchard',title:'Moon Orchard',
  discovery:{kind:'SillyTavernCurrentLorebook',source:'WORLD_INFO',name:'Moon Orchard'},
  entries:[
    {uid:'orchids',content:'Moon orchids open beneath violet rain beside the eastern glass canal.',metadata:{title:'Moon Orchids',treePath:['Orchard','Flora'],order:1}},
    {uid:'bells',content:'The eastern glass canal bells ring twice at noon.',metadata:{title:'Canal Bells',treePath:['Orchard','Customs'],order:2}},
  ],
  fullSnapshot:true,
});
loreService.runStudy();

const authoring=createLoreAuthoringService(loreService);
const invalidationContract=authoring.worker1InvalidationContract();
assert.equal(invalidationContract.kind,'LoreSourceRevisionRetrievalInvalidationContract');
assert.equal(invalidationContract.contractVersion,2);
assert.equal(invalidationContract.invalidationPlan.retrievalMustFenceSourceRevision,true);
assert.ok(invalidationContract.revisionChangeEvent.requiredFields.includes('settlementId'));
assert.ok(invalidationContract.revisionChangeEvent.requiredFields.includes('sourceState'));
assert.equal(invalidationContract.invalidationReceipt.unrelatedSourceArtifactsRemainReusable,true);

const rawLoreInterface=loreService.brainInterface();
let loreQueries=0;
const loreInterface={
  ...rawLoreInterface,
  query:(request)=>{loreQueries++;return rawLoreInterface.query(request);},
};
let brain=new Area52NativeBrain({loreInterface,memoryInterface:memorySurface});
const trace=[];

// 1. New scene: exact Lore reaches the sealed generation callback, then exact narrative is learned.
let generationPayload=null;
const first=await brain.runTurn({
  chatId:'chat:owner-integration',turnId:'owner-integration:1',generationId:'gen:owner-integration:1',
  query:'Where do Moon orchids open beneath violet rain?',intent:'CURRENT',
  scene:scene('glass-canal',1,{location:'Eastern Glass Canal',activeCast:['Nemi']}),
  executionLabel:'DETERMINISTIC_CROSS_OWNER',
},{
  generate:async(rendered,meta)=>{generationPayload={rendered,meta};return'Nemi crosses the eastern glass canal and enters the Moon Orchard.';},
  completeOptions:{knownBy:['Nemi'],observations:[{subjectId:'Nemi',predicate:'location',value:'Moon Orchard',at:1}]},
});
trace.push(tracePrepared('new-scene',first.prepared));
assert.ok(channels(first.prepared).has('OWNER_LORE'));
assert.match(JSON.stringify(first.prepared.promptPlan),/Moon orchids open beneath violet rain/i);
assert.ok(first.prepared.contextSealReceipt?.sealedState);
assert.match(JSON.stringify(generationPayload?.rendered),/Moon orchids open beneath violet rain/i);
assert.equal(generationPayload?.meta?.contextSealReceipt?.id,first.prepared.contextSealReceipt.id);
assert.equal(first.learning.memoryWriteback.status,'ADMITTED');
assert.equal(first.learning.memorySettlementReceipts[0].status,'APPLIED');
assert.equal(first.learning.rawExperienceRecoverable,true);
assert.ok(memoryProducer.currentProjection({includeStale:true}).some(row=>row.subjectId==='Nemi'&&row.predicate==='location'&&row.value==='Moon Orchard'));

// 2. Quiet continuation: Hot Cognition is sufficient; owner retrieval does not run.
const beforeQuiet={loreQueries,memoryQueries};
const quiet=await brain.runTurn({
  chatId:'chat:owner-integration',turnId:'owner-integration:2',generationId:'gen:owner-integration:2',
  query:'Continue.',executionLabel:'DETERMINISTIC_CROSS_OWNER',
},{
  generate:async()=> 'Nemi listens to rain ticking against the orchard glass.',
  completeOptions:{knownBy:['Nemi']},
});
trace.push(tracePrepared('quiet-turn',quiet.prepared));
assert.ok(quiet.prepared.used.paths.includes('HOT_ONLY'));
assert.equal(quiet.prepared.loreSync.status,'SKIPPED');
assert.equal(quiet.prepared.memorySync.status,'SKIPPED');
assert.deepEqual({loreQueries,memoryQueries},beforeQuiet);

// 3. Relevant recall: real Memory Historian/drilldown re-enters through Candidate Bus.
const recall=await brain.prepareTurn({
  chatId:'chat:owner-integration',turnId:'owner-integration:3',generationId:'gen:owner-integration:3',
  query:'Where did Nemi go after crossing the eastern glass canal?',intent:'HISTORICAL',
  scene:scene('orchard-archive',2,{location:'Moon Orchard Archive',activeCast:['Nemi'],relationship:'PRECEDES'}),
  executionLabel:'DETERMINISTIC_CROSS_OWNER',
});
trace.push(tracePrepared('relevant-recall',recall));
assert.equal(recall.memorySync.status,'SYNCED');
assert.ok(channels(recall).has('OWNER_MEMORY'));
assert.match(JSON.stringify(recall.promptPlan),/Moon Orchard/i);
await brain.completeTurn({turnId:'owner-integration:3',response:'Nemi remembers entering the Moon Orchard from the eastern glass canal.',knownBy:['Nemi']});

// 4. Conflicting observed evidence stays unresolved; optional Jev is not required to pick a winner.
const conflict=await brain.runTurn({
  chatId:'chat:owner-integration',turnId:'owner-integration:4',generationId:'gen:owner-integration:4',
  query:'Two witnesses disagree about the tide bell.',intent:'CURRENT',
  scene:scene('tide-bell',3,{location:'Tide Bell Court',activeCast:['Nemi','Vale'],relationship:'PRECEDES'}),
  executionLabel:'DETERMINISTIC_CROSS_OWNER',
},{
  generate:async()=> 'One witness says the tide bell rang; another insists it stayed silent.',
  completeOptions:{
    knownBy:['Nemi','Vale'],
    observations:[
      {subjectId:'Tide Bell',predicate:'state',value:'RANG',at:10},
      {subjectId:'Tide Bell',predicate:'state',value:'SILENT',at:10},
    ],
  },
});
trace.push(tracePrepared('conflicting-evidence',conflict.prepared));
assert.equal(brain.currentWorldModel().current.some(row=>row.subjectId==='Tide Bell'&&row.predicate==='state'),false);
assert.equal(brain.currentWorldModel().unresolved.filter(row=>row.subjectId==='Tide Bell'&&row.predicate==='state').length,2);

// 5. Worker 4 authored correction is distrusted immediately and admitted only after fresh exact-source retrieval.
const oldOrchid=firstLore.changes.find(row=>row.uid==='orchids');
const edited=loreService.acceptLorebook({
  id:'moon-orchard',title:'Moon Orchard',
  discovery:{kind:'SillyTavernCurrentLorebook',source:'WORLD_INFO',name:'Moon Orchard'},
  entries:[
    {uid:'orchids',content:'Correction: Moon orchids open only beneath silver rain beside the western glass canal.',metadata:{title:'Moon Orchids',treePath:['Orchard','Flora'],order:1}},
    {uid:'bells',content:'The eastern glass canal bells ring twice at noon.',metadata:{title:'Canal Bells',treePath:['Orchard','Customs'],order:2}},
  ],
  fullSnapshot:true,
});
const orchidChange=edited.changes.find(row=>row.uid==='orchids');
assert.ok(orchidChange.changed);
assert.equal(orchidChange.previousSourceRevisionId,oldOrchid.sourceRevisionId);
const revisionReceipt=brain.acceptLoreRevisionChange({
  kind:'LoreSourceRevisionChanged',
  sourceId:orchidChange.sourceId,lorebookId:'moon-orchard',uid:'orchids',
  previousSourceRevisionId:orchidChange.previousSourceRevisionId,
  sourceRevisionId:orchidChange.sourceRevisionId,
  contentHash:orchidChange.exactContentHash,
});
assert.equal(revisionReceipt.nextRevisionTrusted,false);
assert.equal(brain.core.isSourceRevisionCurrent(orchidChange.previousSourceRevisionId),false);
loreService.runStudy();

const revisedLore=await brain.prepareTurn({
  chatId:'chat:owner-integration',turnId:'owner-integration:5',generationId:'gen:owner-integration:5',
  query:'Under what rain do Moon orchids open now?',intent:'CURRENT',
  scene:scene('western-canal',4,{location:'Western Glass Canal',activeCast:['Nemi'],relationship:'PRECEDES'}),
  executionLabel:'DETERMINISTIC_CROSS_OWNER',
});
trace.push(tracePrepared('authored-lore-correction',revisedLore));
assert.equal(revisedLore.selection.ownerSourceRevisionRefs.includes(orchidChange.previousSourceRevisionId),false);
assert.ok(revisedLore.selection.ownerSourceRevisionRefs.includes(orchidChange.sourceRevisionId));
assert.doesNotMatch(JSON.stringify(revisedLore.promptPlan),/violet rain beside the eastern/i);
assert.match(JSON.stringify(revisedLore.promptPlan),/silver rain beside the western/i);
assert.ok(brain.diagnostics().loreRevisionTrust.trusted.includes(orchidChange.sourceId));
await brain.completeTurn({turnId:'owner-integration:5',response:'Nemi reads the corrected orchid record.',knownBy:['Nemi']});

// 6. Perspective limit: Nemi-only exact experience is not exposed to Vale.
const privateTurn=await brain.runTurn({
  chatId:'chat:owner-integration',turnId:'owner-integration:6',generationId:'gen:owner-integration:6',
  query:'Nemi checks the sealed drawer.',intent:'CURRENT',
  scene:scene('sealed-drawer',5,{location:'Orchard Archive',activeCast:['Nemi'],relationship:'PRECEDES'}),
  executionLabel:'DETERMINISTIC_CROSS_OWNER',
},{
  generate:async()=> 'Nemi privately hides the cobalt sigil behind the west archive ledger.',
  completeOptions:{knownBy:['Nemi']},
});
trace.push(tracePrepared('private-experience',privateTurn.prepared));
const vale=await brain.prepareTurn({
  chatId:'chat:owner-integration',turnId:'owner-integration:7',generationId:'gen:owner-integration:7',
  query:'Where is the cobalt sigil?',intent:'HISTORICAL',
  scene:scene('vale-archive',6,{location:'Orchard Archive',activeCast:['Vale'],relationship:'PRECEDES'}),
  perspectiveConstraint:{scope:'CHARACTER_KNOWLEDGE',characterRef:'Vale'},
  executionLabel:'DETERMINISTIC_CROSS_OWNER',
});
trace.push(tracePrepared('perspective-limit',vale));
assert.doesNotMatch(JSON.stringify((vale.promptPlan?.sections??[]).filter(section=>section.slot!=='USER_INPUT')),/cobalt sigil behind the west archive ledger/i);
await brain.completeTurn({turnId:'owner-integration:7',response:'Vale finds no reliable evidence about the sigil.',knownBy:['Vale']});

// 7. Reload: Core/Hot/Seal/learning and Lore revision distrust/trust state restore; real owners stay attached.
const snapshot=brain.snapshot();
brain=Area52NativeBrain.fromSnapshot(snapshot,{loreInterface,memoryInterface:memorySurface});
assert.equal(brain.core.publication.seal.isTurnSealed('owner-integration:6'),true);
assert.ok(brain.diagnostics().loreRevisionTrust.trusted.includes(orchidChange.sourceId));
const afterReload=await brain.prepareTurn({
  chatId:'chat:owner-integration',turnId:'owner-integration:8',generationId:'gen:owner-integration:8',
  query:'What is current orchid lore and what happened earlier?',intent:'HISTORICAL',
  scene:scene('reload-orchard',7,{location:'Moon Orchard',activeCast:['Nemi'],relationship:'PRECEDES'}),
  perspectiveConstraint:{scope:'CHARACTER_KNOWLEDGE',characterRef:'Nemi'},
  executionLabel:'DETERMINISTIC_CROSS_OWNER',
});
trace.push(tracePrepared('reload',afterReload));
assert.equal(afterReload.selection.ownerSourceRevisionRefs.includes(orchidChange.previousSourceRevisionId),false);
assert.match(JSON.stringify(afterReload.promptPlan),/silver rain|Moon Orchard/i);
assert.ok(afterReload.contextSealReceipt?.sealedState);

const memoryCurrent=memoryProducer.currentProjection({includeStale:true});
assert.ok(memoryCurrent.some(row=>row.subjectId==='Nemi'&&row.predicate==='location'&&row.value==='Moon Orchard'));
assert.equal(brain.diagnostics().nativeRequirements.remoteModelRequired,false);
assert.equal(brain.diagnostics().nativeRequirements.externalDatabaseRequired,false);

console.log('NATIVE_BRAIN_OWNER_INTEGRATION',JSON.stringify({
  pass:true,
  evidenceClass:'DETERMINISTIC',
  hostContract:true,
  live:false,
  loreContract:invalidationContract.kind,
  memorySurface:rawMemorySurface.kind,
  loreQueries,
  memoryQueries,
  trace,
  world:{current:brain.currentWorldModel().current.length,historical:brain.currentWorldModel().historical.length,unresolved:brain.currentWorldModel().unresolved.length},
  memory:{currentProjection:memoryCurrent.length,revisionRefs:memoryProducer.memoryRevisionRefs().length},
  correction:{previousSourceRevisionId:orchidChange.previousSourceRevisionId,sourceRevisionId:orchidChange.sourceRevisionId,trusted:brain.diagnostics().loreRevisionTrust.trusted.includes(orchidChange.sourceId)},
  nativeRequirements:brain.diagnostics().nativeRequirements,
}));
