import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDevelopmentDeploymentTurn,
  createDevelopmentDeploymentSillyTavernSession,
  extractDevelopmentDeploymentScene,
} from '../src/deployment/sillytavern-live.js';

function makeHost() {
  const listeners = new Map();
  const promptCalls = [];
  const context = {
    chatId: 'chat:live-224',
    chat: [],
    eventTypes: { GENERATION_AFTER_COMMANDS: 'generation_after_commands', MESSAGE_SENT: 'message_sent' },
    eventSource: {
      on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeListener(type, fn) { listeners.get(type)?.delete(fn); },
    },
    async setExtensionPrompt(...args) { promptCalls.push(args); },
  };
  return { sillyTavern: { getContext: () => context }, context, promptCalls, listeners };
}

test('armed demo processes a newly sent message and reports manual failures', async () => {
  const { sillyTavern, context, listeners } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({ sillyTavern, document: null, mountUi: false });
  session.start();
  assert.equal(listeners.get('message_sent')?.size, 1);
  assert.equal(listeners.get('generation_after_commands')?.size ?? 0, 0);
  pushUser(context, 'Mara and Eris are inside the Ember Tavern with the Sun Blade present. Where are we?');
  await Promise.all([...listeners.get('message_sent')].map(fn => fn()));
  assert.equal(session.exportEvidence().checks.simple, true);
  context.chatId = null;
  await assert.rejects(session.processCurrentTurn(), /chatId is unavailable/);
  assert.match(session.exportEvidence().errors.at(-1).message, /chatId is unavailable/);
  session.destroy();
});

function pushUser(context, mes) {
  context.chat.push({ is_user: true, mes, send_date: Date.now() });
}

test('live demo classifier and scene extractor keep simple/retrieval/ambiguity distinct', () => {
  assert.equal(classifyDevelopmentDeploymentTurn('Where are we?'), 'simple');
  assert.equal(classifyDevelopmentDeploymentTurn('Tell me about Mara and the Ember Tavern history.'), 'retrieval');
  assert.equal(classifyDevelopmentDeploymentTurn('What happened to the Sun Blade?'), 'ambiguous');
  const parsed = extractDevelopmentDeploymentScene(
    'Mara and Eris reach the Ember Tavern Ruins. What happened to the Sun Blade?',
    { revision: 2, evidenceRef: 'source:host@1' },
  );
  assert.equal(parsed.explicit, true);
  assert.equal(parsed.fields.location.value.location, 'Ember Tavern Ruins');
  assert.equal(parsed.fields.immediateObjects.value[0].state, 'UNCERTAIN');
});

test('host-driven three-turn evidence uses one resource, injects sealed PromptPlans, and degrades without Jev', async () => {
  const { sillyTavern, context, promptCalls } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({ sillyTavern, document: null, mountUi: false });

  pushUser(context, 'Mara and Eris are inside the Ember Tavern with the Sun Blade present. Where are we?');
  const simple = await session.processCurrentTurn();
  assert.equal(simple.mode, 'simple');
  assert.equal(simple.runtime.jobCount, 0);
  assert.equal(simple.delivery.ok, true);
  assert.equal(simple.delivery.promptInjection.succeeded, true);

  pushUser(context, 'Tell me about Mara and the Ember Tavern history.');
  const retrieval = await session.processCurrentTurn();
  assert.equal(retrieval.mode, 'retrieval');
  assert.equal(retrieval.runtime.resourceCount, 1);
  assert.ok(retrieval.runtime.jobCount >= 2);
  assert.equal(retrieval.delivery.ok, true);

  pushUser(context, 'Mara and Eris reach the Ember Tavern Ruins. What happened to the Sun Blade?');
  const ambiguous = await session.processCurrentTurn();
  assert.equal(ambiguous.mode, 'ambiguous');
  assert.equal(ambiguous.scene.observedFromHostMessage, true);
  assert.ok(ambiguous.scene.changedFields.includes('location'));
  assert.ok(ambiguous.cognition.jev);
  assert.equal(ambiguous.cognition.jev.mutationAuthority, false);
  assert.equal(ambiguous.delivery.ok, true);

  const beforeReview = session.exportEvidence();
  assert.deepEqual(beforeReview.checks, { simple: true, retrieval: true, ambiguous: true, degraded: true });
  assert.equal(beforeReview.degraded.safe, true);
  assert.equal(beforeReview.status, 'OPERATOR_CONFIRMATION_PENDING');
  assert.equal(beforeReview.issue224AutomaticPass, false);
  assert.equal(promptCalls.length, 3);

  const afterReview = session.confirmOperatorReview();
  assert.equal(afterReview.operatorReview.promptInspectorConfirmed, true);
  assert.equal(afterReview.operatorReview.uiTraceReviewed, true);
  assert.equal(afterReview.issue224AutomaticPass, false);
  assert.equal(afterReview.directorApprovalRequired, true);
  session.destroy();
});
