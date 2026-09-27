import test from 'node:test';
import assert from 'node:assert/strict';
import {BrainDecisionVisibilityAdapter,SelectedTurnLogModel} from '../src/ui-core/index.js';

const selection={chatId:'chat-1',turnId:'turn-7',generationId:'gen-7',correlationId:'corr-7',worldRevision:9,sceneRevision:4,sourceRevisionRefs:['src:r1']};
function fixture({foreignChoice=false,missingTruth=false,missingSelected=false}={}){
 const selected={kind:'NativeBrainSelectedTurnReceipt',contractVersion:2,...selection,sourceRevisions:{selectedRefs:['src:r1'],sceneRefs:['scene:r4'],sealRefs:['src:r1'],ownerCount:1},producers:{
  cognitiveChoice:{status:'PUBLISHED',id:'choice:1',...selection},sensory:{status:'PUBLISHED',id:'sensory:1',...selection,sourceRevisionRefs:['src:r1']},
  truth:missingTruth?{status:'NO_EVIDENCE',reasonCode:'NO_EVIDENCE',...selection}:{status:'PUBLISHED',id:'truth:1',...selection},
  runtime:{status:'PUBLISHED',id:'runtime:1',...selection,events:[
   {eventKind:'OBLIGATION_ADMITTED',lifecycleState:'ADMITTED',reasonCode:'OWNER_EXPECTED_WORK',taskId:'task:truth',taskType:'TRUTH',...selection},
   {eventKind:'PHYSICAL_EXECUTION_STARTED',lifecycleState:'RUNNING',reasonCode:'PHYSICAL_EXECUTION_STARTED',taskId:'task:truth',taskType:'TRUTH',...selection},
   {eventKind:'RESULT_RETURNED',lifecycleState:'RETURNED',reasonCode:'RESULT_RETURNED',taskId:'task:truth',taskType:'TRUTH',durationMs:8,...selection},
   {eventKind:'OWNER_ADMISSION',lifecycleState:'ACCEPTED',reasonCode:'OWNER_ACCEPTED',taskId:'task:truth',taskType:'TRUTH',ownerAccepted:true,...selection},
   {eventKind:'WORK_BLOCKED',lifecycleState:'BLOCKED',reasonCode:'DEPENDENCY_BLOCKED',taskId:'task:deep',taskType:'DEEP_COGNITION',...selection}]},
  jev:{status:'PUBLISHED',physicalAttempt:true,returned:true,resultRef:'jev:r1',ownerAccepted:null,reasonCode:'EVIDENCE_PUBLISHED',...selection},
  sidecar:{status:'NO_EVIDENCE',reasonCode:'NO_EVIDENCE',ownerAccepted:null,...selection},vectoring:{status:'NO_EVIDENCE',reasonCode:'NO_EVIDENCE',...selection},
  precision:{status:'SKIPPED',reasonCode:'NOT_REQUIRED',physicalAttempt:false,returned:false,ownerAccepted:null,...selection},
  gather:{status:'PUBLISHED',id:'gather:1',...selection},contextSeal:{status:'PUBLISHED',id:'seal:1',...selection},promptPlan:{status:'PUBLISHED',id:'plan:1',...selection},
  contextReceipt:{status:'PUBLISHED',id:'context:1',...selection},compiledDelivery:{status:'PUBLISHED',id:'compiled:1',...selection},delivery:{status:'PUBLISHED',id:'request:1',...selection}},
  expectedWork:{kind:'NativeBrainExpectedWorkReadModel',...selection,items:[
   {expectedId:'owner:history',owner:'SCENE',ownerSignalId:'scene:history',status:'BLOCKED',reasonCode:'PREREQUISITE_PENDING',taskId:null,blockedBy:'owner:scene'},
   {expectedId:'owner:truth',owner:'COGNITIVE_CORE',ownerSignalId:'truth:needed',status:'DONE',reasonCode:'OWNER_ACCEPTED',taskId:'task:truth',evidenceStages:[{eventKind:'PHYSICAL_EXECUTION_STARTED'},{eventKind:'RESULT_RETURNED'},{eventKind:'OWNER_ADMISSION',ownerAccepted:true}]}
  ]},
  delivery:{planned:{state:'PLANNED',promptPlanId:'plan:1',includedSlots:['RELEVANT_LORE']},compiled:{state:'COMPILED_AND_SEALED',contextSealId:'seal:1',includedSlots:['RELEVANT_LORE']},hostObserved:{state:'OBSERVED',requestId:'request:1',matching:true,live:true,observedRoles:['system','user']}},rawPrompt:'LEAK',hiddenReasoning:'LEAK'};
 return{
  readSelectedTurnReceipt:()=>missingSelected?null:structuredClone(selected),
  readSensoryTrace:()=>({kind:'CandidateBusEnvelope',candidates:[{candidateId:'candidate:alpha',evidenceIdentity:'evidence:alpha',channelNominations:[{channelId:'NATIVE_LORE_RUNTIME'}],sourceRevisionRefs:['src:r1'],evidenceRefs:['evidence:alpha'],representationText:'SECRET BODY'}]}),
  readCognitiveChoice:()=>({kind:'CognitiveChoiceReceipt',...(foreignChoice?{...selection,turnId:'foreign'}:{}),functionDecisions:[
   {capability:'RETRIEVAL',disposition:'ADMITTED',reasonCode:'RETRIEVAL_REQUIRED'},{capability:'JEV',disposition:'DEFERRED',reason:'bounded follow-up'},
   {capability:'PRECISION',disposition:'SKIPPED',reasonCode:'NOT_REQUIRED'},{capability:'EXTERNAL_GROUNDING',disposition:'REJECTED',reasonCode:'LOW_EXPECTED_VALUE'}],hiddenReasoning:'SECRET CHAIN'}),
  readTruth:()=>missingTruth?null:{kind:'TruthAssessment',truthResults:[{candidateId:'candidate:alpha',classification:'CURRENT'}],admittedCandidateIds:['candidate:alpha']},
  readGather:()=>({kind:'GatherReceipt',...selection,results:[{resultId:'result:alpha',accepted:true,status:'ADMITTED',evidenceRefs:['evidence:alpha'],sourceRevisionRefs:['src:r1']}]}),
  readContextSeal:()=>({kind:'ContextSealReceipt',...selection,id:'seal:1',admittedResultIds:['result:alpha'],sourceRevisionIds:['src:r1']}),
  readPromptPlan:()=>({kind:'PromptPlan',...selection,promptPlanId:'plan:1',sections:[{slot:'RELEVANT_LORE',sourceRevisionIds:['src:r1']}],rawPrompt:'SECRET PROMPT'}),
  readContextReceipt:()=>({kind:'ContextReceipt',...selection,contextSealId:'seal:1',includedSections:['RELEVANT_LORE']}),
  readPromptDeliveryReceipt:()=>({kind:'CorePromptDeliveryReceipt',...selection,observedHostDelivery:{requestId:'request:1',observedRoles:['system','user'],observedSections:['RELEVANT_LORE'],matching:true,live:true},messages:[{content:'SECRET'}]})
 };
}
test('selected-turn projection separates nomination, choice, lifecycle, seal and host evidence',()=>{
 const model=new BrainDecisionVisibilityAdapter({bindings:fixture(),selectionProvider:()=>selection}).read();
 assert.equal(model.state,'READY');assert.equal(model.identityState,'EXACT_SELECTED_TURN');
 assert.deepEqual(model.sensoryNominations[0].sourceRevisionRefs,['src:r1']);assert.deepEqual(model.sensoryNominations[0].channels,['NATIVE_LORE_RUNTIME']);
 assert.equal(model.choiceDecisions.find(x=>x.capability==='Retrieval').disposition,'ADMITTED');assert.equal(model.choiceDecisions.find(x=>x.capability==='Jev').disposition,'DEFERRED');assert.equal(model.choiceDecisions.find(x=>x.capability==='External Grounding').disposition,'REJECTED');
 const alpha=model.candidateFlow[0];assert.equal(alpha.truth,'PROVEN');assert.equal(alpha.gather,'PROVEN');assert.equal(alpha.seal,'PROVEN');assert.equal(alpha.plannedPrompt,'PROVEN');assert.equal(alpha.observedHost,'NO_EVIDENCE');
 assert.equal(model.delivery.planned.state,'PLANNED');assert.equal(model.delivery.sealed.state,'COMPILED_AND_SEALED');assert.equal(model.delivery.observed.state,'OBSERVED');
});
test('lifecycle requires causal receipts and preserves blocked work',()=>{
 const model=new BrainDecisionVisibilityAdapter({bindings:fixture(),selectionProvider:()=>selection}).read(),truth=model.lifecycleObligations.find(x=>x.taskId==='task:truth'),deep=model.lifecycleObligations.find(x=>x.taskId==='task:deep');
 assert.equal(truth.state,'COMPLETED');assert.equal(truth.physicalExecution,true);assert.equal(truth.resultReturned,true);assert.equal(truth.ownerAccepted,true);assert.equal(truth.durationMs,8);
 assert.equal(deep.state,'BLOCKED');assert.equal(deep.reasonCode,'DEPENDENCY_BLOCKED');
 const expected=model.lifecycleObligations.find(x=>x.expectedId==='owner:history');assert.equal(expected.state,'BLOCKED');assert.equal(expected.reasonCode,'PREREQUISITE_PENDING');assert.equal(expected.declarationSource,'OWNER_EXPECTED_WORK');
});
test('Jev and Sidecar proof does not invent owner acceptance or execution',()=>{
 const model=new BrainDecisionVisibilityAdapter({bindings:fixture(),selectionProvider:()=>selection}).read();
 assert.equal(model.optionalExecution.jev.physicalAttempt,true);assert.equal(model.optionalExecution.jev.returned,true);assert.equal(model.optionalExecution.jev.ownerAccepted,null);
 assert.equal(model.optionalExecution.sidecar.state,'NO_EVIDENCE');assert.equal(model.optionalExecution.sidecar.physicalAttempt,null);assert.equal(model.optionalExecution.sidecar.ownerAccepted,null);
});
test('foreign receipt identity is fenced',()=>{
 const model=new BrainDecisionVisibilityAdapter({bindings:fixture({foreignChoice:true}),selectionProvider:()=>selection}).read();
 assert.equal(model.choiceDecisions.length,0);assert.ok(model.errors.some(x=>x.stage==='CognitiveChoice'&&x.code==='IDENTITY_MISMATCH'));assert.equal(model.selection.turnId,'turn-7');
});
test('missing stage remains NO_EVIDENCE while independently proven downstream stages stay independent',()=>{
 const model=new BrainDecisionVisibilityAdapter({bindings:fixture({missingTruth:true}),selectionProvider:()=>selection}).read();
 assert.ok(model.missingReceipts.includes('truth'));assert.equal(model.stages.find(x=>x.stage==='truth').state,'NO_EVIDENCE');assert.equal(model.candidateFlow[0].truth,'UNAVAILABLE');assert.equal(model.candidateFlow[0].gather,'PROVEN');
});
test('missing selected-turn anchor refuses reconstruction',()=>{
 const model=new BrainDecisionVisibilityAdapter({bindings:fixture({missingSelected:true}),selectionProvider:()=>selection}).read();
 assert.equal(model.state,'NO_EVIDENCE');assert.equal(model.choiceDecisions.length,0);assert.deepEqual(model.missingReceipts,['NativeBrainSelectedTurnReceipt']);
});
test('safe projection excludes raw prompt, bodies and hidden reasoning',()=>{
 const json=JSON.stringify(new BrainDecisionVisibilityAdapter({bindings:fixture(),selectionProvider:()=>selection}).read());
 assert.doesNotMatch(json,/SECRET BODY|SECRET CHAIN|SECRET PROMPT|"messages":|DO NOT LEAK/);
});
test('Diagnostics model exposes the same selected-turn decision model',()=>{
 const decisionVisibility=new BrainDecisionVisibilityAdapter({bindings:fixture(),selectionProvider:()=>selection});
 const journal={readTurn:()=>({entries:[],firstSeenAt:1,lastUpdatedAt:2}),status:()=>({retainedTurns:1})};
 const snapshot=new SelectedTurnLogModel({journal,selectionProvider:()=>selection,decisionVisibility}).read();
 assert.equal(snapshot.brainDecision.kind,'BrainDecisionVisibilityReadModel');assert.equal(snapshot.brainDecision.selection.generationId,'gen-7');assert.equal(snapshot.brainDecision.candidateFlow[0].observedHost,'NO_EVIDENCE');
});
