import test from 'node:test';
import assert from 'node:assert/strict';
import {Area52NativeBrain} from '../src/native-brain.js';
import {
  ResultClass,
  ResultDestination,
  ResultFreshness,
  ResultPayloadClass,
  createCognitiveResult,
} from '../src/publication-contracts.js';

function scene(sceneId,sceneRevision,{location=null,activeCast=[],activeThreads=[],relationship=null}={}){
  return{
    sceneId,sceneRevision,location,narrativeTime:'day '+sceneRevision,
    activeCast,activeThreads,objects:[],sceneRelationship:relationship,
    sourceRevisionRefs:[],provenance:['test-scene:'+sceneId+':'+sceneRevision],
  };
}

function slots(prepared){return new Set((prepared.promptPlan?.sections??[]).map(x=>x.slot));}
function channelIds(prepared){return new Set((prepared.candidateEnvelope?.candidates??[]).flatMap(c=>(c.channelNominations??[]).map(n=>n.channelId)));}

test('DETERMINISTIC: unrelated story retrieves accepted Lore, learns observed state, and later retrieves prior experience',async()=>{
  const brain=new Area52NativeBrain();
  brain.acceptLore({
    sourceId:'lore:cloudwhale',sourceType:'LORE_ENTRY',
    exactContent:'Cloudwhales build their nesting platforms above Aster Harbor during the blue-tide season.',
    semantic:{subjectId:'Cloudwhale',predicate:'nestingSite',value:'Aster Harbor'},
    metadata:{representationText:'Cloudwhales nest above Aster Harbor during blue-tide season.'},
  });

  const first=await brain.prepareTurn({
    chatId:'chat:aster',turnId:'aster:1',generationId:'gen:aster:1',
    query:'Where do Cloudwhales nest near Aster Harbor?',intent:'CURRENT',
    scene:scene('harbor-overlook',1,{location:'Aster Harbor',activeCast:['Rin']}),
    executionLabel:'DETERMINISTIC',
  });
  assert.ok(channelIds(first).has('NATIVE_LORE'));
  assert.ok(slots(first).has('RELEVANT_LORE'));
  assert.ok(first.contextSealReceipt?.sealedState);

  const learned=await brain.completeTurn({
    turnId:'aster:1',
    response:'Rin crosses the suspended bridge and enters Aster Harbor while Cloudwhales circle overhead.',
    knownBy:['Rin'],
    observations:[{subjectId:'Rin',predicate:'location',value:'Aster Harbor',at:1}],
  });
  assert.equal(learned.rawExperienceRecoverable,true);
  assert.ok(['ACCEPT_CURRENT','SUPERSEDE'].includes(learned.settlementDecisions[0]));

  const current=brain.currentWorldModel().current.find(x=>x.subjectId==='Rin'&&x.predicate==='location');
  assert.equal(current.value,'Aster Harbor');

  const second=await brain.prepareTurn({
    chatId:'chat:aster',turnId:'aster:2',generationId:'gen:aster:2',
    query:'What happened when Rin entered Aster Harbor?',intent:'HISTORICAL',
    scene:scene('harbor-market',2,{location:'Aster Harbor market',activeCast:['Rin'],relationship:'PRECEDES'}),
    executionLabel:'DETERMINISTIC',
  });
  assert.ok(channelIds(second).has('NATIVE_MEMORY'));
  assert.ok(slots(second).has('EPISODIC_MEMORY'));
  assert.match(JSON.stringify(second.promptPlan),/Rin crosses the suspended bridge/);
});

test('DETERMINISTIC: quiet continuation legitimately skips retrieval and expensive optional cognition',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({
    chatId:'chat:quiet',turnId:'quiet:1',generationId:'gen:quiet:1',query:'What is happening in the current scene?',
    scene:scene('tea-garden',1,{location:'Tea Garden',activeCast:['Aya']}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({turnId:'quiet:1',response:'Aya watches rain bead on the cedar rail.',knownBy:['Aya']});

  const quiet=await brain.prepareTurn({
    chatId:'chat:quiet',turnId:'quiet:2',generationId:'gen:quiet:2',query:'Continue.',
    executionLabel:'DETERMINISTIC',
  });
  assert.ok(quiet.used.paths.includes('HOT_ONLY'));
  assert.ok(quiet.skipped.skippedJobs.includes('RETRIEVAL'));
  assert.ok(quiet.skipped.skippedJobs.includes('JEV'));
  assert.ok(quiet.skipped.reasonCodes.includes('HOT_SUFFICIENT'));
});

test('DETERMINISTIC: source correction preserves history, invalidates old claim, and makes only corrected state current',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({
    chatId:'chat:cinder',turnId:'cinder:1',generationId:'gen:cinder:1',query:'Continue.',
    scene:scene('gate',1,{location:'South Gate',activeCast:['Tess']}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'cinder:1',response:'Tess steps into the South Gate courtyard.',knownBy:['Tess'],
    observations:[{subjectId:'Tess',predicate:'location',value:'South Gate',at:1}],
  });
  const before=brain.readTurn('cinder:1').experience;

  const correction=brain.correctTurn({
    turnId:'cinder:1',response:'Correction: Tess never entered the courtyard; she moved to the East Gate instead.',knownBy:['Tess'],
    observations:[{subjectId:'Tess',predicate:'location',value:'East Gate',at:1}],
  });
  assert.notEqual(correction.sourceRevisionId,before.sourceRevisionId);
  assert.ok(correction.invalidatedClaimIds.length>=1);
  assert.equal(correction.historyPreserved,true);
  const current=brain.currentWorldModel().current.filter(x=>x.subjectId==='Tess'&&x.predicate==='location');
  assert.equal(current.length,1);
  assert.equal(current[0].value,'East Gate');
  const history=brain.sourceHistory(before.sourceId);
  assert.equal(history.length,2);
  assert.match(brain.core.registry.getRevision(before.sourceRevisionId).exactContent,/South Gate courtyard/);
});

test('DETERMINISTIC: conflicting observed reports remain unresolved and optional Jev absence cannot choose a winner',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({
    chatId:'chat:roots',turnId:'roots:1',generationId:'gen:roots:1',query:'Enter the Root Court.',
    scene:scene('root-court',1,{location:'Root Court',activeCast:['Iona','Pell']}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'roots:1',
    response:'Two witnesses disagree: one says the Crown Seed was buried, while another says it was stolen north.',
    knownBy:['Iona','Pell'],
    observations:[
      {subjectId:'Crown Seed',predicate:'fate',value:'BURIED',at:10},
      {subjectId:'Crown Seed',predicate:'fate',value:'STOLEN_NORTH',at:10},
    ],
    reflections:[{statement:'The two witness accounts may be incompatible.',knownBy:['Iona','Pell'],confidence:.7}],
  });
  assert.equal(brain.currentWorldModel().current.some(x=>x.subjectId==='Crown Seed'&&x.predicate==='fate'),false);
  assert.equal(brain.currentWorldModel().unresolved.filter(x=>x.subjectId==='Crown Seed'&&x.predicate==='fate').length,2);

  const query=await brain.prepareTurn({
    chatId:'chat:roots',turnId:'roots:2',generationId:'gen:roots:2',
    query:'What is the current fate of the Crown Seed?',intent:'CURRENT',
    scene:scene('root-vault',2,{location:'Root Vault',activeCast:['Iona','Pell'],relationship:'PRECEDES'}),
    executionLabel:'DETERMINISTIC',
  });
  assert.ok(slots(query).has('UNRESOLVED_EVIDENCE'));
  assert.equal(query.skipped.jev?.unavailable,true);
  assert.equal(brain.currentWorldModel().current.some(x=>x.subjectId==='Crown Seed'&&x.predicate==='fate'),false);
});

test('DETERMINISTIC: character perspective fences private experience from native Memory and hot continuity',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({
    chatId:'chat:glass',turnId:'glass:1',generationId:'gen:glass:1',query:'Continue.',
    scene:scene('observatory',1,{location:'Observatory',activeCast:['Mira']}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'glass:1',response:'Mira hides the obsidian key behind the western star chart.',knownBy:['Mira'],
  });

  const pell=await brain.prepareTurn({
    chatId:'chat:glass',turnId:'glass:2',generationId:'gen:glass:2',
    query:'Where is the obsidian key hidden?',intent:'CURRENT',
    scene:scene('lower-hall',2,{location:'Lower Hall',activeCast:['Pell'],relationship:'PRECEDES'}),
    perspectiveConstraint:{scope:'CHARACTER_KNOWLEDGE',characterRef:'Pell'},
    executionLabel:'DETERMINISTIC',
  });
  const pellCandidateEvidence=JSON.stringify((pell.candidateEnvelope?.candidates??[]).map(candidate=>({representationText:candidate.representationText,metadata:candidate.metadata,evidenceRefs:candidate.evidenceRefs})));
  assert.doesNotMatch(pellCandidateEvidence,/obsidian key/i);
  assert.doesNotMatch(JSON.stringify(pell.promptPlan),/obsidian key/i);

  const mira=await brain.prepareTurn({
    chatId:'chat:glass',turnId:'glass:3',generationId:'gen:glass:3',
    query:'Where is the obsidian key hidden?',intent:'CURRENT',
    scene:scene('observatory-return',3,{location:'Observatory',activeCast:['Mira'],relationship:'PRECEDES'}),
    perspectiveConstraint:{scope:'CHARACTER_KNOWLEDGE',characterRef:'Mira'},
    executionLabel:'DETERMINISTIC',
  });
  assert.match(JSON.stringify(mira.candidateEnvelope),/obsidian key/i);
});

test('DETERMINISTIC: snapshot reload preserves source, truth, runtime state, and sealed-turn late-result fence',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({
    chatId:'chat:reload',turnId:'reload:1',generationId:'gen:reload:1',query:'Continue.',
    scene:scene('dock',1,{location:'Moon Dock',activeCast:['Nara']}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'reload:1',response:'Nara leaves the Moon Dock and enters the silver ferry.',knownBy:['Nara'],
    observations:[{subjectId:'Nara',predicate:'location',value:'Silver Ferry',at:1}],
  });
  const snapshot=brain.snapshot();
  const restored=Area52NativeBrain.fromSnapshot(snapshot);
  assert.equal(restored.currentWorldModel().current.find(x=>x.subjectId==='Nara'&&x.predicate==='location').value,'Silver Ferry');
  assert.equal(restored.core.publication.seal.isTurnSealed('reload:1'),true);
  assert.equal(restored.readTurn('reload:1').learningReceipt.rawExperienceRecoverable,true);

  const turn=restored.readTurn('reload:1');
  const late=createCognitiveResult({
    id:'late:reload:1',taskId:'late-task',turnId:'reload:1',correlationId:turn.correlationId,
    sourceSubsystem:'OPTIONAL_TEST',destinationOwner:'CONTEXT',resultType:'OPTIONAL_LATE',
    resultClass:ResultClass.OPPORTUNISTIC,payloadClass:ResultPayloadClass.DERIVED_DATA,
    evidenceIds:[],provenance:{},sourceRevisionIds:[],worldRevision:turn.worldRevision,sceneRevision:turn.sceneRevision,
    authorityClass:'UNRESOLVED',destination:ResultDestination.FOREGROUND,payload:{text:'must not enter sealed generation'},
    freshness:ResultFreshness.FRESH,
  });
  const routed=restored.receiveCognitiveResult(late);
  assert.equal(routed.route.late,true);
  assert.notEqual(routed.route.effectiveDestination,ResultDestination.FOREGROUND);
  assert.equal(restored.core.publication.seal.isTurnSealed('reload:1'),true);
});

test('DETERMINISTIC: interrupted native feedback work survives reload and completes without duplicate publication',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({
    chatId:'chat:resume',turnId:'resume:1',generationId:'gen:resume:1',query:'Continue.',
    scene:scene('bridge',1,{location:'Old Bridge',activeCast:['Sol']}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({turnId:'resume:1',response:'Sol pauses midway across the Old Bridge.',knownBy:['Sol'],autoDrain:false});
  assert.equal(brain.readTurn('resume:1').feedback,null);
  const restored=Area52NativeBrain.fromSnapshot(brain.snapshot());
  await restored.runtimeDirector.drain({maxCycles:128});
  const after=restored.readTurn('resume:1');
  assert.ok(after.feedback);
  const receipts=restored.feedback.turns.filter(x=>x.turnId==='resume:1');
  assert.equal(receipts.length,1);
});


test('HOST-CONTRACT: runTurn delivers sealed context to generation callback and learns the returned narrative',async()=>{
  const brain=new Area52NativeBrain();
  let hostCall=null;
  const result=await brain.runTurn({
    chatId:'chat:host',turnId:'host:1',generationId:'gen:host:1',query:'Continue from the lantern quay.',
    scene:scene('lantern-quay',1,{location:'Lantern Quay',activeCast:['Sera']}),
    executionLabel:'HOST_CONTRACT',
  },{
    generate:async(rendered,meta)=>{
      hostCall={rendered,meta};
      return 'Sera leaves Lantern Quay and enters the tide archive.';
    },
    completeOptions:{
      knownBy:['Sera'],
      observations:[{subjectId:'Sera',predicate:'location',value:'Tide Archive',at:1}],
    },
  });
  assert.ok(hostCall);
  assert.equal(hostCall.meta.selection.chatId,'chat:host');
  assert.equal(hostCall.meta.selection.generationId,'gen:host:1');
  assert.ok(hostCall.meta.contextSealReceipt?.sealedState);
  assert.ok(result.prepared.promptPlan?.promptPlanId);
  assert.equal(result.learning.rawExperienceRecoverable,true);
  assert.equal(brain.currentWorldModel().current.find(x=>x.subjectId==='Sera'&&x.predicate==='location').value,'Tide Archive');
});

test('DETERMINISTIC: Worker 4 Lore Brain interface drillback feeds native retrieval without importing authority',async()=>{
  const loreInterface={
    kind:'LoreBrainRetrievalInterface',contractVersion:1,
    query:()=>({
      kind:'LoreBrainRetrievalPacket',contractVersion:1,query:'skywhales',intent:'AUTO',
      retrievalIntentId:'lore-intent:1',indexRevision:'idx:7',ontologyRevision:'ontology:3',
      sourceRevisionFence:['lore:skywhales@r7'],
      nominations:[{nomination:{nominationId:'lore:n1'},drillback:[{
        sourceId:'lore:skywhales',sourceRevisionId:'lore:skywhales@r7',
        exactAuthoredText:'Skywhales return to the Lantern Reefs when the violet tide rises.',
        representationRef:'source:lore:skywhales@r7',provenance:[{kind:'LoreRetrievalProvenance',sourceRevisionId:'lore:skywhales@r7'}],
      }]}],
      thematicCommunities:[],summaries:[],conflicts:[],provenanceRequired:true,
      exactSourceDrillbackAvailable:true,candidateBusAdmissionAuthority:false,truthGateAuthority:false,
      settlementAuthority:false,contextSealAuthority:false,
    }),
  };
  const brain=new Area52NativeBrain({loreInterface});
  const prepared=await brain.prepareTurn({
    chatId:'chat:lore-contract',turnId:'lore-contract:1',generationId:'gen:lore-contract:1',
    query:'When do Skywhales return to the Lantern Reefs?',intent:'CURRENT',
    scene:scene('reef-watch',1,{location:'Lantern Reefs',activeCast:['Orr']}),
    executionLabel:'DETERMINISTIC',
  });
  assert.equal(prepared.loreSync.status,'SYNCED');
  assert.equal(prepared.loreSync.admitted,1);
  assert.ok(prepared.selection.ownerSourceRevisionRefs.includes('lore:skywhales@r7'));
  assert.ok(channelIds(prepared).has('NATIVE_LORE'));
  assert.ok(slots(prepared).has('RELEVANT_LORE'));
  const loreRow=brain.knowledge.currentRecordForSource('lore:skywhales');
  assert.equal(loreRow.evidence.authorityClass,'SOURCE_CANON');
  assert.equal(loreRow.evidence.extensions.metadata.externalSourceRevisionId,'lore:skywhales@r7');
  assert.equal(prepared.loreSync.authorityGranted,false);
});

test('DETERMINISTIC: correcting narrative evidence fences dependent reflections from future retrieval',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({
    chatId:'chat:reflection-fence',turnId:'reflection-fence:1',generationId:'gen:reflection-fence:1',query:'Continue.',
    scene:scene('old-bridge',1,{location:'Old Bridge',activeCast:['Sol']}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'reflection-fence:1',response:'Sol studies a crack in the Old Bridge.',knownBy:['Sol'],
    reflections:[{statement:'Sol believes the Old Bridge will collapse before dawn.',knownBy:['Sol'],confidence:.6}],
  });
  const prior=brain.readTurn('reflection-fence:1').experience.sourceRevisionId;
  brain.correctTurn({
    turnId:'reflection-fence:1',response:'Correction: Sol saw no structural crack in the Old Bridge.',knownBy:['Sol'],
  });
  assert.equal(brain.core.registry.isActiveRevision(prior),false);
  const prepared=await brain.prepareTurn({
    chatId:'chat:reflection-fence',turnId:'reflection-fence:2',generationId:'gen:reflection-fence:2',
    query:'What does Sol believe about the Old Bridge?',intent:'HISTORICAL',
    scene:scene('old-bridge-dawn',2,{location:'Old Bridge',activeCast:['Sol'],relationship:'PRECEDES'}),
    perspectiveConstraint:{scope:'CHARACTER_KNOWLEDGE',characterRef:'Sol'},
    executionLabel:'DETERMINISTIC',
  });
  const representations=(prepared.candidateEnvelope?.candidates??[]).map(x=>x.representationText??'').join('\n');
  assert.doesNotMatch(representations,/will collapse before dawn/i);
});


test('DETERMINISTIC: Worker 3 live-binding surface exposes coherent selection and typed owner receipts',async()=>{
  const brain=new Area52NativeBrain();
  const bindings=brain.uiBindings(),events=[];
  const release=bindings.subscribe(event=>events.push(event));
  const prepared=await brain.prepareTurn({
    chatId:'chat:ui-bind',turnId:'ui-bind:1',generationId:'gen:ui-bind:1',correlationId:'corr:ui-bind:1',
    query:'Continue quietly.',scene:scene('quiet-room',1,{location:'Quiet Room',activeCast:['Aya']}),
    executionLabel:'DETERMINISTIC',
  });
  const selection=bindings.readSelection({chatId:'chat:ui-bind'});
  assert.equal(selection.turnId,'ui-bind:1');
  assert.equal(selection.generationId,'gen:ui-bind:1');
  assert.equal(bindings.readContextSeal(selection).turnId,'ui-bind:1');
  assert.equal(bindings.readPromptPlan(selection).generationId,'gen:ui-bind:1');
  assert.equal(bindings.readCandidateBusEnvelope(selection).kind,'CandidateBusEnvelope');
  assert.ok(bindings.readTruth(selection));
  assert.ok(bindings.readGather(selection));
  assert.equal(bindings.listGenerations({selection:{chatId:'chat:ui-bind'}}).length,1);
  assert.equal(bindings.readGeneration({generationId:'gen:ui-bind:1',chatId:'chat:ui-bind'}).contextSeal.turnId,'ui-bind:1');
  await brain.completeTurn({turnId:'ui-bind:1',response:'Aya listens to the rain.',knownBy:['Aya']});
  release();
  assert.ok(events.some(event=>event.stage==='TURN_PREPARED'));
  assert.ok(events.some(event=>event.stage==='TURN_LEARNED'));
  assert.ok(events.every(event=>event.rawPromptIncluded===false&&event.rawResponseIncluded===false));
  assert.equal(prepared.selection.chatId,'chat:ui-bind');
});
