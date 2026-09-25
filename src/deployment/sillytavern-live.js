import { ObservationClass, createFieldState } from '../scene/contracts.js';
import { DevelopmentDeploymentBrain } from './brain.js';
import { mountWave12SillyTavernInterface } from '../ui-core/index.js';

export const DEVELOPMENT_DEPLOYMENT_PROMPT_ID = 'area52-development-deployment';
export const DEVELOPMENT_DEPLOYMENT_LIVE_CONTRACT_VERSION = '1.3.0';

const clone = (value) => value == null ? value : structuredClone(value);
const clean = (value) => String(value ?? '').trim();

function shortHash(value) {
  let h = 2166136261;
  for (const ch of String(value)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function latestUserMessage(context) {
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    const row = chat[index];
    const isUser = row?.is_user === true || row?.role === 'user';
    const text = clean(row?.mes ?? row?.content ?? row?.text);
    if (isUser && text) return { index, row, text };
  }
  return null;
}

export function classifyDevelopmentDeploymentTurn(text) {
  const value = clean(text).toLowerCase();
  if (/(uncertain|unknown|ambiguous|conflict(?:ing)?|contradict(?:s|ed|ory|ion)?|disagree(?:s|ment)?|accounts? differ|reports? differ|which (?:account|report|version)|what really happened)/.test(value)) return 'ambiguous';
  if (/(where are we|where am i|where.*now)/.test(value)) return 'simple';
  return 'retrieval';
}

function sceneField(value, revision, evidenceRef, observationClass = ObservationClass.OBSERVED, confidence = 1) {
  return createFieldState({
    value,
    revision,
    evidenceRefs: [evidenceRef],
    observationClass,
    confidence,
    provenance: [evidenceRef],
  });
}

export function extractDevelopmentDeploymentScene(text, { revision, evidenceRef } = {}) {
  const raw = clean(text);
  const fields = {};
  const locationMatch = raw.match(/\b(?:[Aa]t|[Ii]nside|[Ww]ithin|[Oo]utside|[Nn]ear)\s+(?:the\s+)?([\p{Lu}][\p{L}\p{N}'’_-]*(?:\s+(?:[\p{Lu}][\p{L}\p{N}'’_-]*|of|the|and)){0,4})/u);
  if (locationMatch?.[1]) {
    const location = locationMatch[1].replace(/[.,!?;:]+$/, '').trim();
    if (location) fields.location = sceneField({ location }, revision, evidenceRef);
  }
  return {
    explicit: Object.keys(fields).length > 0,
    fields,
    sourceText: raw,
    extractionPolicy: 'GENERIC_HOST_EVIDENCE_ONLY',
  };
}

function renderPromptPlan(plan) {
  const sections = (plan?.sections ?? [])
    .filter((section) => section?.representation !== 'OMITTED' && clean(section?.text))
    .map((section) => {
      const refs = (section.semanticManifest ?? []).map((entry) => entry.semanticKey ?? entry.id).filter(Boolean);
      return [
        '## ' + section.slot,
        clean(section.text),
        refs.length ? 'Evidence: ' + refs.join(', ') : null,
      ].filter(Boolean).join('\n');
    });

  return [
    '[Area-52 sealed context]',
    'PromptPlan: ' + (plan?.promptPlanId ?? 'unknown'),
    'Generation: ' + (plan?.generationId ?? 'unknown'),
    ...sections,
  ].join('\n\n');
}

function sourceIdentity(chatId, message) {
  const messageKey = clean(message.row?.mesId ?? message.row?.message_id ?? message.row?.id ?? message.index);
  const digest = shortHash(message.text);
  return {
    sourceId: 'sillytavern:' + chatId + ':message:' + messageKey + ':' + digest,
    messageKey,
    digest,
  };
}

function registerNarrativeSource(brain, { chatId, message }) {
  const identity = sourceIdentity(chatId, message);
  const imported = brain.core.registry.importSource({
    id: identity.sourceId,
    sourceType: 'EXPERIENCE',
    content: message.text,
    metadata: {
      host: 'SILLYTAVERN',
      chatId,
      messageId: identity.messageKey,
      messageIndex: message.index,
      messageDigest: identity.digest,
      role: 'user',
    },
  });
  return { ...identity, sourceRevisionId: imported.revision.id };
}

function applyNativeScene(brain, { chatId, message, sourceRevisionId }) {
  const prior = brain.scene.integrationSignal(chatId);
  const nextRevision = Number(prior?.sceneRevision ?? 0) + 1;
  const parsed = extractDevelopmentDeploymentScene(message.text, { revision: nextRevision, evidenceRef: sourceRevisionId });
  if (!parsed.explicit) {
    const signal = prior ?? brain.ensureScene({ chatId, sourceRevisionId });
    return {
      observed: false,
      initialized: !prior,
      parsed,
      signal,
      delta: null,
      reason: prior ? 'NO_EXPLICIT_SCENE_FIELDS_REUSE_CURRENT' : 'SCENE_INITIALIZED_WITH_UNKNOWN_FIELDS',
    };
  }

  const location = parsed.fields.location.value;
  const observed = brain.observeScene({
    chatId,
    sourceRevisionId,
    location,
    activeCast: prior?.activeCast ?? [],
    activeThreads: prior?.activeThreads ?? [],
    objects: prior?.objects ?? [],
    atmosphere: null,
  });
  return { observed: true, initialized: false, parsed, signal: observed, delta: observed.delta ?? null, reason: 'HOST_LOCATION_OBSERVED' };
}

async function injectPrompt(context, result) {
  const plan = result?.delivery?.plan ?? null;
  if (!plan) return { supported: false, succeeded: false, reason: 'PROMPT_PLAN_UNAVAILABLE' };
  if (typeof context?.setExtensionPrompt !== 'function') {
    return { supported: false, succeeded: false, reason: 'SILLYTAVERN_SET_EXTENSION_PROMPT_UNAVAILABLE', promptPlanId: plan.promptPlanId };
  }
  const content = renderPromptPlan(plan);
  await Promise.resolve(context.setExtensionPrompt(
    DEVELOPMENT_DEPLOYMENT_PROMPT_ID,
    content,
    1,
    0,
    false,
    0,
  ));
  return {
    supported: true,
    succeeded: true,
    promptId: DEVELOPMENT_DEPLOYMENT_PROMPT_ID,
    position: 1,
    depth: 0,
    role: 0,
    promptPlanId: plan.promptPlanId,
    generationId: plan.generationId,
    contextSealId: plan.contextSealId,
    contentDigest: shortHash(content),
    semanticEntryCount: plan.diagnosticReceipt?.semanticEntryCount ?? null,
  };
}

async function executeHostTurn(brain, context, message, { mode = null, inject = true } = {}) {
  const chatId = clean(context?.chatId);
  if (!chatId) throw new Error('SillyTavern chatId is unavailable');
  const chosenMode = mode ?? classifyDevelopmentDeploymentTurn(message.text);
  const source = registerNarrativeSource(brain, { chatId, message });
  const scene = applyNativeScene(brain, { chatId, message, sourceRevisionId: source.sourceRevisionId });
  const turnSuffix = source.messageKey + ':' + source.digest + ':' + chosenMode;
  const turnId = 'live:' + chatId + ':' + turnSuffix;
  const generationId = 'live-gen:' + chatId + ':' + source.messageKey + ':' + source.digest;

  const result = await brain.runTurn({
    chatId,
    turnId,
    generationId,
    query: message.text,
    mode: chosenMode,
  });
  const promptInjection = inject ? await injectPrompt(context, result) : { supported: true, succeeded: true, reason: 'DEGRADED_CONTROL_NO_MAIN_INJECTION' };
  const selection = result.selection;
  const seal = brain.core.publication.seal.verify(turnId);

  return {
    kind: 'DevelopmentDeploymentLiveTurnEvidence',
    mode: chosenMode,
    host: {
      chatId,
      messageIndex: message.index,
      messageId: source.messageKey,
      messageDigest: source.digest,
      sourceRevisionId: source.sourceRevisionId,
    },
    selection: clone(selection),
    scene: {
      observedFromHostMessage: scene.observed,
      initializedFromHostMessage: Boolean(scene.initialized),
      reason: scene.reason ?? null,
      extractionPolicy: scene.parsed?.extractionPolicy ?? null,
      revision: scene.signal?.sceneRevision ?? null,
      sceneId: scene.signal?.sceneId ?? null,
      delta: clone(scene.delta),
      changedFields: Object.keys(scene.delta?.changedFields ?? {}).sort(),
    },
    runtime: {
      jobCount: result.scatter.jobs.length,
      jobs: clone(result.scatter.jobs),
      resourceCount: result.scatter.resourceCount,
      resourceIds: clone(result.scatter.resourceIds),
    },
    cognition: {
      choice: clone(result.published.cognitiveChoiceReceipt),
      truth: clone(result.published.assessment),
      jev: clone(result.jevProposal),
      jevExecution: clone(result.jevExecution),
      gather: clone(result.published.gatherReceipt),
    },
    delivery: {
      ok: result.delivery.ok,
      status: result.delivery.status,
      promptPlanId: result.delivery.plan?.promptPlanId ?? null,
      generationId: result.delivery.plan?.generationId ?? null,
      contextSealId: result.delivery.plan?.contextSealId ?? null,
      sealVerified: Boolean(seal?.sealed && seal?.hashMatches),
      semanticManifest: clone(result.delivery.plan?.sections?.flatMap((section) => section.semanticManifest ?? []) ?? []),
      promptInjection,
    },
  };
}

function liveTurnReady(row) {
  if (!row?.host?.chatId || !row?.selection?.turnId || !row?.selection?.generationId) return false;
  if (!row.delivery?.ok || !row.delivery?.sealVerified || !row.delivery?.promptInjection?.succeeded) return false;
  if (!row.cognition?.choice || !row.cognition?.truth || !row.cognition?.gather) return false;
  if (!row.scene?.sceneId || row.scene?.extractionPolicy !== 'GENERIC_HOST_EVIDENCE_ONLY') return false;
  return true;
}

function storyCoverage(turns) {
  const byChat = new Map();
  for (const row of turns) {
    const chatId = clean(row?.host?.chatId);
    if (!chatId) continue;
    const current = byChat.get(chatId) ?? { chatId, turnCount: 0, readyTurnCount: 0, modes: new Set() };
    current.turnCount += 1;
    if (liveTurnReady(row)) current.readyTurnCount += 1;
    if (row?.mode) current.modes.add(row.mode);
    byChat.set(chatId, current);
  }
  return [...byChat.values()]
    .map((row) => ({ ...row, modes: [...row.modes].sort(), ready: row.readyTurnCount > 0 }))
    .sort((a, b) => a.chatId.localeCompare(b.chatId));
}

export class DevelopmentDeploymentSillyTavernSession {
  constructor({
    sillyTavern = globalThis.SillyTavern ?? null,
    document = globalThis.document ?? null,
    brain = null,
    mountUi = true,
    onEvidence = null,
    initialLorebook = null,
  } = {}) {
    this.sillyTavern = sillyTavern;
    this.document = document;
    this.brain = brain ?? new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: true });
    this.onEvidence = typeof onEvidence === 'function' ? onEvidence : null;
    this.uiHost = null;
    this.running = false;
    this.release = null;
    this.processing = null;
    this.processed = new Map();
    this.turnEvidence = [];
    this.scenarios = { simple: null, retrieval: null, ambiguous: null };
    this.loreIngestion = [];
    this.degraded = null;
    this.operatorReview = { promptInspectorConfirmed: false, uiTraceReviewed: false, liveSillyTavernConfirmed: false, confirmedAt: null };
    this.errors = [];
    if (initialLorebook) this.ingestLorebook(initialLorebook, { notify: false });
    if (mountUi) this.mount();
  }

  getContext() {
    if (!this.sillyTavern || typeof this.sillyTavern.getContext !== 'function') throw new Error('SillyTavern.getContext() is unavailable');
    const context = this.sillyTavern.getContext();
    if (!context || typeof context !== 'object') throw new Error('SillyTavern host context is unavailable');
    return context;
  }

  ingestLorebook(lorebook, { notify = true } = {}) {
    if (!lorebook || !Array.isArray(lorebook.entries)) throw new TypeError('Lorebook entries are required');
    const result = this.brain.ingestLorebook(lorebook);
    const receipt = {
      kind: 'DevelopmentDeploymentLoreIngestionReceipt',
      lorebookId: String(lorebook.id ?? 'operator-lore'),
      title: String(lorebook.title ?? 'Operator Lore'),
      accepted: true,
      processed: true,
      entryCount: lorebook.entries.length,
      mappingCount: result.mappingCount,
      rawSourceOnlyCount: result.rawSourceOnlyCount ?? 0,
      semanticExtractionCount: result.semanticExtractionCount ?? 0,
      retrievable: result.mappingCount > 0,
      hierarchyRevision: result.retrieval?.hierarchyRevision ?? null,
    };
    this.loreIngestion.push(receipt);
    if (notify) this.#notify();
    return clone(receipt);
  }

  mount() {
    if (this.uiHost) return this.uiHost;
    this.uiHost = mountWave12SillyTavernInterface({
      getContext: () => this.getContext(),
      document: this.document,
      hostBindings: this.brain.hostBindings(),
    });
    this.#notify();
    return this.uiHost;
  }

  start() {
    if (this.running) return this;
    const context = this.getContext();
    const eventName = context.eventTypes?.MESSAGE_SENT
      ?? context.event_types?.MESSAGE_SENT;
    if (!eventName || !context.eventSource || typeof context.eventSource.on !== 'function') {
      throw new Error('No supported SillyTavern pre-generation event is available');
    }
    const handler = async () => {
      try { await this.processCurrentTurn(); }
      catch { /* processCurrentTurn records the failure for the operator. */ }
    };
    context.eventSource.on(eventName, handler);
    this.release = () => context.eventSource.removeListener?.(eventName, handler);
    this.running = true;
    this.#notify();
    return this;
  }

  stop() {
    this.release?.();
    this.release = null;
    this.running = false;
    this.#notify();
    return this;
  }

  async processCurrentTurn({ mode = null } = {}) {
    if (this.processing) return this.processing;
    this.processing = this.#processCurrentTurn({ mode })
      .catch((error) => {
        this.errors.push({ at: Date.now(), message: String(error?.message ?? error) });
        this.#notify();
        throw error;
      })
      .finally(() => { this.processing = null; });
    return this.processing;
  }

  async #processCurrentTurn({ mode = null } = {}) {
    const context = this.getContext();
    const message = latestUserMessage(context);
    if (!message) throw new Error('No current SillyTavern user message is available');
    const chosenMode = mode ?? classifyDevelopmentDeploymentTurn(message.text);
    const key = clean(context.chatId) + ':' + message.index + ':' + shortHash(message.text) + ':' + chosenMode;
    if (this.processed.has(key)) return clone(this.processed.get(key));

    const evidence = await executeHostTurn(this.brain, context, message, { mode: chosenMode, inject: true });
    this.processed.set(key, evidence);
    this.turnEvidence.push(evidence);
    this.scenarios[chosenMode] = evidence;

    if (chosenMode === 'ambiguous') {
      const degradedBrain = new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: false });
      const degraded = await executeHostTurn(degradedBrain, context, message, { mode: 'ambiguous', inject: false });
      this.degraded = {
        ...degraded,
        evidenceClass: 'SIMULATED_FAILURE_PROBE',
        controlledFailure: 'JEV_UNAVAILABLE',
        safe: degraded.delivery.ok && degraded.cognition?.choice?.jev?.unavailable === true && degraded.cognition?.jev == null,
      };
    }

    this.#notify();
    return clone(evidence);
  }

  confirmOperatorReview({ promptInspectorConfirmed = true, uiTraceReviewed = true, liveSillyTavernConfirmed = false } = {}) {
    this.operatorReview = {
      promptInspectorConfirmed: Boolean(promptInspectorConfirmed),
      uiTraceReviewed: Boolean(uiTraceReviewed),
      liveSillyTavernConfirmed: Boolean(liveSillyTavernConfirmed),
      confirmedAt: Date.now(),
    };
    this.#notify();
    return this.exportEvidence();
  }

  exportEvidence() {
    const uiDiagnostics = this.uiHost?.diagnostics?.() ?? null;
    const modeCoverage = {
      simple: liveTurnReady(this.scenarios.simple),
      retrieval: liveTurnReady(this.scenarios.retrieval),
      ambiguous: liveTurnReady(this.scenarios.ambiguous),
    };
    const stories = storyCoverage(this.turnEvidence);
    const storyChatIds = stories.map((row) => row.chatId);
    const liveTurnChecks = {
      anyReadyTurn: this.turnEvidence.some(liveTurnReady),
      twoUnrelatedStories: stories.filter((row) => row.ready).length >= 2,
      promptDeliveryObserved: this.turnEvidence.some((row) => row.delivery?.promptInjection?.succeeded === true),
      sealedContextObserved: this.turnEvidence.some((row) => row.delivery?.sealVerified === true),
      genericScenePolicyObserved: this.turnEvidence.some((row) => row.scene?.extractionPolicy === 'GENERIC_HOST_EVIDENCE_ONLY'),
    };
    const executionReady = Object.values(liveTurnChecks).every(Boolean);
    const operatorReady = this.operatorReview.promptInspectorConfirmed
      && this.operatorReview.uiTraceReviewed
      && this.operatorReview.liveSillyTavernConfirmed;
    const operatorLiveChecksCaptured = executionReady
      && operatorReady
      && Boolean(uiDiagnostics?.mounted ?? this.uiHost);
    const latest = this.turnEvidence.at(-1) ?? null;
    const jevExecutions = this.turnEvidence.map((row) => row?.cognition?.jevExecution).filter(Boolean);
    const liveJevExecution = jevExecutions.find((row) => row.status === 'LIVE_PROVIDER' && row.providerProvenance?.measurementClass === 'MEASURED_LIVE') ?? null;
    const failedLiveJevExecution = [...jevExecutions].reverse().find((row) => row.status === 'LIVE_PROVIDER_FAILED_NATIVE_FALLBACK') ?? null;
    const latestJevExecution = latest?.cognition?.jevExecution ?? null;
    const capabilityEvidence = latest ? {
      sceneIntelligence: { status: latest.scene?.sceneId ? 'RUN' : 'UNAVAILABLE', reason: latest.scene?.reason ?? null },
      retrieval: { status: latest.mode === 'simple' ? 'SKIPPED' : latest.runtime?.jobs?.some((job) => job.taskType === 'LORE_RETRIEVAL') ? 'RUN' : 'UNAVAILABLE' },
      truth: { status: latest.cognition?.truth ? 'RUN' : 'UNAVAILABLE' },
      cognitiveChoice: { status: latest.cognition?.choice ? 'RUN' : 'UNAVAILABLE' },
      runtime: { status: latest.runtime?.jobCount > 0 ? 'RUN' : 'SKIPPED', resourceIds: latest.runtime?.resourceIds ?? [] },
      jev: latest.cognition?.jev
        ? latestJevExecution?.status === 'LIVE_PROVIDER'
          ? { status: 'RUN', reason: 'MEASURED_LIVE_PROVIDER', liveProvider: true, providerProvenance: clone(latestJevExecution.providerProvenance) }
          : latestJevExecution?.status === 'LIVE_PROVIDER_FAILED_NATIVE_FALLBACK'
            ? { status: 'DEGRADED', reason: 'LIVE_PROVIDER_FAILED_NATIVE_FALLBACK', liveProvider: false, failure: clone(latestJevExecution.failedLiveAttempt ?? latestJevExecution.failure ?? null) }
            : { status: 'FIXTURE', reason: 'DETERMINISTIC_LOCAL_JEV_NOT_REAL_PROVIDER', liveProvider: false }
        : { status: latest.mode === 'ambiguous' ? 'UNAVAILABLE' : 'SKIPPED', liveProvider: false },
      gather: { status: latest.cognition?.gather ? 'RUN' : 'UNAVAILABLE' },
      promptPlan: { status: latest.delivery?.promptInjection?.succeeded ? 'RUN' : 'UNAVAILABLE', promptPlanId: latest.delivery?.promptPlanId ?? null },
      memory: { status: 'SKIPPED', reason: 'NO_MEMORY_TASK_ADMITTED_IN_THIS_TURN' },
      forensics: { status: 'UNAVAILABLE', reason: 'NO_LIVE_OWNER_BINDING' },
      transactions: { status: 'UNAVAILABLE', reason: 'NO_LIVE_OWNER_BINDING' },
    } : null;

    return clone({
      kind: 'DevelopmentDeploymentLiveDemoEvidence',
      contractVersion: DEVELOPMENT_DEPLOYMENT_LIVE_CONTRACT_VERSION,
      status: operatorLiveChecksCaptured ? 'DIRECTOR_REVIEW_PENDING' : executionReady ? 'OPERATOR_CONFIRMATION_PENDING' : 'LIVE_DEMO_PENDING',
      issue: 224,
      issue224AutomaticPass: false,
      directorApprovalRequired: true,
      oneResource: true,
      externalDatabaseRequired: false,
      externalOrchestrationRequired: false,
      remoteProviderRequired: false,
      scenarios: this.scenarios,
      turns: this.turnEvidence,
      storyChatIds,
      twoStoryCoverage: storyChatIds.length >= 2,
      loreIngestion: this.loreIngestion,
      degraded: this.degraded,
      checks: liveTurnChecks,
      modeCoverage,
      storyCoverage: stories,
      deterministicFixtureEvidence: {
        modeCoverage,
        simulatedJevFailureSafe: Boolean(this.degraded?.safe),
        acceptanceAuthority: false,
      },
      capabilityEvidence,
      providerEvidence: {
        jev: liveJevExecution ? 'MEASURED_LIVE_PROVIDER' : 'DETERMINISTIC_LOCAL_FIXTURE',
        realProviderCallObserved: Boolean(liveJevExecution),
        ft005LivePass: Boolean(liveJevExecution),
        liveProviderProvenance: clone(liveJevExecution?.providerProvenance ?? null),
        failedLiveAttempt: clone(failedLiveJevExecution ?? null),
      },
      loreStatus: clone(this.brain.readLoreStatus?.() ?? null),
      operatorReview: this.operatorReview,
      operatorLiveChecksCaptured,
      ui: uiDiagnostics,
      uiProducerDiagnosticsAreRegistrationOnly: true,
      errors: this.errors,
      liveEvidenceComplete: false,
      liveEvidenceCompleteReason: 'DIRECTOR_APPROVAL_AND_REQUIRED_LIVE_GATES_REMAIN_EXTERNAL_TO_THIS_RECORD',
    });
  }

  destroy() {
    this.stop();
    this.uiHost?.destroy?.();
    this.uiHost = null;
  }

  #notify() {
    this.onEvidence?.(this.exportEvidence());
  }
}

export function createDevelopmentDeploymentSillyTavernSession(options) {
  return new DevelopmentDeploymentSillyTavernSession(options);
}
