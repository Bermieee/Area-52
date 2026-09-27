import test from 'node:test';
import assert from 'node:assert/strict';

import {Area52NativeBrain} from '../src/native-brain.js';
import {DemoEvidenceJournal} from '../src/ui-core/demo-visibility.js';
import {OperatorLoadTrace} from '../src/ui-core/operator-load-trace.js';
import {SelectedTurnCausalReportReader} from '../src/selected-turn-causal-report.js';

const memory=()=>{const map=new Map();return{getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),map};};
const scene=(id,revision=1,extra={})=>({sceneId:id,sceneRevision:revision,sourceRevisionRefs:['scene:'+id+':r'+revision],activeCast:['Mara'],location:id,...extra});
const clone=value=>JSON.parse(JSON.stringify(value));

function ownerReceipt(selection,{expectedWork=null,missingStage=null,hostObserved=true}={}){
  const stages=['hostObservation','scene','hotCognition','cognitiveChoice','sensory','retrieval','truth','runtime','jev','sidecar','vectoring','precision','gather','contextSeal','promptPlan','contextReceipt','compiledDelivery','delivery','learning','memory','lore'];
  const producers={};
  for(const stage of stages)producers[stage]={kind:'TestOwnerReceipt',id:'receipt:'+stage,status:'PUBLISHED',lifecycleState:'PUBLISHED',durationMs:1,ownerAccepted:stage==='memory'||stage==='lore'?true:null,worldRevision:selection.worldRevision,sceneRevision:selection.sceneRevision,sourceRevisionRefs:selection.sourceRevisionRefs};
  if(missingStage)producers[missingStage]={status:'UNAVAILABLE',reasonCode:'NO_EVIDENCE'};
  producers.jev={kind:'TestOwnerReceipt',id:'receipt:jev',status:'SKIPPED',lifecycleState:'SKIPPED',ownerAccepted:null,metadata:{configured:true,qualified:true,physicalAttempt:false,returned:false},reasonCode:'JEV_NOT_REQUIRED',worldRevision:selection.worldRevision,sceneRevision:selection.sceneRevision,sourceRevisionRefs:selection.sourceRevisionRefs};
  return{
    kind:'NativeBrainSelectedTurnReceipt',contractVersion:2,...selection,producers,
    expectedWork:expectedWork??{kind:'NativeBrainExpectedWorkReadModel',items:[],counts:{total:0}},
    delivery:{planned:{state:'PLANNED',promptPlanId:'plan:1'},compiled:{state:'COMPILED_AND_SEALED',contextSealId:'seal:1'},hostObserved:hostObserved?{state:'OBSERVED',requestId:'request:1',matching:true,live:false,observedRoles:['system','user']}:{state:'UNAVAILABLE',reason:'HOST_DELIVERY_NOT_OBSERVED'}},
    rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
  };
}

test('Worker 4 real deterministic Brain receipt flows through the existing journal, Turn Log, and on-demand report',async()=>{
  const brain=new Area52NativeBrain();
  const prepared=await brain.prepareTurn({chatId:'chat:w4',turnId:'turn:w4',generationId:'gen:w4',query:'Continue',scene:scene('w4'),providerId:'OpenRouter',executionLabel:'DETERMINISTIC'});
  brain.recordHostObservationEvidence('turn:w4',{eventId:'host:w4',chatId:'chat:w4',turnId:'turn:w4',generationId:'gen:w4',correlationId:prepared.selection.correlationId,worldRevision:prepared.selection.worldRevision,sceneRevision:prepared.selection.sceneRevision,durationMs:2});
  brain.recordObservedHostPromptEvidence('turn:w4',{host:'SILLYTAVERN',chatId:'chat:w4',turnId:'turn:w4',generationId:'gen:w4',correlationId:prepared.selection.correlationId,contextSealId:prepared.contextSealReceipt.id,sealedPacketHash:prepared.promptDeliveryReceipt.sealedPacketHash,semanticManifestIdentity:prepared.promptDeliveryReceipt.semanticManifestIdentity,requestId:'request:w4',observedRoles:[...new Set(prepared.rendered.messages.map(row=>row.role))],observedSections:prepared.rendered.messageMap.map(row=>row.slot),live:false});
  await brain.completeTurn({turnId:'turn:w4',response:'This response body must never enter telemetry.'});
  const ui=brain.uiBindings(),selection=ui.readSelection({chatId:'chat:w4'}),receipt=ui.readSelectedTurnReceipt(selection);
  const journal=new DemoEvidenceJournal({storage:memory(),namespace:'worker4-real',now:()=>1000});
  journal.recordSnapshot({selection,ownerReceipt:receipt,promptPlan:ui.readPromptPlan(selection),cognition:{data:{scatter:ui.readScatter(selection),gather:ui.readGather(selection),seal:ui.readContextSeal(selection),choice:ui.readCognitiveChoice(selection),truth:ui.readTruth(selection)}}});
  const report=new SelectedTurnCausalReportReader({journal,selectionProvider:()=>selection,now:()=>1100}).read();
  const journalTurn=journal.readTurn(selection);

  assert.equal(report.state,'AVAILABLE');
  assert.equal(report.generationOutcome.state,'OBSERVED');
  assert.equal(report.delivery.observedHostDelivery.state,'OBSERVED');
  assert.ok(report.connections.rows.some(row=>row.stage==='hostObservation'&&row.status!=='NO_EVIDENCE'));
  assert.ok(report.connections.rows.some(row=>row.stage==='scene'&&row.status!=='NO_EVIDENCE'));
  assert.ok(report.connections.rows.some(row=>row.stage==='contextSeal'&&row.status!=='NO_EVIDENCE'));
  assert.ok(report.connections.rows.some(row=>row.stage==='promptPlan'&&row.status!=='NO_EVIDENCE'));
  assert.ok(report.connections.rows.some(row=>row.stage==='delivery'&&row.status!=='NO_EVIDENCE'));
  assert.ok(report.connections.rows.some(row=>row.stage==='sidecar'&&row.status==='NO_EVIDENCE'));
  assert.equal(report.obligations.total,receipt.expectedWork.items.length);
  assert.equal(report.jobs.logicalCount,ui.readScatter(selection).jobs.length);
  assert.equal(report.optionalResources.physicalAttemptCount,0);
  assert.ok(journalTurn.entries.some(row=>row.type==='OBLIGATION_RECONCILIATION')||report.obligations.total===0);
  assert.equal(journalTurn.entries.filter(row=>row.type==='OWNER_EDGE'&&row.status!=='NO_EVIDENCE').length,report.connections.evidencedCount);
  const raw=JSON.stringify(journal.exportEvidence({selection}));
  assert.doesNotMatch(raw,/This response body must never enter telemetry/);
  assert.equal(report.authority.truth,false);assert.equal(report.authority.contextSeal,false);assert.equal(report.safety.providerResponses,false);
});

test('Worker 4 missing producer stays NO_EVIDENCE and is never inferred from adjacent success',()=>{
  const selection={chatId:'chat:missing',turnId:'turn:missing',generationId:'gen:missing',correlationId:'corr:missing',worldRevision:3,sceneRevision:2,sourceRevisionRefs:['scene:r2']};
  const receipt=ownerReceipt(selection,{missingStage:'truth'});
  const journal=new DemoEvidenceJournal({storage:memory(),namespace:'worker4-missing',now:()=>2000});
  journal.recordSnapshot({selection,ownerReceipt:receipt});
  const report=new SelectedTurnCausalReportReader({journal}).read({selection});
  const truth=report.connections.rows.find(row=>row.stage==='truth');
  assert.equal(truth.status,'NO_EVIDENCE');assert.equal(truth.exercised,false);
  assert.ok(report.missingOrBlocked.some(row=>row.kind==='OWNER_EDGE'&&row.stage==='truth'));
});

test('Worker 4 late optional result preserves configured, qualified, attempted, returned, admitted and sealed as distinct facts',()=>{
  const selection={chatId:'chat:late',turnId:'turn:late',generationId:'gen:late',correlationId:'corr:late',worldRevision:5,sceneRevision:4,sourceRevisionRefs:['scene:r4']};
  const receipt=ownerReceipt(selection,{hostObserved:false});
  const journal=new DemoEvidenceJournal({storage:memory(),namespace:'worker4-late',now:()=>3000});
  journal.recordSnapshot({
    selection,ownerReceipt:receipt,
    cognition:{data:{jev:{reasonCode:'JEV_REQUIRED'},gather:{state:'COMPLETE',counts:{ADMITTED:0,LATE:1,STALE:0,REJECTED:0,INVALID:0},results:[{resultId:'result:late',taskId:'JEV',status:'LATE',accepted:false,resourceId:'jev:provider',providerAttempted:true,reasonCode:'LATE_RESULT'}]},seal:{sealedState:true,sealId:'seal:late',effectiveAdmittedResultIds:[],lateResultIds:['result:late']}}},
    diagnostics:{resources:{rows:[{id:'jev:provider',kind:'JEV',state:'CONNECTED',callable:true,physicalExecutionAttempted:true,physicalExecutionSucceeded:true,physicalExecutionReturned:true,ownerAccepted:false,lastExecution:{status:'SUCCESS',returned:true,receiptId:'jev:exec:1',latencyMs:12}}]}},
  });
  const report=new SelectedTurnCausalReportReader({journal}).read({selection});
  const jev=report.optionalResources.rows.find(row=>row.kind==='JEV');
  assert.equal(jev.configured,true);assert.equal(jev.qualified,true);assert.equal(jev.physicalAttempted,true);assert.equal(jev.returned,true);assert.equal(jev.ownerAccepted,false);
  assert.equal(report.evidence.gather.late,1);assert.equal(report.evidence.contextSeal.admittedResultCount,0);assert.equal(report.evidence.contextSeal.lateResultCount,1);
  assert.equal(report.generationOutcome.state,'PLANNED_ONLY');
});

test('Worker 4 failed owner admission is retained as FAILED expected work with bounded causal stages',()=>{
  const selection={chatId:'chat:reject',turnId:'turn:reject',generationId:'gen:reject',correlationId:'corr:reject',worldRevision:8,sceneRevision:7,sourceRevisionRefs:['scene:r7']};
  const expectedWork={items:[{expectedId:'scene:reject',owner:'SCENE',ownerSignalId:'scene:signal',status:'FAILED',reasonCode:'OWNER_REJECTED',taskId:'task:scene',cause:{correlationId:selection.correlationId,worldRevision:8,sceneRevision:7,sourceRevisionRefs:['scene:r7'],privateBody:'DO_NOT_KEEP'},missingEvidence:[],evidenceStages:[{id:'e:1',eventKind:'PHYSICAL_EXECUTION_STARTED',producerId:'SENSORY_RETRIEVAL',consumerId:'SCENE'},{id:'e:2',eventKind:'RESULT_RETURNED',producerId:'SENSORY_RETRIEVAL',consumerId:'SCENE',parentReceiptId:'e:1'},{id:'e:3',eventKind:'OWNER_REJECTED',producerId:'SCENE',consumerId:'COGNITIVE_STATE',parentReceiptId:'e:2',ownerAccepted:false,metadata:{providerResponse:'DO_NOT_KEEP_PROVIDER_RESPONSE'}}]}]};
  const journal=new DemoEvidenceJournal({storage:memory(),namespace:'worker4-reject',now:()=>4000});
  journal.recordSnapshot({selection,ownerReceipt:ownerReceipt(selection,{expectedWork})});
  const report=new SelectedTurnCausalReportReader({journal}).read({selection});
  assert.equal(report.obligations.counts.FAILED,1);
  assert.equal(report.obligations.items[0].reasonCode,'OWNER_REJECTED');
  assert.equal(report.obligations.items[0].evidenceStages.at(-1).ownerAccepted,false);
  const raw=JSON.stringify(journal.exportEvidence({selection}));
  assert.doesNotMatch(raw,/DO_NOT_KEEP|DO_NOT_KEEP_PROVIDER_RESPONSE/);
});

test('Worker 4 chat switch, regeneration, correction fence, reload, dedupe and retention stay isolated',()=>{
  const storage=memory();let now=5000;
  const journal=new DemoEvidenceJournal({storage,namespace:'worker4-fences',maxTurns:3,maxEntriesPerTurn:4,maxStoredBytes:16384,now:()=>++now});
  const a={chatId:'chat:a',turnId:'turn:1',generationId:'gen:1',correlationId:'corr:a1',worldRevision:1,sceneRevision:1,sourceRevisionRefs:['scene:a:r1']};
  const b={chatId:'chat:b',turnId:'turn:1',generationId:'gen:1',correlationId:'corr:b1',worldRevision:1,sceneRevision:1,sourceRevisionRefs:['scene:b:r1']};
  const regen={...a,generationId:'gen:2',correlationId:'corr:a2'};
  const first={selection:a,ownerReceipt:ownerReceipt(a)};
  journal.recordSnapshot(first);
  const before=journal.status();journal.recordSnapshot(first);const after=journal.status();
  assert.equal(after.entryCount,before.entryCount);assert.ok(after.skippedRedundantWrites>before.skippedRedundantWrites);
  journal.recordSnapshot({selection:b,ownerReceipt:ownerReceipt(b,{hostObserved:false})});
  journal.recordSnapshot({selection:regen,ownerReceipt:ownerReceipt(regen,{hostObserved:false})});
  assert.ok(journal.readTurn(a));assert.ok(journal.readTurn(b));assert.ok(journal.readTurn(regen));

  const corrected={...a,correlationId:'corr:a1-corrected',worldRevision:2,sceneRevision:2,sourceRevisionRefs:['scene:a:r2']};
  journal.recordSnapshot({selection:corrected,ownerReceipt:ownerReceipt(corrected)});
  assert.equal(journal.readTurn(a),null);assert.ok(journal.readTurn(corrected));

  for(let i=0;i<80;i++){
    journal.recordSnapshot({selection:corrected,operations:{stages:[{id:'scene',state:'LIVE',label:'Scene'}],inspections:{scene:{available:true,receiptRef:'noise:'+i,payload:{kind:'SceneReceipt',status:'LIVE'}}}}});
  }
  const retained=journal.readTurn(corrected);
  assert.ok(retained.entries.some(row=>row.type==='HOST_DELIVERY'||(row.type==='OWNER_EDGE'&&row.subtype==='delivery')));
  assert.ok(journal.status().serializedBytes<=journal.status().maxStoredBytes);

  const restored=new DemoEvidenceJournal({storage,namespace:'worker4-fences',maxTurns:3,maxEntriesPerTurn:4,maxStoredBytes:16384,now:()=>9000});
  assert.ok(restored.readTurn(corrected));assert.equal(restored.readTurn(a),null);
  const report=new SelectedTurnCausalReportReader({journal:restored}).read({selection:corrected});
  assert.equal(report.selection.correlationId,'corr:a1-corrected');
  assert.equal(report.retention.criticalDeliveryProtected,true);assert.equal(report.retention.revisionFenceAware,true);
});

test('Worker 4 UI load attribution is measured-only and browser memory remains an operator observation',()=>{
  const selection={chatId:'chat:perf',turnId:'turn:perf',generationId:'gen:perf',correlationId:'corr:perf',worldRevision:1,sceneRevision:1,sourceRevisionRefs:['scene:r1']};
  const journal=new DemoEvidenceJournal({storage:memory(),namespace:'worker4-perf',now:()=>6000});
  journal.recordSnapshot({selection,ownerReceipt:ownerReceipt(selection)});
  const trace=new OperatorLoadTrace({clock:()=>0});trace.record('UI_WORKSPACE_REFRESH',683,{selection});trace.record('UI_WORKSPACE_REFRESH',783,{selection});trace.record('UI_JOURNAL_PROCESS',0.4,{selection});trace.record('UI_CAPTURE_TOTAL',1.2,{selection});
  const reader=new SelectedTurnCausalReportReader({journal,loadTraceProvider:()=>trace.snapshot(),now:()=>6100});
  const automatic=reader.read({selection});
  assert.equal(automatic.uiLoad.workspaceRefresh.avgMs,733);assert.equal(automatic.uiLoad.workspaceRefresh.peakMs,783);
  assert.equal(automatic.uiLoad.browserTaskManagerMemory.measurementClass,'UNAVAILABLE_BY_CONTRACT');assert.equal(automatic.operatorObservations.length,0);
  const manual=reader.read({selection,operatorObservations:[{metric:'browser-task-manager-memory',value:2.5,unit:'GB'}]});
  assert.equal(manual.operatorObservations[0].measurementClass,'OPERATOR_OBSERVATION');assert.equal(manual.operatorObservations[0].causalAttribution,'UNPROVEN');
  assert.match(manual.pasteableSummary,/avg 733 ms, peak 783 ms/);assert.match(manual.pasteableSummary,/causal attribution unproven/);
});

test('Worker 4 report export is bounded, metadata-only, and owner receipt, journal query, and report agree',()=>{
  const selection={chatId:'chat:export',turnId:'turn:export',generationId:'gen:export',correlationId:'corr:export',worldRevision:2,sceneRevision:2,sourceRevisionRefs:['scene:r2']};
  const journal=new DemoEvidenceJournal({storage:memory(),namespace:'worker4-export',now:()=>7000});
  journal.recordSnapshot({selection,ownerReceipt:ownerReceipt(selection,{expectedWork:{items:[{expectedId:'memory:optional',owner:'MEMORY',ownerSignalId:'memory:signal',status:'SKIPPED_WITH_REASON',reasonCode:'OPTIONAL_RESOURCE_UNAVAILABLE',cause:{correlationId:'corr:export',prompt:'DO_NOT_EXPORT_PROMPT'}}]}}),diagnostics:{host:{liveBinding:{lastError:{stage:'generation',code:'READ_FAILED',message:'Bearer SUPERSECRET story body DO_NOT_EXPORT_STORY'}}}}});
  const reader=new SelectedTurnCausalReportReader({journal,maxExportBytes:16384,now:()=>7100}),report=reader.read({selection}),exported=reader.exportDetailed({selection});
  const journalTurn=journal.readTurn(selection),receipt=ownerReceipt(selection,{expectedWork:{items:[{expectedId:'memory:optional',owner:'MEMORY',ownerSignalId:'memory:signal',status:'SKIPPED_WITH_REASON',reasonCode:'OPTIONAL_RESOURCE_UNAVAILABLE',cause:{correlationId:'corr:export'}}]}});
  assert.deepEqual(report.selection,journalTurn.selection);
  assert.equal(report.connections.evidencedCount,journalTurn.entries.filter(row=>row.type==='OWNER_EDGE'&&row.status!=='NO_EVIDENCE').length);
  assert.equal(report.connections.missingCount,journalTurn.entries.filter(row=>row.type==='OWNER_EDGE'&&row.status==='NO_EVIDENCE').length);
  assert.equal(report.obligations.total,receipt.expectedWork.items.length);assert.ok(JSON.stringify(exported).length<=16384);
  const raw=JSON.stringify({journal:journal.exportEvidence({selection}),exported});
  assert.doesNotMatch(raw,/SUPERSECRET|DO_NOT_EXPORT_STORY|DO_NOT_EXPORT_PROMPT/);
  assert.match(raw,/\[REDACTED\]/);
});
