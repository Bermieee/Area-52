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

function renderEvidence(root, evidence) {
  setText(root, '[data-a52-live-status]', evidence.status);
  const output = root?.querySelector?.('[data-a52-live-output]');
  if (output) output.textContent = JSON.stringify({
    status: evidence.status,
    checks: evidence.checks,
    nativeBrainIntegration: evidence.nativeBrainIntegration,
    providerEvidence: evidence.providerEvidence,
    loreIngestion: evidence.loreIngestion,
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
    '<pre class="a52-deployment-output" data-a52-live-output></pre>',
  ].join('');
  hostRoot().appendChild(root);

  try {
    session = createDevelopmentDeploymentSillyTavernSession({
      onEvidence: (evidence) => renderEvidence(root, evidence),
      nativeBrain: globalThis.Area52NativeBrainOwner ?? null,
      ownerBindings: globalThis.Area52OwnerBindings ?? {},
    });
    renderEvidence(root, session.exportEvidence());
  } catch (error) {
    setText(root, '[data-a52-live-status]', 'UNAVAILABLE');
    setText(root, '[data-a52-live-output]', String(error?.stack ?? error));
    throw error;
  }

  root.querySelector('[data-a52-arm]')?.addEventListener('click', () => {
    if (session.running) {
      session.stop();
      root.querySelector('[data-a52-arm]').textContent = 'Arm';
    } else {
      session.start();
      root.querySelector('[data-a52-arm]').textContent = 'Disarm';
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
