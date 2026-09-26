import {deepClone, stableHash} from './lore-contracts.js';

function required(value, code, label) {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw Object.assign(new TypeError(label + ' is required'), {code});
  return text;
}

function unique(values = []) {
  return [...new Set((values || []).filter((value) => value !== undefined && value !== null).map(String))].sort();
}

function normalizedFence(rows = [], lorebookId = null) {
  return (rows || [])
    .filter((row) => row?.sourceRevisionId != null && (lorebookId == null || String(row?.lorebookId ?? lorebookId) === String(lorebookId)))
    .map((row) => ({
      sourceId: row.sourceId == null ? null : String(row.sourceId),
      sourceRevisionId: String(row.sourceRevisionId),
    }))
    .sort((a, b) => (a.sourceId || '').localeCompare(b.sourceId || '') || a.sourceRevisionId.localeCompare(b.sourceRevisionId));
}

function cloneStory(story) {
  return {
    chatId: story.chatId,
    discoveries: [...story.discoveries.values()].map(deepClone).sort((a, b) => a.lorebookId.localeCompare(b.lorebookId)),
    accepted: [...story.accepted.values()].map(deepClone).sort((a, b) => a.lorebookId.localeCompare(b.lorebookId)),
    readLorebookIds: [...story.readLorebookIds].sort(),
    revisionChanges: story.revisionChanges.map(deepClone),
  };
}

/**
 * Lore read authority is exact-chat scoped. This registry deliberately does not
 * grant write, settlement, Context Seal, or host-prompt authority.
 */
export class LoreStoryAuthorityRegistry {
  constructor(snapshot = null) {
    this.stories = new Map();
    this.sequence = 0;
    this.revisionReceipts = [];
    if (snapshot) this.restore(snapshot);
  }

  _story(chatId, {create = true} = {}) {
    const id = required(chatId, 'LORE_STORY_CHAT_REQUIRED', 'Exact chatId');
    let story = this.stories.get(id);
    if (!story && create) {
      story = {
        chatId: id,
        discoveries: new Map(),
        accepted: new Map(),
        readLorebookIds: new Set(),
        revisionChanges: [],
      };
      this.stories.set(id, story);
    }
    return story || null;
  }

  recordDiscovery({chatId, lorebookId, title = null, discovery = null, hostSelectionRevision = null} = {}) {
    const story = this._story(chatId);
    const bookId = required(lorebookId, 'LORE_STORY_LOREBOOK_REQUIRED', 'Lorebook id');
    const receipt = {
      kind: 'LoreStoryHostDiscoveryReceipt',
      contractVersion: 1,
      receiptId: 'lore-story-discovery:' + stableHash({
        chatId: story.chatId,
        lorebookId: bookId,
        hostSelectionRevision,
        sequence: ++this.sequence,
      }),
      chatId: story.chatId,
      lorebookId: bookId,
      title: title == null ? bookId : String(title),
      discovery: deepClone(discovery),
      hostSelectionRevision: hostSelectionRevision == null ? null : String(hostSelectionRevision),
      discovered: true,
      acceptedForStudy: story.accepted.has(bookId),
      readAuthorized: story.readLorebookIds.has(bookId),
      selectedLorebookAutoAccepted: false,
      mutationAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    };
    story.discoveries.set(bookId, receipt);
    return deepClone(receipt);
  }

  acceptForStudy({chatId, lorebookId, sourceRevisionFence = [], acceptanceReceiptId = null, enableRead = true} = {}) {
    const story = this._story(chatId);
    const bookId = required(lorebookId, 'LORE_STORY_LOREBOOK_REQUIRED', 'Lorebook id');
    if (!story.discoveries.has(bookId)) {
      throw Object.assign(new Error('Lorebook must be host-discovered before story acceptance: ' + bookId), {
        code: 'LORE_STORY_DISCOVERY_REQUIRED',
      });
    }
    const fence = normalizedFence(sourceRevisionFence, bookId);
    const acceptance = {
      kind: 'LoreStoryStudyAcceptance',
      contractVersion: 1,
      chatId: story.chatId,
      lorebookId: bookId,
      acceptanceReceiptId: acceptanceReceiptId == null
        ? 'lore-story-accept:' + stableHash({chatId: story.chatId, lorebookId: bookId, fence, sequence: ++this.sequence})
        : String(acceptanceReceiptId),
      sourceRevisionFence: fence,
      acceptedForStudy: true,
      acceptedSequence: this.sequence,
    };
    story.accepted.set(bookId, acceptance);
    if (enableRead) story.readLorebookIds.add(bookId);
    const discovery = story.discoveries.get(bookId);
    if (discovery) {
      discovery.acceptedForStudy = true;
      discovery.readAuthorized = story.readLorebookIds.has(bookId);
    }
    return this.scopeReceipt(story.chatId);
  }

  setReadScope({chatId, lorebookIds = []} = {}) {
    const story = this._story(chatId);
    const requested = unique(lorebookIds);
    const unaccepted = requested.filter((id) => !story.accepted.has(id));
    if (unaccepted.length) {
      throw Object.assign(new Error('Story read scope can contain only accepted Lorebooks'), {
        code: 'LORE_STORY_READ_SCOPE_UNACCEPTED',
        details: {lorebookIds: unaccepted},
      });
    }
    story.readLorebookIds = new Set(requested);
    for (const discovery of story.discoveries.values()) {
      discovery.readAuthorized = story.readLorebookIds.has(discovery.lorebookId);
    }
    return this.scopeReceipt(story.chatId);
  }

  isReadAllowed(chatId, lorebookId) {
    if (chatId == null || String(chatId).trim() === '') return false;
    const story = this._story(chatId, {create: false});
    const bookId = String(lorebookId);
    return Boolean(story && story.accepted.has(bookId) && story.readLorebookIds.has(bookId));
  }

  allowedLorebookIds(chatId) {
    if (chatId == null || String(chatId).trim() === '') return [];
    const story = this._story(chatId, {create: false});
    return story ? [...story.readLorebookIds].filter((id) => story.accepted.has(id)).sort() : [];
  }

  recordRevisionChange({
    sourceId,
    lorebookId,
    previousSourceRevisionId = null,
    sourceRevisionId,
    sourceState = 'CURRENT',
    origin = 'SOURCE_REVISION_CHANGED',
  } = {}) {
    const bookId = required(lorebookId, 'LORE_STORY_LOREBOOK_REQUIRED', 'Lorebook id');
    const nextRevision = required(sourceRevisionId, 'LORE_STORY_REVISION_REQUIRED', 'Source revision id');
    const receipts = [];
    for (const story of this.stories.values()) {
      const acceptance = story.accepted.get(bookId);
      if (!acceptance) continue;
      acceptance.sourceRevisionFence = acceptance.sourceRevisionFence
        .filter((row) => row.sourceId !== String(sourceId))
        .concat([{sourceId: sourceId == null ? null : String(sourceId), sourceRevisionId: nextRevision}])
        .sort((a, b) => (a.sourceId || '').localeCompare(b.sourceId || '') || a.sourceRevisionId.localeCompare(b.sourceRevisionId));
      const receipt = {
        kind: 'LoreStoryRevisionAdmissionReceipt',
        contractVersion: 1,
        receiptId: 'lore-story-revision:' + stableHash({
          chatId: story.chatId,
          sourceId,
          sourceRevisionId: nextRevision,
          sequence: ++this.sequence,
        }),
        chatId: story.chatId,
        lorebookId: bookId,
        sourceId: sourceId == null ? null : String(sourceId),
        previousSourceRevisionId: previousSourceRevisionId == null ? null : String(previousSourceRevisionId),
        sourceRevisionId: nextRevision,
        sourceState: String(sourceState),
        origin: String(origin),
        acceptedForStudy: true,
        readScopeStillAuthorized: story.readLorebookIds.has(bookId),
        learnedRepresentationRequiresRevisionMatch: true,
        mutationAuthority: false,
        settlementAuthority: false,
        contextSealAuthority: false,
      };
      story.revisionChanges.push(receipt);
      if (story.revisionChanges.length > 128) story.revisionChanges.splice(0, story.revisionChanges.length - 128);
      this.revisionReceipts.push(receipt);
      if (this.revisionReceipts.length > 512) this.revisionReceipts.splice(0, this.revisionReceipts.length - 512);
      receipts.push(deepClone(receipt));
    }
    return receipts;
  }

  scopeReceipt(chatId) {
    const normalizedChatId = chatId == null ? '' : String(chatId).trim();
    if (!normalizedChatId) return this._unbound(null);
    const story = this._story(normalizedChatId, {create: false});
    if (!story) return this._unbound(normalizedChatId);
    const safe = cloneStory(story);
    return {
      kind: 'LoreStoryScopeReceipt',
      contractVersion: 1,
      chatId: story.chatId,
      state: 'BOUND',
      discoveredLorebooks: safe.discoveries,
      acceptedForStudy: safe.accepted,
      readLorebookIds: safe.readLorebookIds,
      recentRevisionChanges: safe.revisionChanges.slice(-32),
      exactChatBound: true,
      selectedLorebookAutoAccepted: false,
      globalReadAuthority: false,
      globalWriteAuthority: false,
      mutationAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    };
  }

  _unbound(chatId) {
    return {
      kind: 'LoreStoryScopeReceipt',
      contractVersion: 1,
      chatId,
      state: 'UNBOUND',
      discoveredLorebooks: [],
      acceptedForStudy: [],
      readLorebookIds: [],
      recentRevisionChanges: [],
      exactChatBound: true,
      selectedLorebookAutoAccepted: false,
      globalReadAuthority: false,
      globalWriteAuthority: false,
      mutationAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    };
  }

  snapshot() {
    return {
      kind: 'LoreStoryAuthorityRegistrySnapshot',
      contractVersion: 1,
      sequence: this.sequence,
      stories: [...this.stories.values()].map(cloneStory),
      revisionReceipts: this.revisionReceipts.map(deepClone),
    };
  }

  restore(snapshot) {
    this.sequence = Number(snapshot?.sequence || 0);
    this.stories = new Map();
    for (const row of snapshot?.stories || []) {
      const story = {
        chatId: String(row.chatId),
        discoveries: new Map((row.discoveries || []).map((item) => [String(item.lorebookId), deepClone(item)])),
        accepted: new Map((row.accepted || []).map((item) => [String(item.lorebookId), deepClone(item)])),
        readLorebookIds: new Set((row.readLorebookIds || []).map(String)),
        revisionChanges: (row.revisionChanges || row.recentRevisionChanges || []).map(deepClone),
      };
      this.stories.set(story.chatId, story);
    }
    this.revisionReceipts = (snapshot?.revisionReceipts || []).map(deepClone);
  }
}
