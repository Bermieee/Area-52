import { ObservationClass, createFieldState } from '../scene/contracts.js';
import { DevelopmentDeploymentBrain, createGoldenDeploymentLorebook } from './brain.js';
import { mountWave12SillyTavernInterface } from '../ui-core/index.js';

export const DEVELOPMENT_DEPLOYMENT_PROMPT_ID = 'area52-development-deployment';
export const DEVELOPMENT_DEPLOYMENT_LIVE_CONTRACT_VERSION = '1.0.0';

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
  if (/sun\s+blade/.test(value) && /(what happened|fate|uncertain|unknown|missing|gone|destroyed|removed|surviv)/.test(value)) return 'ambiguous';
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
  const value = raw.toLowerCase();
  const fields = {};
  let explicit = false;

  if (/ember\s+tavern\s+ruins|ruins\s+of\s+the\s+ember\s+tavern/.test(value)) {
    fields.location = sceneField({ location: 'Ember Tavern Ruins' }, revision, evidenceRef);
    explicit = true;
  } else if (/(?:are|is|stand|remain|arrive|reach|enter|step|walk|return).{0,28}ember\s+tavern|inside\s+the\s+ember\s+tavern/.test(value)) {
    fields.location = sceneField({ location: 'Ember Tavern' }, revision, evidenceRef);
    explicit = true;
  }

  const cast = [];
  if (/\bmara\b/.test(value)) cast.push({ characterId: 'Mara', state: 'PRESENT' });
  if (/\beris\b/.test(value)) cast.push({ characterId: 'Eris', state: 'PRESENT' });
  if (cast.length && explicit) fields.activeCast = sceneField(cast, revision, evidenceRef);

  const mentionsBlade = /sun\s+blade/.test(value);
  const ambiguousBlade = mentionsBlade && /(what happened|fate|uncertain|unknown|missing|gone|destroyed|removed|surviv)/.test(value);
  if (mentionsBlade && (explicit || ambiguousBlade)) {
    fields.immediateObjects = sceneField([
      {
        objectId: 'Sun Blade',
        state: ambiguousBlade ? 'UNCERTAIN' : 'PRESENT',
        evidenceRefs: [evidenceRef],
      },
    ], revision, evidenceRef, ambiguousBlade ? ObservationClass.UNRESOLVED : ObservationClass.OBSERVED, ambiguousBlade ? 0.5 : 1);
    fields.activeThreads = sceneField(
      [ambiguousBlade ? 'Determine the Sun Blade fate' : 'Find the Sun Blade'],
      revision,
      evidenceRef,
      ambiguousBlade ? ObservationClass.UNRESOLVED : ObservationClass.OBSERVED,
      ambiguousBlade ? 0.6 : 1,
    );
    explicit = true;
  }

  if (/ash|rain/.test(value) && explicit) {
    fields.atmosphere = sceneField('Ash and rain', revision, evidenceRef, ObservationClass.INFERRED, 0.6);
  }

  return { explicit, fields };
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
    if (!prior) throw new Error('The first live demo turn must explicitly establish an Ember Tavern scene.');
    return { observed: false, parsed, signal: prior, delta: null };
  }

  const location = parsed.fields.location?.value ?? prior?.location ?? { location: 'Ember Tavern' };
  const activeCast = parsed.fields.activeCast?.value ?? prior?.activeCast ?? [];
  const activeThreads = parsed.fields.activeThreads?.value ?? prior?.activeThreads ?? [];
  const objects = parsed.fields.immediateObjects?.value ?? prior?.immediateObjects ?? [];
  const atmosphere = parsed.fields.atmosphere?.value ?? null;
  const observed = brain.observeScene({
    chatId,
    sourceRevisionId,
    location,
    activeCast,
    activeThreads,
    objects,
    atmosphere,
  });
  return { observed: true, parsed, signal: observed, delta: observed.delta ?? null };
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

function scenarioReady(row, mode) {
  if (!row || row.mode !== mode || !row.delivery?.ok || !row.delivery?.sealVerified) return false;
  if (!row.delivery?.promptInjection?.succeeded) return false;
  if (mode === 'simple' && row.runtime.jobCount !== 0) return false;
  if (mode === 'retrieval' && row.runtime.jobCount < 2) return false;
  if (mode === 'ambiguous' && !row.cognition?.jev) return false;
  return true;
}

export class DevelopmentDeploymentSillyTavernSession {
  constructor({
    sillyTavern = globalThis.SillyTavern ?? null,
    document = globalThis.document ?? null,
    brain = null,
    mountUi = true,
    onEvidence = null,
  } = {}) {
    this.sillyTavern = sillyTavern;
    this.document = document;
    this.brain = brain ?? new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: true });
    this.brain.ingestLorebook(createGoldenDeploymentLorebook());
    this.onEvidence = typeof onEvidence === 'function' ? onEvidence : null;
    this.uiHost = null;
    this.running = false;
    this.release = null;
    this.processing = null;
    this.processed = new Map();
    this.scenarios = { simple: null, retrieval: null, ambiguous: null };
    this.degraded = null;
    this.operatorReview = { promptInspectorConfirmed: false, uiTraceReviewed: false, confirmedAt: null };
    this.errors = [];
    if (mountUi) this.mount();
  }

  getContext() {
    if (!this.sillyTavern || typeof this.sillyTavern.getContext !== 'function') throw new Error('SillyTavern.getContext() is unavailable');
    const context = this.sillyTavern.getContext();
    if (!context || typeof context !== 'object') throw new Error('SillyTavern host context is unavailable');
    return context;
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
    const eventName = context.eventTypes?.GENERATION_AFTER_COMMANDS
      ?? context.event_types?.GENERATION_AFTER_COMMANDS
      ?? context.eventTypes?.MESSAGE_SENT
      ?? context.event_types?.MESSAGE_SENT;
    if (!eventName || !context.eventSource || typeof context.eventSource.on !== 'function') {
      throw new Error('No supported SillyTavern pre-generation event is available');
    }
    const handler = async () => {
      try {
        await this.processCurrentTurn();
      } catch (error) {
        this.errors.push({ at: Date.now(), message: String(error?.message ?? error) });
        this.#notify();
      }
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
    this.processing = this.#processCurrentTurn({ mode }).finally(() => { this.processing = null; });
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
    this.scenarios[chosenMode] = evidence;

    if (chosenMode === 'ambiguous') {
      const degradedBrain = new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: false });
      degradedBrain.ingestLorebook(createGoldenDeploymentLorebook());
      const degraded = await executeHostTurn(degradedBrain, context, message, { mode: 'ambiguous', inject: false });
      this.degraded = {
        ...degraded,
        controlledFailure: 'JEV_UNAVAILABLE',
        safe: degraded.delivery.ok && degraded.cognition?.choice?.jev?.unavailable === true && degraded.cognition?.jev == null,
      };
    }

    this.#notify();
    return clone(evidence);
  }

  confirmOperatorReview({ promptInspectorConfirmed = true, uiTraceReviewed = true } = {}) {
    this.operatorReview = {
      promptInspectorConfirmed: Boolean(promptInspectorConfirmed),
      uiTraceReviewed: Boolean(uiTraceReviewed),
      confirmedAt: Date.now(),
    };
    this.#notify();
    return this.exportEvidence();
  }

  exportEvidence() {
    const uiDiagnostics = this.uiHost?.diagnostics?.() ?? null;
    const scenarioChecks = {
      simple: scenarioReady(this.scenarios.simple, 'simple'),
      retrieval: scenarioReady(this.scenarios.retrieval, 'retrieval'),
      ambiguous: scenarioReady(this.scenarios.ambiguous, 'ambiguous'),
      degraded: Boolean(this.degraded?.safe),
    };
    const executionReady = Object.values(scenarioChecks).every(Boolean);
    const operatorReady = this.operatorReview.promptInspectorConfirmed && this.operatorReview.uiTraceReviewed;
    const liveEvidenceComplete = executionReady && operatorReady && Boolean(uiDiagnostics?.mounted ?? this.uiHost);

    return clone({
      kind: 'DevelopmentDeploymentLiveDemoEvidence',
      contractVersion: DEVELOPMENT_DEPLOYMENT_LIVE_CONTRACT_VERSION,
      status: liveEvidenceComplete ? 'LIVE_DEMO_EVIDENCE_CAPTURED' : executionReady ? 'OPERATOR_CONFIRMATION_PENDING' : 'LIVE_DEMO_PENDING',
      issue: 224,
      issue224AutomaticPass: false,
      directorApprovalRequired: true,
      oneResource: true,
      externalDatabaseRequired: false,
      externalOrchestrationRequired: false,
      remoteProviderRequired: false,
      scenarios: this.scenarios,
      degraded: this.degraded,
      checks: scenarioChecks,
      operatorReview: this.operatorReview,
      ui: uiDiagnostics,
      errors: this.errors,
      liveEvidenceComplete,
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
