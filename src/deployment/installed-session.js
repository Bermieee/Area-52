// Installed-session bootstrap: restore durable state, then build the SillyTavern session.
//
// Restore order (each step degrades to a fresh start and is reported in the restore receipt, never half-applied):
//   1. owners (Lore, Memory, Scene) from the storage adapter;
//   2. the Brain snapshot and host bookkeeping of the chat that is open now (one Brain per story);
//   3. the session, which reconciles the restored state with the chat that is actually loaded on its first
//      generation (deleted or edited messages retire what they taught, Lore identities are re-synchronised).
import { Area52NativeBrain } from '../native-brain.js';
import { createDevelopmentDeploymentSillyTavernSession } from './sillytavern-live.js';
import { createInstalledStorage } from './installed-storage.js';
import { unpackBrainSnapshot } from './brain-snapshot-parts.js';

export async function createInstalledDevelopmentDeploymentSession(options = {}) {
  const storage = options.storage === undefined ? createInstalledStorage({ host: options.host ?? globalThis }) : options.storage;
  const receipt = { kind: 'InstalledStorageRestoreReceipt', status: storage ? 'NOT_ATTEMPTED' : 'NO_STORAGE', owners: null, story: null, brain: null, sceneOwner: null, chatId: null };
  let owners = {}, story = { parts: {} };
  if (storage) {
    try { const loaded = await storage.loadOwners(); receipt.owners = loaded.status; owners = loaded.parts ?? {}; }
    catch (error) { receipt.owners = 'READ_FAILED'; receipt.ownersError = String(error?.message ?? error).slice(0, 160); }
    let chatId = null;
    try { chatId = String(options.sillyTavern?.getContext?.()?.chatId ?? '') || null; } catch { chatId = null; }
    receipt.chatId = chatId;
    if (chatId) {
      try { story = await storage.loadStory(chatId); receipt.story = story.status; }
      catch (error) { receipt.story = 'READ_FAILED'; receipt.storyError = String(error?.message ?? error).slice(0, 160); story = { parts: {} }; }
    }
    receipt.status = 'ATTEMPTED';
  }
  let nativeBrain = options.nativeBrain ?? null;
  const hostSuppliedBrain = Boolean(options.nativeBrain);
  const storedBrain = hostSuppliedBrain ? null : unpackBrainSnapshot(story.parts ?? {});
  if (story.parts?.brain && !storedBrain && !hostSuppliedBrain) receipt.brain = 'INCOMPLETE_FRESH_START';
  if (storedBrain) {
    try { nativeBrain = Area52NativeBrain.fromSnapshot(storedBrain); receipt.brain = 'RESTORED'; }
    catch (error) { receipt.brain = 'REJECTED_FRESH_START'; receipt.brainError = String(error?.message ?? error).slice(0, 160); }
  } else if (hostSuppliedBrain) receipt.brain = 'HOST_SUPPLIED';
  // A story that could not be read is reported as such, never as "nothing stored": the session starts fresh, and the storage
  // adapter keeps the unreadable data (backup manifest, quarantine) instead of collecting it.
  else if (storage && !receipt.brain) receipt.brain = ({ UNAVAILABLE: 'STORAGE_UNAVAILABLE_FRESH_START', CORRUPT: 'UNREADABLE_FRESH_START', CORRUPT_MANIFEST: 'UNREADABLE_FRESH_START', READ_FAILED: 'STORAGE_UNAVAILABLE_FRESH_START' })[receipt.story] ?? 'NONE_STORED';
  nativeBrain ??= new Area52NativeBrain();
  const session = createDevelopmentDeploymentSillyTavernSession({
    ...options, storage, nativeBrain,
    // A snapshot the host supplies explicitly wins over stored owner state.
    memoryOwnerSnapshot: options.memoryOwnerSnapshot ?? owners.memory ?? null,
    loreOwnerSnapshot: options.loreOwnerSnapshot ?? owners.lore ?? null,
    sceneOwnerSnapshot: options.sceneOwnerSnapshot ?? owners.scene ?? null,
    hostState: story.parts?.host ?? null,
    restoreReceipt: receipt,
  });
  receipt.sceneOwner = session.brain?.sceneRestoreReceipt?.status ?? null;
  session.storageRestore = { ...session.storageRestore, ...receipt };
  return session;
}
