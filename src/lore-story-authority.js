import {deepClone, stableHash} from './lore-contracts.js';

function required(value, code, label) {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw Object.assign(new TypeError(label + ' is required'), {code});
  return text;
}

function unique(values = []) {
  return [...new Set((values || []).filter((value) => value !== undefined && value !== null).map(String))].sort();
}

function fenceByLorebook(sourceRevisionFence = []) {
  const byBook = new Map();
  for (const row of sourceRevisionFence || []) {
    if (!row || row.lorebookId == null || row.sourceRevisionId == null) continue;
    const lorebookId = String(row.lorebookId);
    const bucket = byBook.get(lorebookId) || [];
    bucket.push({
      sourceId: row.sourceId == null ? null : String(row.sourceId),
      sourceRevisionId: String(row.sourceRevisionId),
    });
    byBook.set(lorebookId, bucket);
  }
  for (const [key, rows] of byBook.entries()) {
    byBook.set(key, rows.sort((a, b) => (a.sourceId || '').localeCompare(b.sourceId || '')
      || a.sourceRevisionId.localeCompare(b.sourceRevisionId)));
  }
  return byBook;
}

function cloneStory(story) {
  return {
    chatId: story.chatId,
    discoveries: [...story.discoveries.values()].map(deepClone).sort((a, b) => a.lorebookId.localeCompare(b.lorebookId)),
    accepted: [...story.accepted.values()].map(deepClone).sort((a, b) => a.lorebookId.localeCompare(b.lorebookId)),
    readLorebookIds: [...story.readLorebookIds].sort(),
    writeAuthorities: [...story.writeAuthorities.values()].map(deepClone).sort((a, b) => a.lorebookId.localeCompare(b.lorebookId)),
    revisionChanges: story.revisionChanges.map(deepClone),
  };
}

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
        writeAuthorities: new Map(),
        revisionChanges: [],
      };
      this.stories.set(id, story);
    }
    return story || null;
  }

  hasScopedAuthority() {
    return this.stories.size > 0;
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
      writeAuthorized: false,
      automaticStoryInfluence: false,
      mutationAuthority: false,
    };
    story.discoveries.set(bookId, receipt);
    return deepClone(receipt);
  }

  acceptForStudy({
    chatId,
    lorebookId,
    sourceRevisionFence = [],
    acceptanceReceiptId = null,
    enableRead = true,
  } = {}) {
    const story = this._story(chatId);
    const bookId = required(lorebookId, 'LORE_STORY_LOREBOOK_REQUIRED', 'Lorebook id');
    if (!story.discoveries.has(bookId)) {
      throw Object.assign(new Error('Lorebook must be host-discovered before story acceptance: ' + bookId), {
        code: 'LORE_STORY_DISCOVERY_REQUIRED',
      });
    }
    const fence = (sourceRevisionFence || [])
      .filter((row) => String(row?.lorebookId ?? bookId) === bookId && row?.sourceRevisionId != null)
      .map((row) => ({
        sourceId: row.sourceId == null ? null : String(row.sourceId),
        sourceRevisionId: String(row.sourceRevisionId),
      }))
      .sort((a, b) => (a.sourceId || '').localeCompare(b.sourceId || '')
        || a.sourceRevisionId.localeCompare(b.sourceRevisionId));
    const accepted = {
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
    story.accepted.set(bookId, accepted);
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

  grantWriteAuthority({chatId, lorebookIds = [], sourceRevisionFence = [], operatorAuthorityId = null} = {}) {
    const story = this._story(chatId);
    const requested = unique(lorebookIds);
    if (!requested.length) {
      throw Object.assign(new TypeError('Write authority requires at least one Lorebook'), {
        code: 'LORE_STORY_WRITE_SCOPE_REQUIRED',
      });
    }
    const byBook = fenceByLorebook(sourceRevisionFence);
    for (const lorebookId of requested) {
      if (!story.accepted.has(lorebookId)) {
        throw Object.assign(new Error('Write authority requires accepted-for-study Lorebook: ' + lorebookId), {
          code: 'LORE_STORY_WRITE_UNACCEPTED',
        });
      }
      if (!story.readLorebookIds.has(lorebookId)) {
        throw Object.assign(new Error('Write authority requires the Lorebook in story read scope: ' + lorebookId), {
          code: 'LORE_STORY_WRITE_OUTSIDE_READ_SCOPE',
        });
      }
      const fence = byBook.get(lorebookId) || [];
      if (!fence.length) {
        throw Object.assign(new Error('Write authority requires exact source revision fence: ' + lorebookId), {
          code: 'LORE_STORY_WRITE_FENCE_REQUIRED',
        });
      }
      story.writeAuthorities.set(lorebookId, {
        kind: 'LoreStoryWriteAuthority',
        contractVersion: 1,
        chatId: story.chatId,
        lorebookId,
        operatorAuthorityId: operatorAuthorityId == null
          ? 'lore-story-write:' + stableHash({chatId: story.chatId, lorebookId, fence, sequence: ++this.sequence})
          : String(operatorAuthorityId),
        sourceRevisionFence: fence,
        state: 'ACTIVE',
        grantedSequence: this.sequence,
        revokedReason: null,
        revokedByRevisionReceiptId: null,
        mutationAuthority: false,
        settlementRequired: true,
      });
    }
    return this.scopeReceipt(story.chatId);
  }

  revokeWriteAuthority({chatId, lorebookIds = null, reason = 'OPERATOR_REVOKED'} = {}) {
    const story = this._story(chatId);
    const requested = lorebookIds == null ? [...story.writeAuthorities.keys()] : unique(lorebookIds);
    for (const lorebookId of requested) {
      const row = story.writeAuthorities.get(lorebookId);
      if (!row) continue;
      row.state = 'REVOKED';
      row.revokedReason = String(reason);
    }
    return this.scopeReceipt(story.chatId);
  }

  isReadAllowed(chatId, lorebookId) {
    const story = this._story(chatId, {create: false});
    return Boolean(story && story.accepted.has(String(lorebookId)) && story.readLorebookIds.has(String(lorebookId)));
  }

  assertWriteAllowed({chatId, lorebookIds = [], currentSourceRevisionFence = []} = {}) {
    const story = this._story(chatId, {create: false});
    if (!story) {
      throw Object.assign(new Error('No Lore authority is bound to this chat'), {code: 'LORE_STORY_SCOPE_UNKNOWN'});
    }
    const currentByBook = fenceByLorebook(currentSourceRevisionFence);
    const blocked = [];
    for (const lorebookId of unique(lorebookIds)) {
      const authority = story.writeAuthorities.get(lorebookId);
      if (!authority || authority.state !== 'ACTIVE') {
        blocked.push({lorebookId, reason: 'WRITE_AUTHORITY_NOT_ACTIVE'});
        continue;
      }
      const expected = authority.sourceRevisionFence.map((row) => row.sourceRevisionId).sort();
      const current = (currentByBook.get(lorebookId) || []).map((row) => row.sourceRevisionId).sort();
      if (JSON.stringify(expected) !== JSON.stringify(current)) {
        blocked.push({lorebookId, reason: 'WRITE_AUTHORITY_REVISION_STALE', expected, current});
      }
    }
    if (blocked.length) {
      throw Object.assign(new Error('Lore story write authority is blocked or stale'), {
        code: 'LORE_STORY_WRITE_BLOCKED',
        details: {chatId: story.chatId, blocked},
      });
    }
    return {
      kind: 'LoreStoryWriteAdmissionReceipt',
      contractVersion: 1,
      chatId: story.chatId,
      lorebookIds: unique(lorebookIds),
      sourceRevisionFence: deepClone(currentSourceRevisionFence),
      admitted: true,
      settlementRequired: true,
      directMutationAuthority: false,
    };
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
      if (!story.accepted.has(bookId)) continue;
      const write = story.writeAuthorities.get(bookId) || null;
      let writeRevoked = false;
      if (write?.state === 'ACTIVE') {
        const fenced = new Set(write.sourceRevisionFence.map((row) => row.sourceRevisionId));
        if ((previousSourceRevisionId && fenced.has(String(previousSourceRevisionId))) || !fenced.has(nextRevision)) {
          write.state = 'REVOKED';
          write.revokedReason = 'SOURCE_REVISION_CHANGED';
          writeRevoked = true;
        }
      }
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
        writeAuthorityRevoked: writeRevoked,
        writeAuthorityState: write?.state || 'NONE',
        contextSealAuthority: false,
        mutationAuthority: false,
      };
      if (writeRevoked) write.revokedByRevisionReceiptId = receipt.receiptId;
      story.revisionChanges.push(receipt);
      if (story.revisionChanges.length > 128) story.revisionChanges.splice(0, story.revisionChanges.length - 128);
      this.revisionReceipts.push(receipt);
      if (this.revisionReceipts.length > 512) this.revisionReceipts.splice(0, this.revisionReceipts.length - 512);
      receipts.push(deepClone(receipt));
    }
    return receipts;
  }

  allowedLorebookIds(chatId) {
    const story = this._story(chatId, {create: false});
    return story ? [...story.readLorebookIds].filter((id) => story.accepted.has(id)).sort() : [];
  }

  scopeReceipt(chatId) {
    const normalizedChatId = chatId == null ? '' : String(chatId).trim();
    if (!normalizedChatId) {
      return {
        kind: 'LoreStoryScopeReceipt',
        contractVersion: 1,
        chatId: null,
        state: 'UNBOUND',
        discoveredLorebooks: [],
        acceptedForStudy: [],
        readLorebookIds: [],
        writeAuthorities: [],
        exactChatBound: true,
        selectedLorebookAutoAccepted: false,
        globalReadAuthority: false,
        globalWriteAuthority: false,
      };
    }
    const story = this._story(normalizedChatId, {create: false});
    if (!story) {
      return {
        kind: 'LoreStoryScopeReceipt',
        contractVersion: 1,
        chatId: chatId == null ? null : String(chatId),
        state: 'UNBOUND',
        discoveredLorebooks: [],
        acceptedForStudy: [],
        readLorebookIds: [],
        writeAuthorities: [],
        exactChatBound: true,
        selectedLorebookAutoAccepted: false,
        globalReadAuthority: false,
        globalWriteAuthority: false,
      };
    }
    const safe = cloneStory(story);
    return {
      kind: 'LoreStoryScopeReceipt',
      contractVersion: 1,
      chatId: story.chatId,
      state: 'BOUND',
      discoveredLorebooks: safe.discoveries,
      acceptedForStudy: safe.accepted,
      readLorebookIds: safe.readLorebookIds,
      writeAuthorities: safe.writeAuthorities,
      recentRevisionChanges: safe.revisionChanges.slice(-32),
      exactChatBound: true,
      selectedLorebookAutoAccepted: false,
      globalReadAuthority: false,
      globalWriteAuthority: false,
      settlementOwnsMutation: true,
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
        writeAuthorities: new Map((row.writeAuthorities || []).map((item) => [String(item.lorebookId), deepClone(item)])),
        revisionChanges: (row.revisionChanges || row.recentRevisionChanges || []).map(deepClone),
      };
      this.stories.set(story.chatId, story);
    }
    this.revisionReceipts = (snapshot?.revisionReceipts || []).map(deepClone);
  }
}
