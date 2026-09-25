import {
  Capability, CapabilityProfileRegistry, CognitiveSwarm, CoprocessorTelemetry,
  DeterministicContextSealFixture, DynamicFanOutPlanner, RecordingResultBusFixture,
  StructuredCompilerFixture, TurnEventHub,
} from '../../src/coprocessor/index.js';

export function createEmberTurn(overrides = {}) {
  return {
    turnId: 'turn:ember:001',
    eventId: 'turn-event:ember:001',
    eventType: 'TURN_EVENT',
    correlationId: 'corr:ember:001',
    causationId: 'user-send:ember:001',
    sourceRevisionSet: ['rev:fire','rev:journal','rev:tavern'],
    worldRevision: 44,
    sceneRevision: 12,
    characterStateRevision: 9,
    createdAt: 0,
    deadline: 120,
    cognitiveLayer: 'L1',
    requiredCapabilities: [],
    deliveryAttempt: 1,
    dedupeKey: 'turn:ember:001',
    ...overrides,
  };
}

export function createEmberPlannerInput(overrides = {}) {
  return {
    text: 'Eris returns to the ruined Ember Tavern looking for the Sun Blade while speaking to Mara.',
    queryIntent: 'CURRENT_STATE',
    activeCast: ['Eris','Mara'],
    activeThreads: ['Sun Blade fate'],
    conflictSignals: ['destroyed-in-fire vs removed-before-fire'],
    latencyBudgetMs: 120,
    ...overrides,
  };
}

export function createProfileRegistry({ alternateTruthOnly = false } = {}) {
  const registry = new CapabilityProfileRegistry();
  registry.register({
    profileId:'historian-local', workerId:'slot:historian', providerId:'fixture:historian',
    capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT], latencyClass:'LOW', reliability:1,
  });
  registry.register({
    profileId:'graph-local', workerId:'slot:graph', providerId:'fixture:graph',
    capabilities:[Capability.GRAPH], latencyClass:'LOW', reliability:1,
  });
  registry.register({
    profileId:'green-local', workerId:'slot:green', providerId:'fixture:green',
    capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.CHARACTER_INFERENCE], latencyClass:'MEDIUM', reliability:1,
  });
  if (!alternateTruthOnly) {
    registry.register({
      profileId:'jev-semantic-v1', workerId:'slot:semantic-a', providerId:'jev-provider',
      capabilities:[Capability.TRUTH_JUDGMENT,Capability.RERANK,Capability.SEMANTIC_JUDGMENT,Capability.CONFLICT_INTERPRETATION],
      latencyClass:'LOW', reliability:0.99,
    });
  }
  registry.register({
    profileId:'alternate-semantic-v1', workerId:'slot:semantic-b', providerId:'alternate-provider',
    capabilities:[Capability.TRUTH_JUDGMENT,Capability.RERANK,Capability.SEMANTIC_JUDGMENT,Capability.CONFLICT_INTERPRETATION],
    latencyClass: alternateTruthOnly ? 'LOW' : 'MEDIUM', reliability:0.98,
  });
  return registry;
}

export class DeterministicExecutionRouter {
  constructor({
    registry = createProfileRegistry(),
    failRoles = [],
    malformedFirstRoles = [],
    staleRoles = [],
    futureRoles = [],
    completion = {},
  } = {}) {
    this.registry = registry;
    this.failRoles = new Set(failRoles);
    this.malformedFirstRoles = new Set(malformedFirstRoles);
    this.staleRoles = new Set(staleRoles);
    this.futureRoles = new Set(futureRoles);
    this.completion = completion;
    this.dispatchLog = [];
  }

  async dispatch(task, { attempt = 1 } = {}) {
    const profiles = this.registry.eligibleProfiles(task);
    if (!profiles.length) throw new Error(`No eligible capability profile for ${task.taskId}`);
    const profile = profiles[0];
    const role = task.metadata.roleId;
    this.dispatchLog.push({ taskId:task.taskId, role, attempt, profileId:profile.profileId, providerId:profile.providerId, startedAt:0 });
    if (this.failRoles.has(role)) throw new Error(`fixture provider failure: ${role}`);
    if (this.malformedFirstRoles.has(role) && attempt === 1) return { malformed:true, taskId:task.taskId };
    return makeResult(task, profile, {
      completedAt:this.completion[role] ?? defaultCompletion(role),
      stale:this.staleRoles.has(role),
      future:this.futureRoles.has(role),
    });
  }
}

export function createEmberSwarm(options = {}) {
  const eventHub = options.eventHub ?? new TurnEventHub();
  const planner = options.planner ?? new DynamicFanOutPlanner();
  const executionRouter = options.executionRouter ?? new DeterministicExecutionRouter(options.routerOptions);
  const contextSeal = options.contextSeal ?? new DeterministicContextSealFixture();
  const resultBus = options.resultBus ?? new RecordingResultBusFixture({ isTurnSealed:(turnId)=>contextSeal.isTurnSealed(turnId) });
  const compiler = options.compiler ?? new StructuredCompilerFixture();
  const telemetry = options.telemetry ?? new CoprocessorTelemetry();
  const swarm = new CognitiveSwarm({ eventHub, planner, executionRouter, resultBus, compiler, contextSeal, telemetry });
  return { swarm,eventHub,planner,executionRouter,resultBus,compiler,contextSeal,telemetry };
}

function makeResult(task, profile, { completedAt, stale = false, future = false }) {
  const role = task.metadata.roleId;
  const freshnessIdentity = structuredClone(task.inputRevisionSet);
  if (stale) freshnessIdentity.worldRevision -= 1;
  if (future) freshnessIdentity.worldRevision += 1;
  const common = {
    resultId:`result:${task.taskId}:${profile.providerId}`,
    taskId:task.taskId, turnId:task.turnId, correlationId:task.correlationId,
    workerId:profile.workerId, providerId:profile.providerId, capabilities:[...profile.capabilities],
    status:'SUCCESS', provenance:{ fixture:'ember-tavern-wave1', role },
    confidence: role === 'green-room' ? 0.7 : 0.98,
    freshnessIdentity, inputRevisionSet:task.inputRevisionSet,
    startedAt:0, completedAt, latency:completedAt,
    validationReceipt:{ syntax:'PASS', deterministic:'PASS' },
    authorityClass: role === 'green-room' ? 'INFERRED' : 'UNRESOLVED',
  };
  if (role === 'historian') return {
    ...common,
    payload:{
      lane:'loreEvidence',
      historical:[
        { subject:'Sun Blade', predicate:'location', value:'Ember Tavern', temporalStatus:'HISTORICAL' },
        { subject:'Eris', predicate:'possessed', value:'Sun Blade', temporalStatus:'HISTORICAL' },
      ],
      evidence:[
        { id:'evidence:fire', semanticKey:'sun-blade:fate', value:'destroyed-in-fire', authority:'CREDIBLE' },
        { id:'evidence:journal', semanticKey:'sun-blade:fate', value:'removed-before-fire', authority:'CREDIBLE' },
      ],
    },
  };
  if (role === 'graph-walker') return {
    ...common,
    payload:{
      lane:'graphResults',
      current:[
        { subject:'Ember Tavern', predicate:'state', value:'destroyed', temporalStatus:'CURRENT' },
        { subject:'Sun Blade', predicate:'location', value:'unknown', temporalStatus:'UNRESOLVED' },
      ],
      evidence:[{ id:'graph:tavern', semanticKey:'ember-tavern:state', value:'destroyed', authority:'CURRENT' }],
    },
  };
  if (role === 'green-room') return {
    ...common,
    authorityClass:'INFERRED',
    payload:{
      lane:'greenRoom',
      character:'Mara',
      inferred:{ guardedness:'elevated', confidence:0.7, authority:'INFERRED' },
      evidence:[{ id:'scene:mara', semanticKey:'mara:guardedness', value:'elevated', authority:'INFERRED' }],
    },
  };
  return {
    ...common,
    payload:{
      lane:'truthClassifications',
      subject:'Sun Blade',
      currentLocation:'unknown',
      classification:'UNRESOLVED',
      rejects:[{ claim:'Sun Blade is at Ember Tavern', reason:'historical evidence is not current state' }],
      evidence:[
        { id:'truth:fire', semanticKey:'sun-blade:fate', value:'destroyed-in-fire', authority:'CREDIBLE' },
        { id:'truth:journal', semanticKey:'sun-blade:fate', value:'removed-before-fire', authority:'CREDIBLE' },
      ],
    },
  };
}

function defaultCompletion(role) {
  return ({ historian:32, 'graph-walker':41, 'truth-precision':57, 'green-room':220 })[role] ?? 50;
}
