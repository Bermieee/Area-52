import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoEvidenceJournal } from '../src/ui-core/demo-visibility.js';
import { SelectedTurnLogModel } from '../src/ui-core/turn-log-diagnostics.js';
import { Wave11LiveReceiptBinding } from '../src/ui-core/wave11-live-bindings.js';
class Storage{constructor(){this.map=new Map();}getItem(k){return this.map.has(k)?this.map.get(k):null;}setItem(k,v){this.map.set(k,String(v));}removeItem(k){this.map.delete(k);}}
const selection=(generationId='gen:1',chatId='chat:a')=>({chatId,turnId:generationId==='gen:1'?'turn:1':'turn:2',generationId,correlationId:'corr:'+generationId,worldRevision:7,sceneRevision:4,sourceRevisionRefs:['src:7']});
function fixture(sel=selection(),{results=6}={}){
  const ids=Array.from({length:results},(_,i)=>'result:'+(i+1)),jobs=Array.from({length:6},(_,i)=>({jobId:'job:'+(i+1),sequence:i+1,owner:'COGNITIVE_CORE',resourceId:'native-cpu',status:'COMPLETE'}));
  const gatherResults=ids.map((resultId,i)=>({resultId,taskId:'job:'+((i%6)+1),status:'ADMITTED',accepted:true,resourceId:'native-cpu',destination:'CONTEXT',providerAttempted:false}));
  const ownerReceipt={kind:'NativeBrainSelectedTurnReceipt',contractVersion:1,...sel,sourceRevisions:{selectedRefs:['src:7'],sceneRefs:['src:7'],sealRefs:['src:7']},producers:{
    scene:{status:'PUBLISHED',id:'scene:r',sceneRevision:4,sourceRevisionRefs:['src:7']},hotCognition:{status:'PUBLISHED',id:'hot:r'},cognitiveChoice:{status:'PUBLISHED',id:'choice:r'},retrieval:{status:'PUBLISHED',id:'retrieval:r'},gather:{status:'PUBLISHED',id:'gather:r'},contextSeal:{status:'PUBLISHED',id:'seal:r'},promptPlan:{status:'PUBLISHED',id:'plan:r'},contextReceipt:{status:'PUBLISHED',id:'context:r'}},
    delivery:{planned:{state:'PLANNED',promptPlanId:'plan:r',contextSealId:'seal:r'},compiled:{state:'COMPILED_AND_SEALED',contextSealId:'seal:r',packetId:'packet:r'},hostObserved:{state:'OBSERVED',receiptId:'host:r',promptPlanId:'plan:r',contextSealId:'seal:r',requestHook:'CHAT_COMPLETION_PROMPT_READY'}},
    prompt:'TOP_SECRET_PROMPT_SHOULD_NOT_SURVIVE',hiddenReasoning:'TOP_SECRET_REASONING_SHOULD_NOT_SURVIVE'};
  const cognition={data:{scene:{kind:'SceneUiReadModel',sceneId:'scene:1',revision:4,sourceRevisionRefs:['src:7']},hotCognition:{kind:'HotCognitionSnapshot',snapshotId:'hot:r',state:'LIVE'},choice:{kind:'CognitiveChoiceReceipt',receiptId:'choice:r',state:'COMPLETE',admitted:jobs.map(x=>x.jobId),skipped:[]},scatter:{kind:'RuntimeTurnReceipt',receiptId:'runtime:r',jobs:jobs.map(x=>({jobId:x.jobId,resourceId:'native-cpu',state:'EXECUTED'}))},sensory:{kind:'SensoryTrace',receiptId:'sensory:r',state:'COMPLETE'},truth:{kind:'TruthAssessment',receiptId:'truth:r',state:'COMPLETE',counts:{TRUE:results}},jev:{kind:'JevDecisionReceipt',state:'SKIPPED',reasonCode:'JEV_NOT_REQUIRED',outcome:'JEV_NOT_REQUIRED'},gather:{kind:'GatherReceipt',receiptId:'gather:r',state:'COMPLETE',counts:{ADMITTED:results,LATE:0,STALE:0,REJECTED:0,INVALID:0},results:gatherResults},seal:{kind:'ContextSealReceipt',sealId:'seal:r',sealedState:true,effectiveAdmittedResultIds:ids,admittedResultIds:ids},promptPlan:{kind:'PromptPlan',promptPlanId:'plan:r',status:'PUBLISHED'},lore:null}};
  const operations={pipeline:{mappingReceipt:true,executionReceipt:true,learningReceipt:true,learningKind:'NativeBrainLearningReceipt',logicalJobsMapped:6,physicalExecutionAttempts:6,physicalExecutionSucceeded:6},inspections:{
    runtime:{available:true,receiptRef:'runtime:r',payload:{receipt:{kind:'RuntimeTurnReceipt',receiptId:'runtime:r',jobs,resourceIds:['native-cpu']}}},
    generation:{available:true,receiptRef:'host:r',payload:{kind:'SillyTavernHostDeliveryReceipt',receiptId:'host:r',state:'MODEL_REQUEST_PAYLOAD_INJECTED',promptPlanId:'plan:r',contextSealId:'seal:r',hostObserved:true,promptInjected:true,requestInjectedAt:100}},
    learning:{available:true,receiptRef:'learn:r',payload:{kind:'NativeBrainLearningReceipt',status:'RECORDED'}}},stages:[]};
  const diagnostics={resources:{rows:[{id:'jev:1',kind:'JEV',state:'READY',callable:true,ownerAccepted:false},{id:'sidecar:1',kind:'SIDECAR',state:'READY',callable:true,ownerAccepted:false},{id:'vector:1',kind:'VECTORING',state:'CONFIGURED',callable:false,ownerAccepted:false}]},host:{liveBinding:{lastError:null}}};
  return{ownerReceipt,cognition,operations,diagnostics,promptPlan:{data:cognition.data.promptPlan}};
}
test('selected-turn operator trace exposes six jobs, optional lifecycle, and planned compiled observed delivery',()=>{
  const journal=new DemoEvidenceJournal({storage:new Storage(),namespace:'worker3',now:()=>1000}),sel=selection(),f=fixture(sel);journal.recordSnapshot({selection:sel,...f});
  const model=new SelectedTurnLogModel({journal,selectionProvider:()=>sel,now:()=>1000}),read=model.read();
  assert.equal(read.summary.logicalJobs,6);assert.equal(read.rows.filter(row=>row.stage==='Fan-out job').length,6);
  assert.deepEqual(read.rows.filter(row=>row.stage==='Optional resource').map(row=>row.status).sort(),['CONFIGURED','QUALIFIED','QUALIFIED']);
  const edges=read.rows.filter(row=>row.category==='EDGE');assert.equal(edges.length,18);
  assert.ok(edges.some(row=>row.stage==='Causal edge · Sensory / Retrieval'&&row.status!=='NO_EVIDENCE'));
  assert.ok(edges.some(row=>row.stage==='Causal edge · Memory owner'&&row.status==='NO_EVIDENCE'));
  assert.ok(edges.some(row=>row.stage==='Causal edge · Compiled / sealed delivery'&&row.status==='COMPILED_AND_SEALED'));
  assert.ok(edges.some(row=>row.stage==='Causal edge · Observed host delivery'&&row.status==='OBSERVED'));
  assert.ok(read.rows.some(row=>row.stage==='PromptPlan'&&row.status==='PLANNED'));assert.ok(read.rows.some(row=>row.stage==='Observed host delivery'&&row.status==='INJECTED'));
  const firstJob=read.rows.find(row=>row.stage==='Fan-out job'),detail=model.detail(firstJob.id,{selection:sel});assert.equal(detail.sources.some(source=>source.job?.jobId==='job:1'),true);
  const exported=JSON.stringify(model.exportMetadata({selection:sel}));assert.doesNotMatch(exported,/TOP_SECRET_PROMPT_SHOULD_NOT_SURVIVE|TOP_SECRET_REASONING_SHOULD_NOT_SURVIVE/);assert.doesNotMatch(exported,/"prompt"\s*:/i);
});
test('missing owner producer remains NO_EVIDENCE instead of fabricated success',()=>{
  const journal=new DemoEvidenceJournal({storage:new Storage(),namespace:'missing',now:()=>2000}),sel=selection(),f=fixture(sel);delete f.ownerReceipt.producers.scene;delete f.cognition.data.scene;journal.recordSnapshot({selection:sel,...f});
  const scene=new SelectedTurnLogModel({journal,selectionProvider:()=>sel,now:()=>2000}).read().rows.find(row=>row.stage==='Causal edge · Scene');assert.equal(scene.status,'NO_EVIDENCE');assert.equal(scene.reasonCode,'OWNER_STAGE_RECEIPT_NOT_PUBLISHED');
});
test('selected-turn receipt bridge rejects foreign identity and accepts exact owner identity',()=>{
  const sel=selection(),good=new Wave11LiveReceiptBinding({readSelection:()=>sel,readSelectedTurnReceipt:()=>({kind:'NativeBrainSelectedTurnReceipt',...sel})});assert.equal(good.bridges.selectedTurn.readReceipt(sel).generationId,sel.generationId);good.destroy();
  const bad=new Wave11LiveReceiptBinding({readSelection:()=>sel,readSelectedTurnReceipt:()=>({kind:'NativeBrainSelectedTurnReceipt',...sel,chatId:'chat:other'})});assert.throws(()=>bad.bridges.selectedTurn.readReceipt(sel),error=>error?.code==='LIVE_RECEIPT_IDENTITY_MISMATCH');assert.equal(bad.diagnostics().rejected,1);bad.destroy();
});
test('chat switch regeneration and duplicate captures stay isolated and bounded',()=>{
  const journal=new DemoEvidenceJournal({storage:new Storage(),namespace:'isolation',now:()=>3000}),a=selection('gen:1','chat:a'),b=selection('gen:2','chat:b'),fa=fixture(a),fb=fixture(b);journal.recordSnapshot({selection:a,...fa});const writes=journal.status().writes;journal.recordSnapshot({selection:a,...fa});assert.equal(journal.status().writes,writes);assert.ok(journal.status().skippedRedundantWrites>=1);journal.recordSnapshot({selection:b,...fb});
  assert.equal(journal.readTurn(a).selection.chatId,'chat:a');assert.equal(journal.readTurn(b).selection.chatId,'chat:b');const exported=new SelectedTurnLogModel({journal,selectionProvider:()=>b,now:()=>3000}).exportMetadata({selection:b});assert.equal(exported.selection.generationId,'gen:2');assert.doesNotMatch(JSON.stringify(exported),/gen:1/);
});
