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
  const pellContextSections=JSON.stringify((pell.promptPlan?.sections??[]).filter(section=>section.slot!=='USER_INPUT'));
  assert.doesNotMatch(pellContextSections,/obsidian key/i);

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
  const sealedHashBefore=restored.core.publication.seal.getReceipt('reload:1').packetHash;
  const late=createCognitiveResult({
    id:'late:reload:1',taskId:'late-task',turnId:'reload:1',correlationId:turn.correlationId,
    sourceSubsystem:'JEV_SIDECAR',destinationOwner:'CONTEXT',resultType:'JEV_LATE',
    resultClass:ResultClass.OPPORTUNISTIC,payloadClass:ResultPayloadClass.DERIVED_DATA,
    evidenceIds:[],provenance:{},sourceRevisionIds:[],worldRevision:turn.worldRevision,sceneRevision:turn.sceneRevision,
    authorityClass:'UNRESOLVED',destination:ResultDestination.FOREGROUND,payload:{text:'must not enter sealed generation'},
    freshness:ResultFreshness.FRESH,
  });
  const routed=restored.receiveCognitiveResult(late);
  assert.equal(routed.route.late,true);
  assert.notEqual(routed.route.effectiveDestination,ResultDestination.FOREGROUND);
  assert.equal(restored.core.publication.seal.isTurnSealed('reload:1'),true);
  assert.equal(restored.core.publication.seal.getReceipt('reload:1').packetHash,sealedHashBefore);
  assert.doesNotMatch(JSON.stringify(restored.core.publication.seal.getPacket('reload:1')),/must not enter sealed generation/i);
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

test('DETERMINISTIC: Worker 4 Lore Brain interface stays owner-native and revision-fenced',async()=>{
  let ownerRevision={id:'lore:skywhales@r7',state:'CURRENT',exactContent:'Skywhales return to the Lantern Reefs when the violet tide rises.'};
  let loreQueries=0,fenceEnabled=true;
  const loreInterface={
    kind:'LoreBrainRetrievalInterface',contractVersion:1,
    sourceRevision:()=>structuredClone(ownerRevision),
    query:()=>{
      loreQueries++;
      const active=ownerRevision.state!=='REMOVED';
      return{
        kind:'LoreBrainRetrievalPacket',contractVersion:1,query:'skywhales',intent:'AUTO',
        retrievalIntentId:'lore-intent:'+loreQueries,indexRevision:'idx:'+loreQueries,ontologyRevision:'ontology:3',
        sourceRevisionFence:active&&fenceEnabled?[ownerRevision.id]:[],
        nominations:active?[{nomination:{nominationId:'lore:n'+loreQueries},drillback:[{
          sourceId:'lore:skywhales',sourceRevisionId:ownerRevision.id,
          exactAuthoredText:ownerRevision.exactContent,
          representationRef:'source:'+ownerRevision.id,selectedRepresentation:{representationRevision:loreQueries},
          provenance:[{kind:'LoreRetrievalProvenance',sourceRevisionId:ownerRevision.id}],
        }]}]:[],
        thematicCommunities:[],summaries:[],conflicts:[],provenanceRequired:true,
        exactSourceDrillbackAvailable:true,candidateBusAdmissionAuthority:false,truthGateAuthority:false,
        settlementAuthority:false,contextSealAuthority:false,
      };
    },
  };
  const brain=new Area52NativeBrain({loreInterface});
  const prepared=await brain.prepareTurn({
    chatId:'chat:lore-contract',turnId:'lore-contract:1',generationId:'gen:lore-contract:1',
    query:'When do Skywhales return to the Lantern Reefs?',intent:'CURRENT',
    scene:scene('reef-watch',1,{location:'Lantern Reefs',activeCast:['Orr']}),
    executionLabel:'DETERMINISTIC',
  });
  assert.equal(prepared.loreSync.status,'SYNCED');
  assert.equal(prepared.loreSync.nominationCount,1);
  assert.ok(prepared.selection.ownerSourceRevisionRefs.includes('lore:skywhales@r7'));
  assert.ok(channelIds(prepared).has('OWNER_LORE'));
  assert.ok(slots(prepared).has('RELEVANT_LORE'));
  assert.equal(brain.knowledge.currentRecordForSource('lore:skywhales'),null);
  assert.equal(brain.core.registry.getRevision('lore:skywhales@r7'),null);
  assert.equal(prepared.loreSync.authorityGranted,false);

  ownerRevision={id:'lore:skywhales@r8',state:'CURRENT',exactContent:'Skywhales return to the Lantern Reefs only when the silver moon follows the violet tide.'};
  const revised=await brain.prepareTurn({
    chatId:'chat:lore-contract',turnId:'lore-contract:2',generationId:'gen:lore-contract:2',
    query:'When do Skywhales return?',intent:'CURRENT',
    scene:scene('reef-watch-night',2,{location:'Lantern Reefs',activeCast:['Orr'],relationship:'PRECEDES'}),executionLabel:'DETERMINISTIC',
  });
  assert.ok(revised.selection.ownerSourceRevisionRefs.includes('lore:skywhales@r8'));
  assert.equal(revised.selection.ownerSourceRevisionRefs.includes('lore:skywhales@r7'),false);
  assert.match(JSON.stringify(revised.promptPlan),/silver moon/i);
  assert.equal(brain.core.registry.getRevision('lore:skywhales@r8'),null);

  fenceEnabled=false;
  const unfenced=await brain.prepareTurn({
    chatId:'chat:lore-contract',turnId:'lore-contract:3',generationId:'gen:lore-contract:3',
    query:'When do Skywhales return?',intent:'CURRENT',
    scene:scene('reef-watch-fog',3,{location:'Lantern Reefs',activeCast:['Orr'],relationship:'PRECEDES'}),executionLabel:'DETERMINISTIC',
  });
  assert.equal(unfenced.loreSync.nominationCount,0);
  assert.equal(channelIds(unfenced).has('OWNER_LORE'),false);
  assert.equal(unfenced.selection.ownerSourceRevisionRefs.includes('lore:skywhales@r8'),false);

  fenceEnabled=true;
  ownerRevision={id:'lore:skywhales@r9',state:'REMOVED',exactContent:null};
  const removed=await brain.prepareTurn({
    chatId:'chat:lore-contract',turnId:'lore-contract:4',generationId:'gen:lore-contract:4',
    query:'Where are the Skywhales?',intent:'CURRENT',
    scene:scene('empty-reef',4,{location:'Lantern Reefs',activeCast:['Orr'],relationship:'PRECEDES'}),executionLabel:'DETERMINISTIC',
  });
  assert.equal(removed.loreSync.nominationCount,0);
  assert.equal(removed.selection.ownerSourceRevisionRefs.includes('lore:skywhales@r8'),false);
  assert.equal(channelIds(removed).has('OWNER_LORE'),false);
});

test('DETERMINISTIC: Worker 4 Lore revision event invalidates stale owner evidence before the next generation',async()=>{
  let revision='lore:reef-law@r1',text='The reef gate opens only at dawn.';
  const loreInterface={
    kind:'LoreBrainRetrievalInterface',contractVersion:1,
    query:()=>({kind:'LoreBrainRetrievalPacket',contractVersion:1,indexRevision:'idx:'+revision,ontologyRevision:'onto:1',sourceRevisionFence:[revision],nominations:[{drillback:[{sourceId:'lore:reef-law',sourceRevisionId:revision,exactAuthoredText:text,representationRef:'source:'+revision,selectedRepresentation:{representationRevision:1},provenance:[{sourceRevisionId:revision}]}]}]}),
  };
  const brain=new Area52NativeBrain({loreInterface});
  const first=await brain.prepareTurn({
    chatId:'chat:lore-invalidation',turnId:'lore-invalidation:1',generationId:'gen:lore-invalidation:1',
    query:'When does the reef gate open?',intent:'CURRENT',scene:scene('reef-gate',1,{location:'Reef Gate',activeCast:['Vale']}),executionLabel:'DETERMINISTIC',
  });
  assert.match(JSON.stringify(first.promptPlan),/only at dawn/i);
  await brain.completeTurn({turnId:'lore-invalidation:1',response:'Vale waits beside the reef gate.',knownBy:['Vale']});

  const invalidation=brain.acceptLoreRevisionChange({
    kind:'LoreSourceRevisionChanged',sourceId:'lore:reef-law',lorebookId:'reef-laws',uid:'gate-hours',
    previousSourceRevisionId:'lore:reef-law@r1',sourceRevisionId:'lore:reef-law@r2',contentHash:'hash:r2',
  });
  assert.equal(invalidation.status,'INVALIDATED');
  assert.equal(invalidation.nextRevisionTrusted,false);
  assert.ok(invalidation.checkedChats.includes('chat:lore-invalidation'));

  revision='lore:reef-law@r2';text='The reef gate now opens only at moonrise.';
  const next=await brain.prepareTurn({
    chatId:'chat:lore-invalidation',turnId:'lore-invalidation:2',generationId:'gen:lore-invalidation:2',
    query:'When does the reef gate open now?',intent:'CURRENT',executionLabel:'DETERMINISTIC',
  });
  assert.equal(next.selection.ownerSourceRevisionRefs.includes('lore:reef-law@r1'),false);
  assert.ok(next.selection.ownerSourceRevisionRefs.includes('lore:reef-law@r2'));
  assert.doesNotMatch(JSON.stringify(next.promptPlan),/only at dawn/i);
  assert.match(JSON.stringify(next.promptPlan),/only at moonrise/i);
});

test('DETERMINISTIC: MemoryIntegrationSurface nominations flow through Candidate Bus and quiet turns do not call Historian',async()=>{
  let memoryQueries=0;
  const writebacks=[],invalidations=[],settlementMirrors=[];
  let memoryRevision='memory:glass-coast@r1';
  let memoryText='Earlier, Lio crossed the moonrail bridge into Bellspire Station.';
  const exactRow=()=>({id:'memory-exact:'+memoryRevision,sourceRevisionId:memoryRevision,exactContent:memoryText,knownBy:['Lio'],metadata:{chatId:'chat:memory-owner'}});
  const memoryInterface={
    kind:'MemoryIntegrationSurface',contractVersion:'1.0.0',
    adapters:{
      queryHistorian(request){
        memoryQueries++;
        return{
          kind:'HistorianQueryResult',status:'OK',historianRevision:'historian:'+memoryQueries,
          nominations:[{
            kind:'CandidateNomination',candidateId:'memory-candidate:'+memoryRevision,evidenceIdentity:'memory-experience:l-bridge',
            artifactRef:{artifactId:'episode:l-bridge',artifactType:'Episode',revision:memoryQueries},artifactRevision:memoryQueries,
            sourceRevisionRefs:[memoryRevision],claimRefs:[],eventRefs:['event:l-bridge'],entityRefs:['Lio','Bellspire Station'],relationshipRefs:[],
            rankSignals:{intentMatch:1,recency:.8},normalizedRank:.95,temporalHints:[{status:'HISTORICAL'}],continuitySignals:[],
            authorityClass:'OBSERVED',truthStatusHint:'HISTORICAL',provenance:[{ref:memoryRevision}],evidenceRefs:[exactRow().id],dependencyRevisions:[],
            representationRef:'episode:l-bridge',representationRevision:memoryQueries,representationText:memoryText,
            metadata:{historianChannel:'EPISODIC_MEMORY',perspective:request.perspectiveConstraint??{scope:'WORLD'}},
          }],
        };
      },
      drillDown(){return[exactRow()];},
      admitExternalEvidenceMapping(input){writebacks.push(structuredClone(input));return{kind:'MemoryExternalEvidenceMappingReceipt',status:'ADMITTED',sourceRevisionId:input.source.sourceRevisionId,authorityGranted:false};},
      invalidateExternalEvidenceMapping(input){invalidations.push(structuredClone(input));return{kind:'MemoryExternalEvidenceInvalidationReceipt',status:'INVALIDATED',sourceRevisionId:writebacks.at(-1)?.source?.sourceRevisionId??null,authorityGranted:false};},
      applyCoreSettlement(envelope,options){settlementMirrors.push({envelope:structuredClone(envelope),options:structuredClone(options)});return{kind:'MemoryCoreSettlementAdapterReceipt',status:'APPLIED',externalProposalId:envelope.proposal.id,authorityGranted:false};},
      readMemory(selection){return{kind:'MemoryUiReadModel',selection:structuredClone(selection),health:'OK',authorityGranted:false};},
    },
  };
  const brain=new Area52NativeBrain({memoryInterface});
  const recalled=await brain.prepareTurn({
    chatId:'chat:memory-owner',turnId:'memory-owner:1',generationId:'gen:memory-owner:1',
    query:'What happened when Lio reached Bellspire Station?',intent:'HISTORICAL',
    scene:scene('bellspire-platform',1,{location:'Bellspire Station',activeCast:['Lio']}),
    perspectiveConstraint:{scope:'CHARACTER_KNOWLEDGE',characterRef:'Lio'},executionLabel:'DETERMINISTIC',
  });
  assert.equal(recalled.memorySync.status,'SYNCED');
  assert.equal(recalled.memorySync.nominationCount,1);
  assert.ok(channelIds(recalled).has('OWNER_MEMORY'));
  assert.ok(slots(recalled).has('EPISODIC_MEMORY'));
  assert.ok(recalled.selection.ownerSourceRevisionRefs.includes(memoryRevision));
  assert.equal(brain.core.registry.getRevision(memoryRevision),null);
  assert.match(JSON.stringify(recalled.promptPlan),/moonrail bridge/i);

  const learned=await brain.completeTurn({
    turnId:'memory-owner:1',response:'Lio waits beneath the Bellspire tide clock.',knownBy:['Lio'],
    observations:[{subjectId:'Lio',predicate:'location',value:'Bellspire Station',at:1}],
  });
  assert.equal(writebacks.length,1);
  assert.equal(settlementMirrors.length,1);
  assert.equal(learned.memorySettlementReceipts[0].status,'APPLIED');
  assert.equal(settlementMirrors[0].options.evidenceArtifactRefs[0].externalEvidenceRef,writebacks[0].externalEvidenceRef);
  assert.equal(settlementMirrors[0].envelope.proposal.evidenceIds[0],writebacks[0].externalEvidenceRef);
  assert.match(writebacks[0].source.exactContent,/tide clock/i);
  assert.equal(writebacks[0].ownerArtifactRef.owner,'COGNITIVE_CORE');

  const beforeQuietQueries=memoryQueries;
  const quiet=await brain.prepareTurn({
    chatId:'chat:memory-owner',turnId:'memory-owner:2',generationId:'gen:memory-owner:2',query:'Continue.',executionLabel:'DETERMINISTIC',
  });
  assert.ok(quiet.used.paths.includes('HOT_ONLY'));
  assert.equal(memoryQueries,beforeQuietQueries);
  assert.equal(quiet.memorySync.status,'SKIPPED');
  assert.equal(quiet.memorySync.reason,'HOT_SUFFICIENT');

  const correctedWriteback=brain.correctTurn({
    turnId:'memory-owner:1',response:'Correction: Lio waits beneath the west Bellspire tide clock.',knownBy:['Lio'],
    observations:[{subjectId:'Lio',predicate:'location',value:'West Bellspire Station',at:1}],
  });
  assert.equal(correctedWriteback.memoryWriteback.status,'ADMITTED');
  assert.equal(settlementMirrors.length,2);
  assert.equal(correctedWriteback.memorySettlementReceipts[0].status,'APPLIED');
  assert.equal(writebacks.length,2);
  assert.equal(invalidations.length,1);
  assert.equal(invalidations[0].replacedBySourceRevisionId,writebacks[1].source.sourceRevisionId);
  assert.equal(writebacks[0].externalEvidenceRef,writebacks[1].externalEvidenceRef);
  assert.ok(writebacks[1].ownerArtifactRef.revision>writebacks[0].ownerArtifactRef.revision);
  assert.notEqual(writebacks[0].source.sourceRevisionId,writebacks[1].source.sourceRevisionId);

  memoryRevision='memory:glass-coast@r2';
  memoryText='Correction: Lio crossed the lower moonrail bridge, not the upper span.';
  const revised=await brain.prepareTurn({
    chatId:'chat:memory-owner',turnId:'memory-owner:3',generationId:'gen:memory-owner:3',
    query:'Which moonrail bridge did Lio cross?',intent:'HISTORICAL',
    scene:scene('bellspire-archive',2,{location:'Bellspire Station',activeCast:['Lio'],relationship:'PRECEDES'}),executionLabel:'DETERMINISTIC',
  });
  assert.ok(revised.selection.ownerSourceRevisionRefs.includes('memory:glass-coast@r2'));
  assert.equal(revised.selection.ownerSourceRevisionRefs.includes('memory:glass-coast@r1'),false);
  assert.match(JSON.stringify(revised.promptPlan),/lower moonrail bridge/i);
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


test('DETERMINISTIC: failed optional owner retrieval degrades without corrupting the native sealed path',async()=>{
  const loreInterface={kind:'LoreBrainRetrievalInterface',contractVersion:1,query(){throw new Error('LORE_OFFLINE');}};
  const memoryInterface={kind:'MemoryIntegrationSurface',contractVersion:'1.0.0',adapters:{queryHistorian(){throw new Error('MEMORY_OFFLINE');},drillDown(){return[];}}};
  const brain=new Area52NativeBrain({loreInterface,memoryInterface});
  const prepared=await brain.prepareTurn({
    chatId:'chat:owner-failure',turnId:'owner-failure:1',generationId:'gen:owner-failure:1',
    query:'What should Vale do at the silent gate?',intent:'CURRENT',scene:scene('silent-gate',1,{location:'Silent Gate',activeCast:['Vale']}),executionLabel:'DETERMINISTIC',
  });
  assert.equal(prepared.loreSync.status,'DEGRADED');
  assert.equal(prepared.memorySync.status,'DEGRADED');
  assert.equal(prepared.selection.ownerSourceRevisionRefs.length,0);
  assert.ok(prepared.contextSealReceipt?.sealedState);
  const learned=await brain.completeTurn({turnId:'owner-failure:1',response:'Vale waits at the silent gate.',knownBy:['Vale']});
  assert.equal(learned.rawExperienceRecoverable,true);
  assert.equal(brain.diagnostics().nativeRequirements.remoteModelRequired,false);
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
  const boundCandidateBus=bindings.readCandidateBusEnvelope(selection);
  if(prepared.candidateEnvelope)assert.equal(boundCandidateBus?.kind,'CandidateBusEnvelope');else assert.equal(boundCandidateBus,null);
  assert.ok(bindings.readTruth(selection));
  const scatter=bindings.readScatter(selection);assert.equal(scatter.kind,'RuntimeTurnReceipt');assert.ok(Array.isArray(scatter.jobs));
  const gather=bindings.readGather(selection);assert.ok(gather);assert.ok(Array.isArray(gather.results));
  assert.ok(bindings.readMemoryStatus(selection));
  assert.ok(bindings.readRuntimeStatus());
  assert.equal(bindings.listGenerations({selection:{chatId:'chat:ui-bind'}}).length,1);
  assert.equal(bindings.readGeneration({generationId:'gen:ui-bind:1',chatId:'chat:ui-bind'}).contextSeal.turnId,'ui-bind:1');
  await brain.completeTurn({turnId:'ui-bind:1',response:'Aya listens to the rain.',knownBy:['Aya']});
  release();
  assert.ok(events.some(event=>event.stage==='TURN_PREPARED'));
  assert.ok(events.some(event=>event.stage==='TURN_LEARNED'));
  assert.ok(events.every(event=>event.rawPromptIncluded===false&&event.rawResponseIncluded===false));
  assert.equal(prepared.selection.chatId,'chat:ui-bind');
});


test('DETERMINISTIC: authored Lore correction distrust survives stale owner retrieval and reload while unrelated Lore remains admissible',async()=>{
  let currentGate={id:'lore:reef-gate@r1',state:'CURRENT',exactContent:'The reef gate opens only at dawn.',contentHash:'hash:r1'};
  let packetGate={...currentGate};
  const unrelated={id:'lore:harbor-bells@r1',state:'CURRENT',exactContent:'Harbor bells ring twice at noon.',contentHash:'hash:bells:r1'};
  const loreInterface={
    kind:'LoreBrainRetrievalInterface',contractVersion:1,
    sourceRevision(sourceId){return structuredClone(sourceId==='lore:reef-gate'?currentGate:unrelated);},
    query(){
      const rows=[
        {sourceId:'lore:reef-gate',sourceRevisionId:packetGate.id,exactAuthoredText:packetGate.exactContent,representationRef:'source:'+packetGate.id,selectedRepresentation:{representationRevision:1},provenance:[{sourceRevisionId:packetGate.id}]},
        {sourceId:'lore:harbor-bells',sourceRevisionId:unrelated.id,exactAuthoredText:unrelated.exactContent,representationRef:'source:'+unrelated.id,selectedRepresentation:{representationRevision:1},provenance:[{sourceRevisionId:unrelated.id}]},
      ];
      return{kind:'LoreBrainRetrievalPacket',contractVersion:1,indexRevision:'idx:'+packetGate.id,ontologyRevision:'onto:1',sourceRevisionFence:rows.map(row=>row.sourceRevisionId),nominations:[{drillback:rows}]};
    },
  };
  const brain=new Area52NativeBrain({loreInterface});
  const first=await brain.prepareTurn({
    chatId:'chat:lore-distrust',turnId:'lore-distrust:1',generationId:'gen:lore-distrust:1',
    query:'When does the reef gate open?',intent:'CURRENT',
    scene:scene('reef-gate',1,{location:'Reef Gate',activeCast:['Vale']}),executionLabel:'DETERMINISTIC',
  });
  assert.match(JSON.stringify(first.promptPlan),/only at dawn/i);
  await brain.completeTurn({turnId:'lore-distrust:1',response:'Vale waits beside the reef gate.',knownBy:['Vale']});

  currentGate={id:'lore:reef-gate@r2',state:'CURRENT',exactContent:'The reef gate now opens only at moonrise.',contentHash:'hash:r2'};
  const invalidated=brain.acceptLoreRevisionChange({
    kind:'LoreSourceRevisionChanged',sourceId:'lore:reef-gate',lorebookId:'reef-laws',uid:'gate-hours',
    previousSourceRevisionId:'lore:reef-gate@r1',sourceRevisionId:'lore:reef-gate@r2',contentHash:'hash:r2',
  });
  assert.equal(invalidated.nextRevisionTrusted,false);

  const stale=await brain.prepareTurn({
    chatId:'chat:lore-distrust',turnId:'lore-distrust:2',generationId:'gen:lore-distrust:2',
    query:'What do the reef gate law and harbor bells say?',intent:'CURRENT',
    scene:scene('reef-gate-night',2,{location:'Reef Gate',activeCast:['Vale'],relationship:'PRECEDES'}),executionLabel:'DETERMINISTIC',
  });
  assert.equal(stale.selection.ownerSourceRevisionRefs.includes('lore:reef-gate@r1'),false);
  assert.ok(stale.selection.ownerSourceRevisionRefs.includes('lore:harbor-bells@r1'));
  assert.doesNotMatch(JSON.stringify(stale.promptPlan),/only at dawn/i);
  assert.match(JSON.stringify(stale.promptPlan),/bells ring twice/i);
  assert.ok(stale.loreSync.rejectedRevisionRefs.includes('lore:reef-gate@r1'));

  const restored=Area52NativeBrain.fromSnapshot(brain.snapshot(),{loreInterface});
  const staleAfterReload=await restored.prepareTurn({
    chatId:'chat:lore-distrust',turnId:'lore-distrust:3',generationId:'gen:lore-distrust:3',
    query:'When does the reef gate open now?',intent:'CURRENT',
    scene:scene('reef-gate-moon',3,{location:'Reef Gate',activeCast:['Vale'],relationship:'PRECEDES'}),executionLabel:'DETERMINISTIC',
  });
  assert.equal(staleAfterReload.selection.ownerSourceRevisionRefs.includes('lore:reef-gate@r1'),false);
  assert.doesNotMatch(JSON.stringify(staleAfterReload.promptPlan),/only at dawn/i);
  assert.ok(restored.diagnostics().loreRevisionTrust.pending.includes('lore:reef-gate'));

  packetGate={...currentGate};
  const fresh=await restored.prepareTurn({
    chatId:'chat:lore-distrust',turnId:'lore-distrust:4',generationId:'gen:lore-distrust:4',
    query:'When does the reef gate open now?',intent:'CURRENT',
    scene:scene('reef-gate-moonrise',4,{location:'Reef Gate',activeCast:['Vale'],relationship:'PRECEDES'}),executionLabel:'DETERMINISTIC',
  });
  assert.ok(fresh.selection.ownerSourceRevisionRefs.includes('lore:reef-gate@r2'));
  assert.equal(fresh.selection.ownerSourceRevisionRefs.includes('lore:reef-gate@r1'),false);
  assert.match(JSON.stringify(fresh.promptPlan),/only at moonrise/i);
  assert.ok(restored.diagnostics().loreRevisionTrust.trusted.includes('lore:reef-gate'));
});

test('DETERMINISTIC: Lore and Memory owner failures degrade independently',async()=>{
  const exactMemory={id:'memory:independent@r1',sourceRevisionId:'memory:independent@r1',exactContent:'Rook previously crossed the copper bridge.',knownBy:['Rook'],metadata:{chatId:'chat:owner-independent'}};
  const memoryInterface={kind:'MemoryIntegrationSurface',contractVersion:'1.0.0',adapters:{
    queryHistorian:()=>({kind:'HistorianQueryResult',status:'OK',historianRevision:'historian:1',nominations:[{
      kind:'CandidateNomination',candidateId:'memory:independent',evidenceIdentity:'memory:independent',
      artifactRef:{artifactId:'episode:independent',artifactType:'Episode',revision:1},artifactRevision:1,
      sourceRevisionRefs:['memory:independent@r1'],claimRefs:[],eventRefs:[],entityRefs:['Rook'],relationshipRefs:[],
      rankSignals:{intentMatch:1},normalizedRank:1,temporalHints:[{status:'HISTORICAL'}],continuitySignals:[],
      authorityClass:'OBSERVED',truthStatusHint:'HISTORICAL',provenance:[{ref:'memory:independent@r1'}],evidenceRefs:[exactMemory.id],
      dependencyRevisions:[],representationRef:'episode:independent',representationRevision:1,representationText:exactMemory.exactContent,
      metadata:{historianChannel:'EPISODIC_MEMORY',perspective:{scope:'WORLD'}},
    }]}),
    drillDown:()=>[exactMemory],
  }};
  const brain=new Area52NativeBrain({
    loreInterface:{kind:'LoreBrainRetrievalInterface',contractVersion:1,query(){throw new Error('LORE_OFFLINE_ONLY');}},
    memoryInterface,
  });
  const prepared=await brain.prepareTurn({
    chatId:'chat:owner-independent',turnId:'owner-independent:1',generationId:'gen:owner-independent:1',
    query:'What happened when Rook crossed the copper bridge?',intent:'HISTORICAL',
    scene:scene('copper-bridge',1,{location:'Copper Bridge',activeCast:['Rook']}),executionLabel:'DETERMINISTIC',
  });
  assert.equal(prepared.loreSync.status,'DEGRADED');
  assert.equal(prepared.memorySync.status,'SYNCED');
  assert.ok(channelIds(prepared).has('OWNER_MEMORY'));
  assert.match(JSON.stringify(prepared.promptPlan),/copper bridge/i);
  assert.ok(prepared.contextSealReceipt?.sealedState);
});


test('DETERMINISTIC: cancelled native learning work stays cancelled across drain and reload',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({
    chatId:'chat:cancel-feedback',turnId:'cancel-feedback:1',generationId:'gen:cancel-feedback:1',query:'Continue.',
    scene:scene('cancel-dock',1,{location:'Cancel Dock',activeCast:['Iri']}),executionLabel:'DETERMINISTIC',
  });
  const learned=await brain.completeTurn({
    turnId:'cancel-feedback:1',response:'Iri watches the harbor lights without changing course.',knownBy:['Iri'],autoDrain:false,
  });
  assert.ok(learned.runtimeTaskId);
  assert.equal(brain.readTurn('cancel-feedback:1').feedback,null);
  assert.equal(brain.runtimeDirector.cancelTask(learned.runtimeTaskId,'test-cancelled-after-completion'),true);
  await brain.runtimeDirector.drain({maxCycles:128});
  assert.equal(brain.readTurn('cancel-feedback:1').feedback,null);
  assert.equal(brain.runtimeDirector.snapshot().lifecycle.find(row=>row.taskId===learned.runtimeTaskId)?.lifecycleStatus,'CANCELLED');

  const restored=Area52NativeBrain.fromSnapshot(brain.snapshot());
  await restored.runtimeDirector.drain({maxCycles:128});
  assert.equal(restored.readTurn('cancel-feedback:1').feedback,null);
  assert.equal(restored.runtimeDirector.snapshot().lifecycle.find(row=>row.taskId===learned.runtimeTaskId)?.lifecycleStatus,'CANCELLED');
});
