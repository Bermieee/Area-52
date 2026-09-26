import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationExplainability, normalizePromptPlanReadModel, PromptPlanProductionUIAdapter } from '../src/ui-core/index.js';

const selection={chatId:'chat:truth',turnId:'turn:truth',generationId:'gen:truth',correlationId:'corr:truth',worldRevision:9,sceneRevision:4,sourceRevisionRefs:['src:9']};
const plan=()=>({
  kind:'PromptPlan',promptPlanId:'plan:truth',...selection,contextSealId:'seal:truth',modelProfileId:'CORE_PROFILE',
  sections:[
    {slot:'CURRENT_SCENE',allocatedTokens:499,representation:'RICH',reuseState:'REBUILD'},
    {slot:'RELEVANT_LORE',allocatedTokens:0,representation:'COMPACT',reuseState:'REBUILD'},
  ],
  ordering:['CURRENT_SCENE','RELEVANT_LORE'],
  deferred:[{slot:'RELEVANT_LORE',reason:'BUDGET_SHORTFALL',requiredTokens:120,remainingTokensAtDecision:0,shortfallTokens:120}],
  dropped:[],budget:{total:4096,allocated:499,remaining:3597,estimatedTokens:499},
  diagnosticReceipt:{budgetDecision:{strategy:'COMPACT_FIRST',budgetTokens:4096,allocatedTokens:499}},
  status:'READY',
});
const context=()=>({
  kind:'ContextReceiptReadModel',...selection,contextSealId:'seal:truth',promptPlanId:'plan:truth',packetId:'packet:truth',packetHash:'packet-hash',
  includedSections:['CURRENT_SCENE'],deferredSections:[{slot:'RELEVANT_LORE',reason:'BUDGET_SHORTFALL'}],omittedSections:[],
  budget:{total:4096,allocated:499},estimatedTokens:499,contextSealValid:true,
});
const seal=()=>({kind:'ContextSealReceipt',id:'seal:truth',...selection,sourceRevisionIds:['src:9'],admittedResultIds:[],rejectedResultIds:[],staleResultIds:[],lateResultIds:[],sealedState:true});
const observed=()=>({kind:'SillyTavernHostDeliveryReceipt',receiptId:'host:truth',...selection,promptPlanId:'plan:truth',contextSealId:'seal:truth',hostObserved:true,requestInjectedAt:123,requestHook:'CHAT_COMPLETION_PROMPT_READY'});

test('zero-token deferred Lore is one truthful row, never included and deferred at once',()=>{
  const normalized=normalizePromptPlanReadModel(plan());
  const lore=normalized.sections.filter(row=>row.slot==='RELEVANT_LORE');
  assert.equal(lore.length,1);
  assert.equal(lore[0].state,'DEFERRED');
  assert.equal(lore[0].included,false);
  assert.equal(lore[0].reason,'BUDGET_SHORTFALL');
});

test('Prompt Inspector keeps planned compiled/sealed and observed host request as distinct evidence',()=>{
  const explanation=buildGenerationExplainability({promptPlan:plan(),contextReceipt:context(),sealReceipt:seal(),hostDeliveryReceipt:observed()});
  assert.equal(explanation.delivery.planned.state,'PLANNED');
  assert.equal(explanation.delivery.compiled.state,'COMPILED_AND_SEALED');
  assert.equal(explanation.delivery.observed.state,'OBSERVED');
  const lore=explanation.sections.find(row=>row.slot==='RELEVANT_LORE');
  assert.equal(lore.compiledState,'DEFERRED');
  assert.equal(lore.included,false);
  assert.equal(lore.compiledReason,'BUDGET_SHORTFALL');
  assert.equal(explanation.budget.total,4096);
  assert.equal(explanation.budget.allocated,499);
  assert.equal(explanation.budgetDecision.strategy,'COMPACT_FIRST');
});

test('compiled packet is not relabeled observed when host evidence is absent or mismatched',()=>{
  const absent=buildGenerationExplainability({promptPlan:plan(),contextReceipt:context(),sealReceipt:seal()});
  assert.equal(absent.delivery.compiled.state,'COMPILED_AND_SEALED');
  assert.equal(absent.delivery.observed.state,'NO_EVIDENCE');
  const mismatch=buildGenerationExplainability({promptPlan:plan(),contextReceipt:context(),sealReceipt:seal(),hostDeliveryReceipt:{...observed(),promptPlanId:'plan:other'}});
  assert.equal(mismatch.delivery.observed.state,'NO_EVIDENCE');
  assert.equal(mismatch.delivery.observed.reason,'SILLYTAVERN_HOST_DELIVERY_IDENTITY_MISMATCH');
});

test('production adapter surfaces Core budget/omission truth and exact host receipt without sensitive bodies',()=>{
  const adapter=new PromptPlanProductionUIAdapter({readPlan:()=>({...plan(),prompt:'SECRET_PROMPT'}),readContextReceipt:context,readSealReceipt:seal,readHostDeliveryReceipt:observed,selectionProvider:()=>selection});
  const read=adapter.read();
  assert.equal(read.data.totalTokens,499);
  assert.equal(read.data.budgetTotal,4096);
  assert.equal(read.data.explainability.sections.find(row=>row.slot==='RELEVANT_LORE').compiledState,'DEFERRED');
  assert.equal(read.data.deliveryTruth.observed.state,'OBSERVED');
  const json=JSON.stringify({delivery:read.data.deliveryTruth,explainability:read.data.explainability});
  assert.equal(json.includes('SECRET_PROMPT'),false);
});
