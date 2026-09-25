import { createDevelopmentDeploymentSillyTavernSession } from './src/deployment/sillytavern-live.js';

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
  const root = document.createElement('section');
  root.id = ROOT_ID;
  root.className = 'a52-deployment-controls';
  root.innerHTML = [
    '<div class="a52-deployment-head">',
    '<div><strong>Area-52 — Development Deployment</strong><div class="a52-deployment-sub">#224 live evidence capture / main review candidate</div></div>',
    '<button type="button" class="menu_button" data-a52-arm>Arm</button>',
    '</div>',
    '<div class="a52-deployment-status" data-a52-live-status>INITIALIZING</div>',
    '<div class="a52-deployment-actions">',
    '<button type="button" class="menu_button" data-a52-run>Process current turn</button>',
    '<button type="button" class="menu_button" data-a52-confirm>Confirm Prompt Inspector + UI trace</button>',
    '<button type="button" class="menu_button" data-a52-copy>Copy evidence</button>',
    '</div>',
    '<details class="a52-deployment-acceptance">',
    '<summary>Live acceptance sequence</summary>',
    '<ol>',
    '<li><span data-a52-gate="native-multiturn">○ Pending</span> — Arm Area-52, send two ordinary turns in one selected story, and verify Generation delivery then Learning write-back in Brain.</li>',
    '<li><span data-a52-gate="lore-study">○ Pending</span> — Select a real SillyTavern Lorebook, open Lore, Load selected Lorebook → Accept for study → Run pending study until owner state is READY.</li>',
    '<li><span data-a52-gate="lore-revision">○ Pending</span> — After the Settlement-backed Lore owner is integrated, apply one approved correction and route its LoreSourceRevisionChanged receipt before the next generation.</li>',
    '<li><span data-a52-gate="optional-provider">○ Pending</span> — In Connections, discover/select/qualify/test one Jev or Sidecar and exercise it on a live turn.</li>',
    '<li><span data-a52-gate="vectoring">○ Pending</span> — Separately qualify Vectoring with owner-advertised retrieval/embed capability; a Jev/Sidecar pass does not satisfy this gate.</li>',
    '<li><span data-a52-gate="provider-failure">○ Pending</span> — Exercise an unreachable/invalid provider and verify failure/fallback is shown without a false healthy state.</li>',
    '<li><span data-a52-gate="navigation">○ Pending</span> — Drag, resize, collapse, keyboard-navigate, switch workspaces, and narrow the SillyTavern viewport; confirm the panel stays reachable.</li>',
    '</ol>',
    '<p>No item is auto-promoted from fixture-only evidence. Copy evidence after the operator checks are complete.</p>',
    '</details>',
    '<pre class="a52-deployment-output" data-a52-live-output></pre>',
  ].join('');
  hostRoot().appendChild(root);

  try {
    session = createDevelopmentDeploymentSillyTavernSession({
      onEvidence: (evidence) => renderEvidence(root, evidence),
      nativeBrain: globalThis.Area52NativeBrainOwner ?? null,
      ownerBindings: globalThis.Area52OwnerBindings ?? {},
      persistNativeBrain: typeof globalThis.Area52PersistNativeBrain==='function'?globalThis.Area52PersistNativeBrain:null,
    });
    renderEvidence(root, session.exportEvidence());
  } catch (error) {
    setText(root, '[data-a52-live-status]', 'UNAVAILABLE');
    setText(root, '[data-a52-live-output]', String(error?.stack ?? error));
    throw error;
  }

  root.querySelector('[data-a52-arm]')?.addEventListener('click', () => {
    try{
      if (session.running) {
        session.stop();
        root.querySelector('[data-a52-arm]').textContent = 'Arm';
      } else {
        session.start();
        root.querySelector('[data-a52-arm]').textContent = 'Disarm';
      }
    }catch(error){
      setText(root,'[data-a52-live-status]','ARM FAILED');
      setText(root,'[data-a52-live-output]',String(error?.message??error));
      root.querySelector('[data-a52-arm]').textContent='Arm';
    }
  });
  root.querySelector('[data-a52-run]')?.addEventListener('click', () => void session.processCurrentTurn().catch(() => {}));
  root.querySelector('[data-a52-confirm]')?.addEventListener('click', () => session.confirmOperatorReview({ liveSillyTavernConfirmed: true }));
  root.querySelector('[data-a52-copy]')?.addEventListener('click', async () => {
    const text = JSON.stringify(session.exportEvidence(), null, 2);
    try { await navigator.clipboard.writeText(text); }
    catch { console.info('[Area-52] Live demo evidence', session.exportEvidence()); }
  });

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
