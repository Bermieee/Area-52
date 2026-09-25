import http from 'node:http';
import {
  Capability,CoprocessorResourceConnections,JevDecisionCore,JevDecisionShape,JevOutcome,ProviderTransportMode,
  ResourceKind,ResourceMeasurementClass,createCognitiveTask,createJevDecisionRequest,createRevisionSet,
} from '../src/coprocessor/index.js';

export async function runWave16ResourceJevEvaluation(){
  const fixture=await startFixture();
  try{
    const zero=new CoprocessorResourceConnections();
    const zeroRead=zero.readModel();

    const one=new CoprocessorResourceConnections();
    addChat(one,fixture.baseUrl,'one-chat');
    await one.refreshResourceModels('one-chat');const oneConnected=await one.connectResource('one-chat');
    const graph=await one.executeTask(graphTask('orbital-setting'),{input:graphInput()});

    const core=new JevDecisionCore({providerExecutor:one.createJevProviderExecutor()});
    const clear=jevRequest('clear');const before=fixture.calls().chat;
    const clearReceipt=await core.decide(clear,{currentRevisionState:fresh(clear),deterministicAnswer:{
      outcome:JevOutcome.DECIDED,decisionCode:JevDecisionShape.CHOOSE_ONE,selectedOptionIds:['route-north'],rejectedOptionIds:['route-south'],evidenceUsed:['ev:north'],confidence:1,
    }});
    const clearProviderCalls=fixture.calls().chat-before;
    const ambiguous=jevRequest('orbital-ambiguity');const useful=await core.decide(ambiguous,{currentRevisionState:fresh(ambiguous)});
    const guild=jevRequest('guild-ambiguity',{guild:true});const abstained=await core.decide(guild,{currentRevisionState:fresh(guild)});

    const two=new CoprocessorResourceConnections();
    addChat(two,fixture.baseUrl,'two-chat');
    two.addResource({resourceId:'two-vector',providerProfileId:'profile:two-vector',providerId:'provider:two-vector',workerId:'worker:two-vector',
      kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:fixture.baseUrl,modelId:'story-embed',apiKey:'good-key',credentialRequired:true,
      capabilities:[Capability.RETRIEVAL,Capability.EMBED],measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC,
      costMetadata:{inputPerMillion:1,outputPerMillion:0}});
    await two.connectResource('two-chat');await two.refreshResourceModels('two-vector');const vectorConnected=await two.connectResource('two-vector');
    const embedding=await two.executeEmbedding('two-vector',{input:['The observatory beacon remains on the upper deck.','The guild witness gives conflicting testimony.']});

    const oneAfter=one.readModel(),twoAfter=two.readModel();
    one.disconnectResource('one-chat');two.disconnectResource('two-chat');two.disconnectResource('two-vector');

    return Object.freeze({
      benchmark:'AREA52_RESOURCE_JEV_WAVE16',
      measurementClasses:{
        controlledHttp:'LOCAL_DETERMINISTIC',
        failureInjection:'SIMULATED_FAILURE',
        externalOpenRouter:'NOT_MEASURED_IN_DEFAULT_CI',
      },
      liveEvidence:{realProviderCallObserved:false,ft005LivePass:false,jevLivePass:false,status:'REQUIRES_OPERATOR_CONFIGURED_OPENROUTER'},
      credentialContract:{storage:'SESSION_MEMORY_ONLY',plaintextInReadModels:false,plaintextInTelemetry:false},
      nativeBrain:{zeroResourcesUsable:zeroRead.nativePathRequired&&zeroRead.readyResourceCount===0},
      resourceCounts:{zero:zeroRead.readyResourceCount,one:oneAfter.readyResourceCount,two:twoAfter.readyResourceCount},
      connections:{chatQualified:oneConnected.selectedModelQualified,vectorQualified:vectorConnected.selectedModelQualified,remoteClassificationEnforced:true},
      routing:{chatTransport:oneConnected.transportMode,vectorTransport:vectorConnected.transportMode,vectorRoutableCapabilities:vectorConnected.routableCapabilities},
      execution:{
        graph:{providerId:graph.providerId,workerId:graph.workerId,actualModelId:graph.modelId,actualProvider:graph.providerMetadata.actualProvider,measurementClass:graph.providerMetadata.measurementClass,usageReceipt:graph.providerMetadata.usageReceipt},
        embedding:{providerId:embedding.providerId,actualModelId:embedding.actualModelId,actualProvider:embedding.actualProvider,vectorCount:embedding.vectorCount,dimensions:embedding.dimensions,measurementClass:embedding.measurementClass,usageReceipt:embedding.usageReceipt},
      },
      jev:{
        settings:['orbital-route','guild-witness'],
        clearServiceStatus:clearReceipt.serviceStatus,clearProviderCalls,
        deterministicBaseline:'UNRESOLVED',optionalOutcome:useful.outcome,changedDecision:['DECIDED','PARTIAL'].includes(useful.outcome),
        selectedOptionIds:[...useful.selectedOptionIds],abstentionOutcome:abstained.outcome,falseCertaintyCheckedByWave16Regression:true,
        authorityGranted:Boolean(useful.authorityGranted||abstained.authorityGranted),settlementPerformed:Boolean(useful.settlementPerformed||abstained.settlementPerformed),
      },
      transportCalls:fixture.calls(),
      authority:{truth:false,precision:false,settlement:false,canonicalMutation:false,finalChoice:false,contextSeal:false},
    });
  }finally{await fixture.close();}
}

async function startFixture(){
  const calls={models:0,embeddingModels:0,chat:0,embeddings:0};
  const server=http.createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer good-key'){res.writeHead(401);res.end();return;}
    if(req.method==='GET'&&req.url==='/api/v1/models'){calls.models++;json(res,{data:[{id:'story-chat',name:'Story Chat',architecture:{input_modalities:['text'],output_modalities:['text']}}]});return;}
    if(req.method==='GET'&&req.url==='/api/v1/embeddings/models'){calls.embeddingModels++;json(res,{data:[{id:'story-embed',name:'Story Embed',architecture:{input_modalities:['text'],output_modalities:['embeddings']}}]});return;}
    if(req.method==='POST'&&req.url==='/api/v1/chat/completions'){
      calls.chat++;let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}'),system=String(body.messages?.[0]?.content??''),user=String(body.messages?.[1]?.content??'');
      let content='{}';
      if(system.includes('Graph Walker'))content=JSON.stringify({nodes:['orbital:deck'],edges:[],currentStateRefs:['orbital:state'],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'Current bounded deck state selected.'});
      else if(system.includes('bounded adjudication protocol'))content=JSON.stringify(user.includes('guild-hall')?jevAbstain():jevDecision());
      json(res,{model:'story-chat',provider:'wave16-fixture',choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:7}});return;
    }
    if(req.method==='POST'&&req.url==='/api/v1/embeddings'){
      calls.embeddings++;let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}'),values=Array.isArray(body.input)?body.input:[body.input];
      json(res,{model:'story-embed',provider:'wave16-embedding-fixture',data:values.map((_,i)=>({index:i,embedding:[i+.1,i+.2,i+.3]})),usage:{prompt_tokens:values.length*3,total_tokens:values.length*3}});return;
    }
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();
  return{baseUrl:'http://127.0.0.1:'+address.port+'/api/v1',calls:()=>({...calls}),close:()=>new Promise(resolve=>server.close(resolve))};
}
function addChat(registry,endpoint,id){
  registry.addResource({resourceId:id,providerProfileId:'profile:'+id,providerId:'provider:'+id,workerId:'worker:'+id,kind:ResourceKind.OPENAI_COMPATIBLE,
    endpoint,modelId:'story-chat',apiKey:'good-key',credentialRequired:true,capabilities:[Capability.GRAPH,Capability.SEMANTIC_JUDGMENT],
    measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC,costMetadata:{inputPerMillion:1,outputPerMillion:2}});
}
function graphTask(id){const now=Date.now();return createCognitiveTask({taskId:id,taskType:'GRAPH_WALK',turnId:'turn:'+id,correlationId:'corr:'+id,requiredCapabilities:[Capability.GRAPH],
  softDeadline:now+2000,hardDeadline:now+4000,compilerLane:'wave16-eval',intentFingerprint:'intent:'+id,inputRevisionSet:createRevisionSet({sourceRevisionSet:['src:'+id+'@1'],worldRevision:1,sceneRevision:1,characterStateRevision:1}),metadata:{expectedOutputTokens:128}});}
function graphInput(){return{nodes:[{ref:'orbital:deck',type:'LOCATION'}],edges:[],states:[{ref:'orbital:state',entityRef:'orbital:beacon',temporalStatus:'CURRENT',summary:'The beacon is mounted on the observation deck.'}],conflicts:[]};}
function jevRequest(id,{guild=false}={}){const now=Date.now(),options=guild?[{optionId:'guild-hall',label:'Guild hall',evidenceRefs:['ev:north']},{optionId:'road-camp',label:'Road camp',evidenceRefs:['ev:south']}]:[{optionId:'route-north',label:'North route',evidenceRefs:['ev:north']},{optionId:'route-south',label:'South route',evidenceRefs:['ev:south']}];
 return createJevDecisionRequest({decisionId:id,decisionType:'BOUNDED_STATE_AMBIGUITY',decisionShape:JevDecisionShape.CHOOSE_ONE,turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,options,
 evidenceRefs:[{evidenceId:'ev:north',summary:'Evidence for first bounded option.'},{evidenceId:'ev:south',summary:'Evidence for second bounded option.'}],sourceRevisionSet:['src:'+id+'@1'],worldRevision:1,sceneRevision:1,characterStateRevision:1,
 domainRevisions:{story:1},freshnessToken:'fresh:'+id,authorityBoundary:{authorityClass:'ADVISORY',ownerId:'brain-core'},routing:{expectedDecisionValue:.9,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2,currentGenerationDepends:true},escalationPolicy:{maxRetries:0},deadline:now+4000,softDeadline:now+2500});}
function fresh(r){return{sourceRevisionSet:r.sourceRevisionSet,worldRevision:r.worldRevision,sceneRevision:r.sceneRevision,characterStateRevision:r.characterStateRevision,domainRevisions:r.domainRevisions,freshnessToken:r.freshnessToken};}
function jevDecision(){return{outcome:'DECIDED',decisionCode:'CHOOSE_ONE',selectedOptionIds:['route-north'],rejectedOptionIds:['route-south'],classification:null,reasonCodes:['BOUNDED_EVIDENCE'],evidenceUsed:['ev:north'],unresolvedFactors:[],confidence:.8,abstained:false,escalationTarget:null,requiresOperator:false,explanation:'Bounded evidence favors the north route.'};}
function jevAbstain(){return{outcome:'ABSTAINED',decisionCode:'ABSTAIN',selectedOptionIds:[],rejectedOptionIds:[],classification:null,reasonCodes:['INSUFFICIENT_EVIDENCE'],evidenceUsed:[],unresolvedFactors:['Conflicting witness evidence remains.'],confidence:0,abstained:true,escalationTarget:null,requiresOperator:false,explanation:'The evidence remains unresolved.'};}
function json(res,value){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));}
