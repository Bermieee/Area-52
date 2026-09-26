const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
const freezeDeep=(v)=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))freezeDeep(x);Object.freeze(v);}return v;};

export const FunctionTestReadinessState=Object.freeze({PASS:'PASS',READY:'READY',PARTIAL:'PARTIAL',BLOCKED:'BLOCKED',NOT_RUN:'NOT_RUN'});
const STATES=new Set(Object.values(FunctionTestReadinessState));
const order={BLOCKED:5,NOT_RUN:4,PARTIAL:3,READY:2,PASS:1};
function component(name,state,evidenceRefs=[],blockers=[]){if(!STATES.has(state))throw new TypeError('invalid readiness state');return{name,state,evidenceRefs:uniq(evidenceRefs),blockers:uniq(blockers)};}
function overall(components){if(components.every(x=>x.state==='PASS'))return'PASS';if(components.some(x=>x.state==='BLOCKED'))return'BLOCKED';if(components.some(x=>x.state==='NOT_RUN'))return'NOT_RUN';if(components.some(x=>x.state==='PARTIAL'))return'PARTIAL';return'READY';}

export function createFunctionTestBlockerMatrix({
  ft001LiveGreen=true,
  sceneAcceptedCheckpoint='5ad7567225720292d759d4a75afe84479deb6c1a',
  coprocessorAcceptedCheckpoint='8eca22f0ae474a77914d8606148e433965aff205',
  runtimeCheckpoint='890f8576bcfcc4c056b959271027242dc6af7d7c',
  coreCheckpoint,
}={}){
  const rows=[
    {test:'FT001',components:[component('integratedMain',ft001LiveGreen?'PASS':'BLOCKED',ft001LiveGreen?['main:ft001-live-green']:[],ft001LiveGreen?[]:['FT001 live regression'])]},
    {test:'FT002',components:[
      component('Core','READY',[coreCheckpoint,'FT002_CORE_PREFLIGHT']),
      component('Scene','READY',[sceneAcceptedCheckpoint,'scene-wave2-accepted']),
      component('Coprocessor','READY',[coprocessorAcceptedCheckpoint,'coprocessor-public-contracts']),
      component('Runtime','READY',[runtimeCheckpoint]),
      component('Host','BLOCKED',[],['live SillyTavern FT002 not executed']),
      component('MainAssembly','BLOCKED',[],['accepted-lane assembly not applied to main']),
    ]},
    {test:'FT003',components:[
      component('Core','READY',[coreCheckpoint,'FT003_CORE_PREFLIGHT']),
      component('Memory','BLOCKED',[],['Development-Memory remains foundation']),
      component('Sensory','BLOCKED',[],['real Sensory retrieval path missing']),
      component('Precision','READY',[coprocessorAcceptedCheckpoint,'coprocessor precision Wave 4']),
      component('Host','BLOCKED',[],['live SillyTavern FT003 not executed']),
    ]},
    {test:'FT004',components:[
      component('Core','READY',[coreCheckpoint,'FT004_CORE_PREFLIGHT']),
      component('Lore','BLOCKED',[],['Development-Lorebook-Editor remains foundation']),
      component('Sensory','BLOCKED',[],['real Sensory retrieval path missing']),
      component('Precision','READY',[coprocessorAcceptedCheckpoint,'coprocessor precision Wave 4']),
      component('Host','BLOCKED',[],['live SillyTavern FT004 not executed']),
    ]},
    {test:'FT005',components:[
      component('Core','READY',[coreCheckpoint,'FT005_CORE_PREFLIGHT']),
      component('Providers','PARTIAL',[coprocessorAcceptedCheckpoint,'FT005_PROVIDER_READINESS'],['real external provider fallback run pending']),
      component('Runtime','READY',[runtimeCheckpoint]),
      component('Host','BLOCKED',[],['live provider execution in SillyTavern pending']),
    ]},
    {test:'FT006',components:[
      component('Harness','READY',[coreCheckpoint,'RepresentativeWorkloadHarness']),
      component('Scene','READY',[sceneAcceptedCheckpoint]),
      component('Lore','BLOCKED',[],['real Lore missing']),
      component('Memory','BLOCKED',[],['real Memory missing']),
      component('Shadow','PARTIAL',[coreCheckpoint,'Nexus replay adapter'],['live Nexus runtime connection not executed']),
      component('UI','PARTIAL',[coreCheckpoint,'Core read models'],['visual UI acceptance remains UI-owned']),
    ]},
  ];
  for(const row of rows)row.state=overall(row.components);
  return freezeDeep({kind:'FunctionTestBlockerMatrix',schemaVersion:'2.0.0',allowedStates:[...STATES],rows,liveAcceptanceOnlyWhenExplicit:true});
}

export function createPhase1RemainingWorkGraph({blockerMatrix,acceptedCheckpoints={},movingHeads={}}={}){
  const nodes=[],edges=[];
  const add=(id,type,state,details={})=>{nodes.push({id,type,state,...clone(details)});return id;};
  const dep=(from,to,reason)=>edges.push({from,to,reason});
  for(const row of blockerMatrix?.rows??[]){
    add(row.test,'FUNCTION_TEST',row.state);
    for(const c of row.components){
      const id=row.test+':'+c.name;add(id,'DEPENDENCY',c.state,{blockers:[...c.blockers],evidenceRefs:[...c.evidenceRefs]});dep(row.test,id,'REQUIRES');
    }
  }
  add('PHASE1_GATE','GATE','BLOCKED',{rule:'No automatic Phase 2 promotion'});
  for(const row of blockerMatrix?.rows??[])if(row.test!=='FT001')dep('PHASE1_GATE',row.test,'REQUIRES_FUNCTION_TEST');
  add('MAIN_ASSEMBLY','INTEGRATION','BLOCKED');add('BROWSER_LIVE_GATE','INTEGRATION','BLOCKED');add('NEXUS_LIVE_SHADOW','INTEGRATION','PARTIAL');
  dep('FT002','MAIN_ASSEMBLY','LIVE_PATH');dep('FT002','BROWSER_LIVE_GATE','LIVE_PATH');
  dep('FT005','MAIN_ASSEMBLY','LIVE_PATH');dep('FT005','BROWSER_LIVE_GATE','LIVE_PATH');
  dep('FT006','NEXUS_LIVE_SHADOW','SHADOW_QUALIFICATION');
  return freezeDeep({kind:'Phase1RemainingWorkGraph',schemaVersion:'2.0.0',nodes,edges,acceptedCheckpoints:clone(acceptedCheckpoints),movingHeads:clone(movingHeads)});
}

export function createUiReadModelRegistry(){
  const health=['READY','WORKING','DEGRADED','STALE','BLOCKED','ERROR'];
  const base={version:'1.0.0',sourceSubsystem:'CORE',revisionIdentity:['worldRevision','sceneRevision','sourceRevisionRefs'],healthVocabulary:health,mutationAuthority:false};
  return freezeDeep({kind:'UiReadModelRegistry',schemaVersion:'1.0.0',models:[
    {...base,modelId:'ContextReceiptReadModel',authorityFields:['authority','mutationAuthority'],staleDetection:['turnId','generationId','worldRevision','sceneRevision','contextSealId','promptPlanId']},
    {...base,modelId:'PromptPlanReadModel',authorityFields:['authority','mutationAuthority'],staleDetection:['turnId','generationId','worldRevision','sceneRevision','contextSealId','promptPlanId']},
    {...base,modelId:'ForensicReadModel',authorityFields:['authority','mutationAuthority'],staleDetection:['turnId','generationId','worldRevision','sceneRevision','contextSealRef','promptPlanRef']},
    {...base,modelId:'KnowledgeTraceReadModel',authorityFields:['authority','mutationAuthority','temporalStatus'],staleDetection:['freshness','sourceRevisionRefs']},
  ]});
}

export function createPhase1GateReportV2({
  checkpoint,acceptedCheckpoints={},movingHeads={},contractReconciliation=null,contractDrift=null,functionTests=null,
  browserReadiness='PARTIAL',assemblyReadiness='READY',uiReadiness='READY',loreStatus='BLOCKED',memoryStatus='BLOCKED',remainingBlockers=[],
}={}){
  return freezeDeep({
    kind:'Phase1GateReportV2',schemaVersion:'2.0.0',checkpoint:checkpoint??null,state:'BLOCKED',
    acceptedCheckpoints:clone(acceptedCheckpoints),movingHeads:clone(movingHeads),contractReconciliation:clone(contractReconciliation),
    contractDrift:clone(contractDrift),functionTests:clone(functionTests),browserReadiness,assemblyReadiness,uiReadiness,loreStatus,memoryStatus,
    remainingBlockers:uniq(remainingBlockers),phase2PromotionAllowed:false,promotionDecision:null,
    rule:'Phase 1 remains BLOCKED until integrated live requirements are met.',
  });
}
