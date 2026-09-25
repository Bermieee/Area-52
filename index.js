import { createDevelopmentDeploymentSillyTavernSession } from './src/deployment/sillytavern-live.js';
import { Area52NativeBrain } from './src/native-brain.js';

let session = null;
let initialized = false;
let startupError = null;

export function getSession() {
  return session;
}

export function getStartupError() {
  return startupError ? { ...startupError } : null;
}

export async function processCurrentTurn(options) {
  if (!session) throw new Error('Area-52 Development Deployment session is not initialized');
  return session.processCurrentTurn(options);
}

export function exportLiveEvidence() {
  if (!session) return null;
  return session.exportEvidence();
}

function installProgrammaticContract() {
  globalThis.Area52DevelopmentDeployment = Object.freeze({
    getSession,
    getStartupError,
    processCurrentTurn,
    exportLiveEvidence,
    confirmOperatorReview: (options) => session?.confirmOperatorReview(options),
    attachNativeBrain: (brain) => session?.attachNativeBrain(brain),
    detachNativeBrain: () => session?.detachNativeBrain(),
    acceptLoreRevisionChange: (event) => session?.acceptLoreRevisionChange(event),
  });
}

export async function init() {
  if (initialized || typeof document === 'undefined') return session;
  initialized = true;
  startupError = null;

  try {
    session = createDevelopmentDeploymentSillyTavernSession({
      nativeBrain: globalThis.Area52NativeBrainOwner ?? new Area52NativeBrain(),
      ownerBindings: globalThis.Area52OwnerBindings ?? {},
      persistNativeBrain: typeof globalThis.Area52PersistNativeBrain === 'function' ? globalThis.Area52PersistNativeBrain : null,
    });

    // Installed Area-52 always listens to the SillyTavern turn lifecycle.
    // This is intentionally not coupled to a visible Arm/Disarm test harness.
    session.start();
  } catch (error) {
    startupError = Object.freeze({
      code: error?.code ?? 'AREA52_STARTUP_FAILED',
      message: String(error?.message ?? error),
      stage: 'HOST_BRIDGE_START',
    });
    try { console.error('[Area-52] host bridge startup failed', startupError); } catch {}
  }

  installProgrammaticContract();
  return session;
}

export function destroy() {
  session?.destroy?.();
  session = null;
  startupError = null;
  initialized = false;
}

export async function onActivate() { return init(); }
export function onDisable() { destroy(); }

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
  else queueMicrotask(() => void init());
}
