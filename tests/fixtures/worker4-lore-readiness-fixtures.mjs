export const WORKER4_SELECTED_CHAT = 'chat:worker4:selected';
export const WORKER4_UNBOUND_CHAT = 'chat:worker4:imported-unbound';

export function worker4SelectedLorebook({
  chatId = WORKER4_SELECTED_CHAT,
  state = 'open',
  includeRule = true,
} = {}) {
  return {
    id: 'worker4-harbor-lore',
    title: 'Worker 4 Harbor Lore',
    discovery: {
      kind: 'SillyTavernLorebookDiscoveryReceipt',
      contractVersion: 1,
      source: 'SILLYTAVERN_WORLD_INFO_EDITOR',
      lorebookId: 'worker4-harbor-lore',
      title: 'Worker 4 Harbor Lore',
      entryCount: includeRule ? 2 : 1,
      chatId,
      exactAuthoredSource: true,
    },
    fullSnapshot: true,
    entries: [
      {
        uid: 'gate',
        content: 'The Harbor Gate is ' + state + '.',
        metadata: {title: 'Harbor Gate', treePath: ['Harbor', 'Places'], order: 1},
      },
      ...(includeRule ? [{
        uid: 'rule',
        content: 'Only Harbor Wardens may open the Harbor Gate.',
        metadata: {title: 'Harbor Gate Rule', treePath: ['Harbor', 'Rules'], order: 2},
      }] : []),
    ],
  };
}

export function worker4UnacceptedLorebook() {
  return {
    id: 'worker4-unaccepted-lore',
    title: 'Worker 4 Unaccepted Lore',
    discovery: {
      kind: 'SillyTavernLorebookDiscoveryReceipt',
      contractVersion: 1,
      source: 'SILLYTAVERN_WORLD_INFO_EDITOR',
      lorebookId: 'worker4-unaccepted-lore',
      title: 'Worker 4 Unaccepted Lore',
      entryCount: 1,
      chatId: null,
      exactAuthoredSource: true,
    },
    fullSnapshot: true,
    entries: [{
      uid: 'archive',
      content: 'The Quartz Archive is sealed.',
      metadata: {title: 'Quartz Archive', treePath: ['Archive'], order: 1},
    }],
  };
}

export const WORKER1_LORE_ELIGIBILITY_EXPECTATIONS = Object.freeze({
  eligible: {
    chatId: WORKER4_SELECTED_CHAT,
    query: 'Harbor Gate',
    expectedDecision: 'ELIGIBLE',
    expectedReason: 'AUTHORIZED_CURRENT_RETRIEVAL_MATCH',
    mustCarry: ['sourceId', 'lorebookId', 'uid', 'sourceRevisionId', 'authorityScope'],
  },
  excludedUnbound: {
    chatId: WORKER4_UNBOUND_CHAT,
    query: 'Harbor Gate',
    expectedDecision: 'EXCLUDED',
    expectedReason: 'LORE_STORY_SCOPE_REQUIRED',
  },
  excludedUnaccepted: {
    chatId: WORKER4_SELECTED_CHAT,
    query: 'Quartz Archive',
    expectedDecision: 'EXCLUDED',
    expectedReason: 'LOREBOOK_NOT_ACCEPTED_FOR_STUDY',
  },
});
