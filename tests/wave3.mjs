import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthorityClass,SettlementDecisionType,
} from '../src/contracts.js';
import {
  ResultClass,ResultDestination,ResultFreshness,ResultPayloadClass,RetrievalConfidence,
  createCognitiveResult,
} from '../src/publication-contracts.js';
import { ResultBus } from '../src/result-bus.js';
import { TruthPublicationGate } from '../src/truth-publication-gate.js';
import { DeterministicPrecisionStub,rankIntentOpposites } from '../src/precision-contract.js';
import { GenerationContextSeal,hashPacket } from '../src/context-seal.js';
import { benchmarkContextCompression,buildContextOrderVariants,compareContextOrderMeasurements } from '../src/context-benchmarks.js';
import { Area52CognitiveCore } from '../src/cognitive-core.js';
import { EMBER_TAVERN_WAVE3 } from './fixtures/ember-tavern-wave3.js';
import { runWave3PublicationGoldenWorld } from './wave3-golden-harness.js';

function loadWave3(core=new Area52CognitiveCore()){
  for(const source of EMBER_TAVERN_WAVE3.sources)core.importAndLearn(source);
  for(const source of EMBER_TAVERN_WAVE3.experiences)core.importAndLearn(source);
  return core;
}

test('Wave 3 publication contracts are deterministic and serializable',()=>{
  const result=createCognitiveResult({
    id:'result:1',taskId:'task:1',turnId:'turn:1',correlationId:'corr:1',
    sourceSubsystem:'TEST',resultType:'DERIVED',resultClass:ResultClass.REQUIRED,
    payloadClass:ResultPayloadClass.DERIVED_DATA,evidenceIds:['e1'],provenance:{p:1},
    sourceRevisionIds:['s@1'],worldRevision:2,sceneRevision:3,authorityClass:'UNRESOLVED',
    destination:ResultDestination.FOREGROUND,payload:{x:1},
  });
  assert.doesNotThrow(()=>JSON.stringify(result));
  assert.equal(result.destination,ResultDestination.FOREGROUND);
  assert.equal(result.correlationId,'corr:1');
});

test('Result Bus separates fresh, stale, invalid, and routed state',()=>{
  let sealed=false;
  const registry={isActiveRevision:(id)=>id==='s@2'};
  const bus=new ResultBus({registry,getWorldRevision:()=>5,getSceneRevision:()=>2,isTurnSealed:()=>sealed});
  const base={
    taskId:'task',turnId:'turn',correlationId:'corr',sourceSubsystem:'TEST',resultType:'DATA',
    resultClass:ResultClass.REQUIRED,payloadClass:ResultPayloadClass.DERIVED_DATA,evidenceIds:[],provenance:{},
    authorityClass:'UNRESOLVED',destination:ResultDestination.FOREGROUND,payload:{ok:true},
  };
  const fresh=bus.receive({...base,id:'fresh',sourceRevisionIds:['s@2'],worldRevision:5,sceneRevision:2});
  assert.equal(fresh.route.freshness,ResultFreshness.FRESH);
  assert.equal(fresh.route.effectiveDestination,ResultDestination.FOREGROUND);

  const stale=bus.receive({...base,id:'stale',sourceRevisionIds:['s@1'],worldRevision:5,sceneRevision:2});
  assert.equal(stale.route.freshness,ResultFreshness.STALE);
  assert.equal(stale.route.effectiveDestination,ResultDestination.EVALUATION);
  assert.equal(stale.route.accepted,true);

  const invalid=bus.receive({...base,id:'future',sourceRevisionIds:['s@2'],worldRevision:6,sceneRevision:2});
  assert.equal(invalid.route.freshness,ResultFreshness.INVALID);
  assert.equal(invalid.route.accepted,false);

  sealed=true;
  const late=bus.receive({...base,id:'late',sourceRevisionIds:['s@2'],worldRevision:5,sceneRevision:2,resultClass:ResultClass.OPPORTUNISTIC});
  assert.equal(late.route.late,true);
  assert.equal(late.route.effectiveDestination,ResultDestination.NEXT_TURN);
});

test('Result Bus receipt never grants proposal mutation authority',()=>{
  const bus=new ResultBus({registry:{isActiveRevision:()=>true},getWorldRevision:()=>1,getSceneRevision:()=>0});
  let canonicalMutations=0;
  const proposal={id:'proposal:test',owner:'WORLD_STATE'};
  const received=bus.receive({
    id:'proposal-result',taskId:'worker:1',turnId:'t1',correlationId:'c1',sourceSubsystem:'WORKER',
    destinationOwner:'WORLD_STATE',resultType:'MUTATION_PROPOSAL',resultClass:ResultClass.REQUIRED,
    payloadClass:ResultPayloadClass.PROPOSAL,evidenceIds:[],provenance:{},sourceRevisionIds:[],
    worldRevision:1,sceneRevision:0,authorityClass:AuthorityClass.OBSERVED,
    destination:ResultDestination.SETTLEMENT,payload:proposal,
  });
  assert.equal(received.route.effectiveDestination,ResultDestination.SETTLEMENT);
  assert.equal(canonicalMutations,0);
});

test('Settlement boundary rejects unsupported owners and supports explicit approval policy without partial mutation',()=>{
  const core=new Area52CognitiveCore();
  const learned=core.importAndLearn({id:'owner-policy',sourceType:'LORE',content:'The Relic is intact.',at:0});
  const proposal=structuredClone(learned.result.proposals.find(p=>p.mutationType==='SET_CLAIM'));
  const unsupported={...proposal,id:'unsupported-owner',owner:'UNKNOWN_OWNER'};
  const before=core.graph.allClaims().length;
  const rejected=core.settlement.settle(unsupported);
  assert.equal(rejected.decision.decision,SettlementDecisionType.REJECT);
  assert.equal(core.graph.allClaims().length,before);
  assert.ok(rejected.audit.validationResults.some(v=>v.stage==='owner-policy'));

  let mutations=0;
  core.settlement.registerOwner('CHARACTER_STATE',{
    approval:'REQUIRED',validate:()=>({ok:true,stage:'character-policy',reason:'shape accepted'}),
    settle:(p)=>{mutations+=1;return{decision:{
      kind:'SettlementDecision',id:'character-decision',proposalId:p.id,decision:SettlementDecisionType.ACCEPT_CURRENT,
      owner:'CHARACTER_STATE',evidenceIds:p.evidenceIds,sourceRevisionIds:p.sourceRevisionIds,
      worldRevision:core.graph.revision,reason:'approved test policy',consideredClaimIds:[],receiptId:null,diagnostics:{},
    },receipt:null};},
  });
  const pending=core.settlement.settle({...proposal,id:'needs-approval',owner:'CHARACTER_STATE'});
  assert.equal(pending.decision.decision,SettlementDecisionType.UNRESOLVED);
  assert.equal(pending.audit.approvalState,'PENDING_APPROVAL');
  assert.equal(mutations,0);
  const approved=core.settlement.settle({...proposal,id:'approved',owner:'CHARACTER_STATE'},{operatorApproved:true});
  assert.equal(approved.decision.decision,SettlementDecisionType.ACCEPT_CURRENT);
  assert.equal(mutations,1);
});

test('Settlement freshness rejection causes no partial mutation and emits explainable audit',()=>{
  const core=new Area52CognitiveCore();
  const learned=core.importAndLearn({id:'stale-settlement',sourceType:'LORE',content:'The Relic is intact.',at:0});
  const proposal=structuredClone(learned.result.proposals.find(p=>p.mutationType==='SET_CLAIM'));
  core.registry.replaceSource('stale-settlement','The Relic is damaged.');
  const before=JSON.stringify(core.graph.currentProjection());
  const rejected=core.settlement.settle(proposal);
  assert.equal(rejected.decision.decision,SettlementDecisionType.REJECT);
  assert.match(rejected.decision.reason,/missing|invalid|stale/i);
  assert.ok(rejected.audit.validationResults.some(v=>['evidence','freshness'].includes(v.stage)));
  assert.equal(JSON.stringify(core.graph.currentProjection()),before);
  assert.equal(core.settlement.explain(rejected.audit.id).proposalId,proposal.id);
});

test('Truth publication policy distinguishes HIGH, MIXED, and LOW confidence',()=>{
  const highCore=new Area52CognitiveCore();
  highCore.importAndLearn({id:'high',sourceType:'LORE',content:'The Relic is intact.',at:0});
  const highCandidates=highCore.retrieval.retrieve('What is the Relic state?',{intent:'CURRENT',anchorEntityIds:['relic']});
  const highGate=new TruthPublicationGate({truthGate:highCore.truthGate,graph:highCore.graph});
  const high=highGate.assess(highCandidates,{query:'What is the Relic state?',intent:'CURRENT',worldRevision:highCore.graph.revision});
  assert.equal(high.confidence,RetrievalConfidence.HIGH);
  assert.equal(high.correctiveRequest,null);

  const mixedCore=loadWave3();
  const mixedCandidates=mixedCore.retrieval.retrieve(EMBER_TAVERN_WAVE3.query,{intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors});
  const mixedGate=new TruthPublicationGate({truthGate:mixedCore.truthGate,graph:mixedCore.graph});
  const mixed=mixedGate.assess(mixedCandidates,{query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',worldRevision:mixedCore.graph.revision});
  assert.equal(mixed.confidence,RetrievalConfidence.MIXED);
  assert.ok(mixed.correctiveRequest);

  const lowCore=new Area52CognitiveCore();
  const lowGate=new TruthPublicationGate({truthGate:lowCore.truthGate,graph:lowCore.graph});
  const low=lowGate.assess([],{query:'Who is the Moon Emperor?',intent:'CURRENT',worldRevision:0});
  assert.equal(low.confidence,RetrievalConfidence.LOW);
  assert.equal(low.correctiveRequest,null);
});

test('corrective retrieval terminates deterministically after the configured bound',()=>{
  const core=loadWave3();
  const gate=new TruthPublicationGate({truthGate:core.truthGate,graph:core.graph});
  const candidates=core.retrieval.retrieve(EMBER_TAVERN_WAVE3.query,{intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors});
  const first=gate.assess(candidates,{query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',worldRevision:core.graph.revision,maxCorrectiveAttempts:1});
  const corrective=gate.executeCorrective(first,{retrieval:core.retrieval,anchorEntityIds:EMBER_TAVERN_WAVE3.anchors});
  assert.equal(corrective.executed,true);
  assert.equal(corrective.terminated,true);
  const merged=new Map(candidates.map(c=>[c.candidateId,c]));
  corrective.candidates.forEach(c=>merged.set(c.candidateId,c));
  const second=gate.assess([...merged.values()],{query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',worldRevision:core.graph.revision,attempt:1,maxCorrectiveAttempts:1,allowHistoricalSupport:true});
  assert.equal(second.confidence,RetrievalConfidence.MIXED);
  assert.equal(second.correctiveRequest,null);
});

test('deterministic precision separates intent-opposite fixtures',()=>{
  const cases=[
    ['kill dragon',['heal dragon','kill dragon'],'kill dragon'],
    ['enter dungeon',['leave dungeon','enter dungeon'],'enter dungeon'],
    ['trust Mara',['distrust Mara','trust Mara'],'trust Mara'],
    ['weapon intact',['weapon destroyed','weapon intact'],'weapon intact'],
    ['character present',['character departed','character present'],'character present'],
    ['current tavern',['historical tavern','current tavern'],'current tavern'],
  ];
  for(const[query,texts,expected]of cases){
    const ranked=rankIntentOpposites(query,texts,{intent:'CURRENT'});
    assert.equal(ranked[0].text,expected,query);
    assert.equal(ranked[0].finalRank,1);
    assert.ok(ranked[0].normalizedScore>=ranked[1].normalizedScore);
  }
});

test('precision result carries freshness and becomes stale when revision fences differ',()=>{
  const stub=new DeterministicPrecisionStub();
  const [result]=stub.rank([{candidateId:'c1',text:'current tavern',sourceId:'c1',claimIds:[],temporalStatus:'CURRENT',scoreSignals:{}}],
    {query:'current tavern',intent:'CURRENT',worldRevision:5,sceneRevision:3,inputWorldRevision:4,inputSceneRevision:3});
  assert.equal(result.freshness,'STALE');
  assert.equal(result.worldRevision,4);
});

test('LOW confidence publication may seal an empty long-term-memory packet',()=>{
  const core=new Area52CognitiveCore();
  const out=core.publishGenerationContext({turnId:'empty:1',correlationId:'empty:c1',query:'Who is the Moon Emperor?',intent:'CURRENT',anchorEntityIds:[],sealedAt:1});
  assert.equal(out.assessment.confidence,RetrievalConfidence.LOW);
  assert.equal(out.packet.current.length,0);
  assert.equal(out.packet.historical.length,0);
  assert.equal(out.packet.unresolved.length,0);
  assert.equal(out.sealReceipt.packetHash,hashPacket(out.packet));
});

test('Context Seal is deterministic, immutable, and rejects a conflicting reseal',()=>{
  const seal=new GenerationContextSeal();
  const original={id:'packet:test',dependencies:['s@1'],current:[{e:'x',p:'state',v:'current'}],historical:[],unresolved:[],provenanceIndex:{}};
  const first=seal.seal({turnId:'turn:seal',correlationId:'corr:seal',packet:original,sourceRevisionIds:['s@1'],worldRevision:1,sceneRevision:2,sequence:1,sealedAt:10});
  original.current[0].v='mutated outside';
  assert.equal(first.packet.current[0].v,'current');
  assert.equal(Object.isFrozen(first.packet),true);
  assert.equal(seal.verify('turn:seal').hashMatches,true);
  const duplicate=seal.seal({turnId:'turn:seal',correlationId:'corr:seal',packet:structuredClone(first.packet),sourceRevisionIds:['s@1'],worldRevision:1,sceneRevision:2,sealedAt:10});
  assert.equal(duplicate.duplicate,true);
  assert.throws(()=>seal.seal({turnId:'turn:seal',correlationId:'corr:seal',packet:{...structuredClone(first.packet),id:'different'},sourceRevisionIds:['s@1'],worldRevision:1,sceneRevision:2}),/already sealed/);
});

test('integrated Wave 3 golden world publishes truthful context and quarantines late cognition',()=>{
  const scored=runWave3PublicationGoldenWorld();
  assert.equal(scored.pass,true,JSON.stringify(scored.metrics,null,2));
  assert.equal(scored.metrics.truthConfidence,'MIXED');
  assert.equal(scored.metrics.correctiveExecuted,true);
  assert.equal(scored.metrics.correctiveTerminated,true);
  assert.equal(scored.metrics.currentTavern,true);
  assert.equal(scored.metrics.historicalDeposit,true);
  assert.equal(scored.metrics.unknownLocation,true);
  assert.equal(scored.metrics.falseCurrentLocation,false);
  assert.equal(scored.metrics.lateRoutedTo,'NEXT_TURN');
  assert.equal(scored.metrics.packetHashStableAfterLate,true);
  assert.equal(scored.metrics.packetHashStableAfterEdit,true);
  assert.equal(scored.metrics.futureUsesNewRevision,true);
});

test('publication compiler uses richer fallback instead of losing required truth under impossible budget',()=>{
  const core=loadWave3();
  const out=core.publishGenerationContext({turnId:'budget:1',correlationId:'budget:c1',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,budgetBytes:1,sealedAt:1});
  assert.equal(out.compilerReceipt.fallbackUsed,true);
  assert.equal(out.compilerReceipt.representation,'RICH_FALLBACK');
  assert.equal(out.compilerReceipt.factualRetention,1);
  assert.equal(out.compilerReceipt.temporalRetention,1);
  assert.equal(out.compilerReceipt.contradictionRetention,1);
  assert.equal(out.compilerReceipt.provenanceRetention,1);
  assert.ok(out.packet.unresolved.some(f=>f.e==='sun-blade'));
  assert.ok(out.packet.historical.some(f=>f.e==='sun-blade'&&f.p==='location'));
});

test('context compression benchmark rejects token savings that lose cognition and passes retained golden packet',()=>{
  const scored=runWave3PublicationGoldenWorld();
  const packet=scored.published.packet;
  const facts=[...packet.current,...packet.historical,...packet.unresolved].filter(f=>f.v!=='unknown');
  const rawRepresentation={
    exactEvidence:EMBER_TAVERN_WAVE3.sources.concat(EMBER_TAVERN_WAVE3.experiences).map(x=>({source:x,verbatim:x.content.repeat(6)})),
    duplicatedFacts:facts.flatMap(f=>[f,f,f]),
  };
  const temporal=packet.historical.filter(f=>Array.isArray(f.t)).map(f=>({e:f.e,p:f.p,v:f.v,status:f.t[2],validFrom:f.t[0],validUntil:f.t[1]}));
  const provenance=Object.entries(packet.provenanceIndex).map(([factId,sourceRevisionIds])=>({factId,sourceRevisionIds}));
  const bench=benchmarkContextCompression({
    rawRepresentation,compiledPacket:packet,
    requirements:{facts,temporal,unresolved:packet.unresolved.filter(f=>f.v!=='unknown'),provenance,relationships:[]},
  });
  assert.equal(bench.pass,true,JSON.stringify(bench,null,2));
  assert.equal(bench.factualRetention,1);
  assert.equal(bench.temporalRetention,1);
  assert.equal(bench.contradictionRetention,1);
  assert.equal(bench.provenanceRetention,1);
  assert.ok(bench.compiledBytes<bench.rawBytes);
  assert.ok(bench.compressionRatio<1);
});

test('position benchmark produces reusable order variants without declaring a provider-specific winner',()=>{
  const variants=buildContextOrderVariants({
    current:['current'],character:['character'],unresolved:['unresolved'],supportingLore:['lore'],historical:['history'],
  });
  assert.equal(variants.length,5);
  assert.equal(new Set(variants.map(v=>v.order.join('|'))).size,5);
  assert.ok(new Set(variants.map(v=>v.positionIndex.current)).size>1);
  const comparison=compareContextOrderMeasurements(variants,[]);
  assert.equal(comparison.every(x=>x.measurement===null),true);
});

test('sealed generation stays historically stable while future generation rebuilds from new revision',()=>{
  const scored=runWave3PublicationGoldenWorld();
  const old=scored.core.publication.seal.getReceipt('turn:w3:1');
  const future=scored.core.publication.seal.getReceipt('turn:w3:2');
  assert.notEqual(old.packetHash,future.packetHash);
  assert.equal(old.sourceRevisionIds.includes('w3:journal@1'),true);
  assert.equal(future.sourceRevisionIds.includes('w3:journal@2'),true);
  assert.equal(future.sourceRevisionIds.includes('w3:journal@1'),false);
});
