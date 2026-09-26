import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENROUTER_DECISIONS_ENDPOINT,OPENROUTER_KEY_ENDPOINT,OPENROUTER_JEV_PROTOCOL,
  createOpenRouterJevDecisionAdapter,normalizeOpenRouterApiKey,normalizeOpenRouterDecisionsEndpoint,normalizeOpenRouterJevModel,
} from '../src/coprocessor/openrouter-jev-decisions.js';

function response(status,payload){return{ok:status>=200&&status<300,status,async json(){return payload;}};}
function decisionInput(shape='CHOOSE_ONE'){
  return{data:{
    contract:'JevDecisionRequest',decisionId:'decision:test',decisionType:'TEST',decisionShape:shape,
    allowedOutcomes:[shape,'UNRESOLVED','ABSTAIN'],
    options:[
      {optionId:'alpha',label:'Alpha',evidenceRefs:['ev:a'],provenanceRefs:[],requiresEvidence:true,payload:{rank:1}},
      {optionId:'beta',label:'Beta',evidenceRefs:['ev:b'],provenanceRefs:[],requiresEvidence:true,payload:{rank:2}},
    ],
    evidence:[
      {evidenceId:'ev:a',summary:'Alpha is supported by the first observation.',sourceRef:'src:a',available:true,stale:false},
      {evidenceId:'ev:b',summary:'Beta is supported by the second observation.',sourceRef:'src:b',available:true,stale:false},
    ],
    constraints:[],authorityBoundary:{authorityClass:'ADVISORY',ownerId:'DOMAIN_OWNER'},
    abstentionAllowed:true,operatorApprovalPolicy:{required:false},revisionFence:{sourceRevisionSet:[],worldRevision:1,sceneRevision:1,characterStateRevision:1,domainRevisions:{}},
  }};
}

test('OpenRouter Jev normalization matches the dedicated Decisions connection contract',()=>{
  assert.equal(normalizeOpenRouterApiKey(' Bearer  sk-or-test \n'),'sk-or-test');
  assert.equal(normalizeOpenRouterJevModel('jev-1.13'),'typesafe/jev-1.13');
  assert.equal(normalizeOpenRouterJevModel('typesafe/jev-latest'),'~typesafe/jev-latest');
  assert.equal(normalizeOpenRouterDecisionsEndpoint('https://openrouter.ai/api/v1'),OPENROUTER_DECISIONS_ENDPOINT);
  assert.equal(normalizeOpenRouterDecisionsEndpoint('https://openrouter.ai/api/alpha/decisions/'),OPENROUTER_DECISIONS_ENDPOINT);
});

test('qualification probes the dedicated key then performs a real typed Noul Decisions call',async()=>{
  const calls=[];
  const adapter=createOpenRouterJevDecisionAdapter({
    providerId:'provider:jev',modelId:'jev-1.13',endpoint:'https://openrouter.ai/api/v1',apiKey:'sk-or-live',capabilities:['SEMANTIC_JUDGMENT'],
    fetchImpl:async(url,init)=>{
      calls.push({url,method:init.method,headers:{...init.headers},body:init.body?JSON.parse(init.body):null});
      if(url===OPENROUTER_KEY_ENDPOINT)return response(200,{data:{label:'Area52'}});
      if(url===OPENROUTER_DECISIONS_ENDPOINT)return response(200,{
        model:'typesafe/jev-1.13-20260917',provider:'TypeSafe',id:'gen-dec-probe',
        answers:{reachable:{type:'noul',noul:0.99}},usage:{input_tokens:12,output_tokens:1,cost:0.000001},
      });
      return response(404,{error:{message:'unexpected URL'}});
    },
  });
  const probe=await adapter.probe();
  assert.equal(probe.ok,true);assert.equal(probe.transportMode,'DECISIONS');assert.equal(probe.decisionProtocol,OPENROUTER_JEV_PROTOCOL);
  assert.equal(probe.qualificationPrimitive,'noul');assert.equal(probe.physicalExecution,true);
  assert.equal(calls.length,2);assert.equal(calls[0].url,OPENROUTER_KEY_ENDPOINT);assert.equal(calls[0].method,'GET');
  assert.equal(calls[1].url,OPENROUTER_DECISIONS_ENDPOINT);assert.equal(calls[1].method,'POST');
  assert.equal(calls[1].body.model,'typesafe/jev-1.13');
  assert.deepEqual(Object.keys(calls[1].body).sort(),['model','questions','state']);
  assert.equal(calls[1].body.questions.reachable.type,'noul');
  assert.equal('messages' in calls[1].body,false);assert.equal('stream' in calls[1].body,false);assert.equal('chat_completion_source' in calls[1].body,false);
  assert.equal(calls[1].headers.Authorization,'Bearer sk-or-live');
  assert.doesNotMatch(JSON.stringify(adapter),/sk-or-live/);
});

test('typed Choice answers map deterministically into the existing Area-52 Jev provider output',async()=>{
  let posted=null;
  const adapter=createOpenRouterJevDecisionAdapter({
    providerId:'provider:jev',modelId:'typesafe/jev-1.13',apiKey:'sk-or-choice',capabilities:['SEMANTIC_JUDGMENT'],
    fetchImpl:async(url,init)=>{
      posted={url,body:JSON.parse(init.body)};
      return response(200,{model:'typesafe/jev-1.13-20260917',provider:'TypeSafe',id:'gen-dec-choice',usage:{input_tokens:44,output_tokens:5,cost:0.000004},
        answers:{selection:{type:'choice',choice:'alpha',probabilities:{alpha:0.91,beta:0.09},confidence:0.82}}});
    },
  });
  const invocation=await adapter.invoke({taskType:'JEV_DECISION'},decisionInput('CHOOSE_ONE'));
  const mapped=JSON.parse(invocation.text);
  assert.equal(posted.url,OPENROUTER_DECISIONS_ENDPOINT);
  assert.equal(posted.body.questions.selection.type,'choice');
  assert.equal(posted.body.questions.selection.criteria.alpha.includes('Alpha'),true);
  assert.deepEqual(mapped.selectedOptionIds,['alpha']);assert.deepEqual(mapped.rejectedOptionIds,['beta']);
  assert.deepEqual(mapped.evidenceUsed,['ev:a']);assert.equal(mapped.outcome,'DECIDED');assert.equal(mapped.decisionCode,'CHOOSE_ONE');
  assert.equal(mapped.confidence,0.82);assert.deepEqual(mapped.reasonCodes,['JEV_TYPED_CHOICE']);
  assert.equal(invocation.metadata.decisionProtocol,'alpha/decisions');assert.equal(invocation.metadata.physicalExecution,true);
  assert.equal(invocation.usage.input_tokens,44);assert.equal(invocation.metadata.providerRequestId,'gen-dec-choice');
});

test('typed Score answers rank bounded options without free-form completion parsing',async()=>{
  const adapter=createOpenRouterJevDecisionAdapter({
    providerId:'provider:jev',modelId:'typesafe/jev-1.13',apiKey:'sk-or-score',capabilities:['SEMANTIC_JUDGMENT'],
    fetchImpl:async(url,init)=>{
      const body=JSON.parse(init.body);
      assert.equal(body.questions.rank_0.type,'score');assert.equal(body.questions.rank_1.type,'score');
      return response(200,{model:'typesafe/jev-1.13',provider:'TypeSafe',answers:{
        rank_0:{type:'score',score:2.8,confidence:0.76,probabilities:{0:0,1:0.05,2:0.1,3:0.85}},
        rank_1:{type:'score',score:1.2,confidence:0.63,probabilities:{0:0.1,1:0.65,2:0.2,3:0.05}},
      },usage:{input_tokens:55,output_tokens:8}});
    },
  });
  const invocation=await adapter.invoke({taskType:'JEV_DECISION'},decisionInput('RANK_BOUNDED_OPTIONS'));
  const mapped=JSON.parse(invocation.text);
  assert.deepEqual(mapped.selectedOptionIds,['alpha','beta']);assert.equal(mapped.decisionCode,'RANK_BOUNDED_OPTIONS');
  assert.deepEqual(mapped.reasonCodes,['JEV_TYPED_SCORE']);assert.equal(mapped.outcome,'DECIDED');
});

test('HTTP 401 and 400 remain distinct and never echo the credential',async()=>{
  const key='sk-or-never-log-this';
  const unauthorized=createOpenRouterJevDecisionAdapter({providerId:'provider:jev',modelId:'typesafe/jev-1.13',apiKey:key,fetchImpl:async()=>response(401,{error:{message:'Unauthorized'}})});
  await assert.rejects(unauthorized.probe(),error=>error?.code==='PROVIDER_UNAUTHORIZED'&&error?.status===401&&!String(error.message).includes(key));

  const badRequest=createOpenRouterJevDecisionAdapter({providerId:'provider:jev',modelId:'typesafe/jev-1.13',apiKey:key,fetchImpl:async()=>response(400,{error:{message:'Invalid decisions request'}})});
  await assert.rejects(badRequest.invoke({taskType:'JEV_DECISION'},decisionInput('CHOOSE_ONE')),error=>error?.code==='PROVIDER_FAILURE'&&error?.status===400&&/Invalid decisions request/.test(error.message)&&!String(error.message).includes(key));
});
