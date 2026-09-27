import { createDevelopmentDeploymentSillyTavernSession } from './src/deployment/sillytavern-live.js';
import { Area52NativeBrain } from './src/native-brain.js';

const ROOT_ID = 'area52-development-deployment-controls';
let session = null;
let initialized = false;

function hostRoot() {
  return document.querySelector('#extensions_settings2')
    ?? document.querySelector('#extensions_settings')
    ?? document.body;
}

function setText(root, selector, value) {
  const node = root?.querySelector?.(selector);
  if (node) node.textContent = value;
}

function setGate(root,name,passed,pending='Pending'){
  const node=root?.querySelector?.('[data-a52-gate="'+name+'"]');
  if(!node)return;
  node.textContent=(passed?'✓ ':'○ ')+(passed?'Observed':pending);
  node.dataset.status=passed?'ready':'pending';
}

function renderEvidence(root, evidence) {
  setText(root, '[data-a52-live-status]', evidence.status);
  const manualRun=root?.querySelector?.('[data-a52-run]');
  if(manualRun){const native=Boolean(evidence.nativeBrainIntegration?.ownerAvailable);manualRun.disabled=native;manualRun.textContent=native?'Native mode: use SillyTavern Send':'Process current turn';}
  setGate(root,'native-multiturn',Boolean(evidence.nativeBrainIntegration?.multiTurnObserved),'Run two learned turns in one selected story');
  setGate(root,'lore-study',Boolean(evidence.loreOperatorEvidence?.selected?.selected&&Number(evidence.loreOperatorEvidence?.retrievalReady??0)>0),'Select, accept, and study a SillyTavern Lorebook');
  setGate(root,'lore-revision',Boolean(evidence.nativeBrainIntegration?.loreRevisionInvalidations?.length),'Route one corrected Lore revision before the next turn');
  const measuredResources=evidence.resourceOperatorEvidence?.resources??[];
  setGate(root,'optional-provider',Boolean(measuredResources.some(row=>['JEV','SIDECAR'].includes(String(row.kind))&&row.callable&&row.measurementClass==='MEASURED_LIVE')),'Qualify and exercise one optional Jev or Sidecar resource');
  setGate(root,'vectoring',Boolean(measuredResources.some(row=>String(row.kind)==='VECTORING'&&row.callable&&row.measurementClass==='MEASURED_LIVE'&&(row.capabilities??[]).some(cap=>['EMBED','RETRIEVAL','RETRIEVAL_QUALITY','RERANK'].includes(String(cap))))),'Qualify a measured Vectoring resource with owner-advertised retrieval/embed capability');
  setGate(root,'provider-failure',Boolean(evidence.resourceOperatorEvidence?.resources?.some(row=>row.lastFailure)||evidence.providerEvidence?.failedLiveAttempt),'Exercise one provider failure/fallback');
  setGate(root,'navigation',Boolean(evidence.navigationEvidence?.mounted&&evidence.operatorReview?.uiTraceReviewed),'Review rail/panel navigation in SillyTavern');
  for(const id of ['FT177','FT178','FT179','FT180'])setGate(root,id.toLowerCase(),evidence.functionTestObservations?.[id]?.status==='OBSERVED',id+' owner path pending');
  const output = root?.querySelector?.('[data-a52-live-output]');
  if (output) output.textContent = JSON.stringify({
    status: evidence.status,
    checks: evidence.checks,
    nativeBrainIntegration: evidence.nativeBrainIntegration,
    providerEvidence: evidence.providerEvidence,
    loreIngestion: evidence.loreIngestion,
    loreOperatorEvidence: evidence.loreOperatorEvidence,
    resourceOperatorEvidence: evidence.resourceOperatorEvidence,
    authoringOperatorEvidence: evidence.authoringOperatorEvidence,
    navigationEvidence: evidence.navigationEvidence,
    operatorReview: evidence.operatorReview,
    liveEvidenceComplete: evidence.liveEvidenceComplete,
    liveEvidenceCompleteReason: evidence.liveEvidenceCompleteReason,
    errors: evidence.errors,
  }, null, 2);
}

export function getSession() {
  return session;
}

export async function processCurrentTurn(options) {
  if (!session) throw new Error('Area-52 Development Deployment session is not initialized');
  return session.processCurrentTurn(options);
}

export function exportLiveEvidence() {
  if (!session) return null;
  return session.exportEvidence();
}

export async function init() {
  if (initialized || typeof document === 'undefined') return session;
  initialized = true;

  // The old development acceptance harness is intentionally non-visual now.
  // Remove any stale DOM left by a prior/hot-reloaded extension version.
  document.getElementById?.(ROOT_ID)?.remove?.();
  const root = null;

  try {
    session = createDevelopmentDeploymentSillyTavernSession({
      onEvidence: (evidence) => renderEvidence(root, evidence),
      nativeBrain: globalThis.Area52NativeBrainOwner ?? new Area52NativeBrain(),
      ownerBindings: globalThis.Area52OwnerBindings ?? {},
      memoryOwnerSnapshot: globalThis.Area52MemoryOwnerSnapshot ?? null,
      persistNativeBrain: typeof globalThis.Area52PersistNativeBrain==='function'?globalThis.Area52PersistNativeBrain:null,
    });
    // Keep the installed live turn bridge active; only the standalone
    // development-review panel has been removed.
    session.start();
    renderEvidence(root, session.exportEvidence());
  } catch (error) {
    setText(root, '[data-a52-live-status]', 'UNAVAILABLE');
    setText(root, '[data-a52-live-output]', String(error?.stack ?? error));
    throw error;
  }

  globalThis.Area52DevelopmentDeployment = Object.freeze({
    getSession,
    processCurrentTurn,
    exportLiveEvidence,
    confirmOperatorReview: (options) => session?.confirmOperatorReview(options),
    attachNativeBrain: (brain) => session?.attachNativeBrain(brain),
    detachNativeBrain: () => session?.detachNativeBrain(),
    acceptLoreRevisionChange: (event) => session?.acceptLoreRevisionChange(event),
  });
  return session;
}

export function destroy() {
  session?.destroy?.();
  session = null;
  document?.getElementById?.(ROOT_ID)?.remove?.();
  initialized = false;
}

export async function onActivate() { return init(); }
export function onDisable() { destroy(); }

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
  else queueMicrotask(() => void init());
}
