// Follow-up (audit D10 / BOARD_MAP #18): Lore study runs as yielding, checkpointed Runtime batches with
// complete corpus coverage and incremental edits. Deterministic, no timings. FAKE-HOST evidence only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentDeploymentBrain } from '../src/deployment/brain.js';

const macrotask = () => new Promise((r) => setTimeout(r, 0));
const entry = (i, rev = 1) => ({ uid: 'e' + i, content: `Person${i} guards the vault of Place${i % 7}${rev > 1 ? ' no longer' : ''}. Person${i} owns the Item${i}.`, metadata: { title: 'Entry ' + i, at: i, treePath: ['P', '' + (i % 5)] } });
const book = (n, rev = 1, edited = new Set()) => ({
  id: 'batch', title: 'Batch', chatId: 'chat:batch', discovery: { kind: 'Fixture', stableId: 'batch', exactAuthoredSource: true },
  entries: Array.from({ length: n }, (_, i) => entry(i, edited.has(i) ? 2 : rev)),
});
const counts = (brain) => brain.loreIntelligence.runtime.store.countCurrentArtifactsByType(brain.loreIntelligence.runtime.registry);

test('batched study yields to the event loop between slices and covers the whole corpus', async () => {
  const brain = new DevelopmentDeploymentBrain();
  brain.acceptLorebook(book(40));
  let ticks = 0; const timer = setInterval(() => { ticks += 1; }, 0);
  const result = await brain.runLoreStudyBatched({ scope: 'DUE' });
  clearInterval(timer);
  assert.equal(result.kind, 'DeploymentLoreStudyReceipt');
  assert.equal(result.completedObligationCount, 40);
  assert.equal(brain.loreIntelligence.dueObligationIds().length, 0, 'nothing left due');
  assert.ok(ticks >= 10, 'the event loop ran during the study (ticks=' + ticks + ')');
  const entries = brain.readLoreStatus().study.entries;
  assert.equal(entries.length, 40);
  assert.ok(entries.every((row) => row.operatorState === 'READY'), 'every entry studied current');
  assert.equal(result.mappingCount, 40);
});

test('batched study produces the same learned corpus as the synchronous study', async () => {
  const a = new DevelopmentDeploymentBrain(), b = new DevelopmentDeploymentBrain();
  a.acceptLorebook(book(25)); a.runLoreStudy({ scope: 'DUE' });
  b.acceptLorebook(book(25)); await b.runLoreStudyBatched({ scope: 'DUE' });
  assert.deepEqual(counts(b), counts(a));
  assert.equal(b.loreIntelligence.hierarchy.retrievalIndex.revision, a.loreIntelligence.hierarchy.retrievalIndex.revision, 'identical retrieval index revision');
});

test('an incremental edit studies only the changed entries', async () => {
  const brain = new DevelopmentDeploymentBrain();
  brain.acceptLorebook(book(30)); await brain.runLoreStudyBatched({ scope: 'DUE' });
  const svc = brain.loreIntelligence;
  let studied = 0; const original = svc.studyObligation.bind(svc);
  svc.studyObligation = (...args) => { studied += 1; return original(...args); };
  brain.acceptLorebook(book(30, 1, new Set([3, 11, 20])));
  const result = await brain.runLoreStudyBatched({ scope: 'DUE' });
  assert.equal(studied, 3, 'only the 3 edited entries were re-studied');
  assert.equal(result.completedObligationCount, 3);
  assert.equal(svc.dueObligationIds().length, 0);
  assert.ok(brain.readLoreStatus().study.entries.every((row) => row.operatorState === 'READY'));
});

test('study waits while a foreground generation is active and resumes without losing work', async () => {
  const brain = new DevelopmentDeploymentBrain();
  brain.acceptLorebook(book(12));
  let foreground = true; brain.setForegroundProbe(() => foreground);
  const svc = brain.loreIntelligence; let studied = 0; const original = svc.studyObligation.bind(svc);
  svc.studyObligation = (...args) => { studied += 1; return original(...args); };
  const run = brain.runLoreStudyBatched({ scope: 'DUE' });
  for (let i = 0; i < 15; i += 1) await macrotask();
  assert.equal(studied, 0, 'no study slice ran during the foreground generation');
  foreground = false;
  const result = await run;
  assert.equal(studied, 12);
  assert.equal(result.completedObligationCount, 12);
});

test('an aborted study keeps its checkpoint; a second run finishes the remaining obligations', async () => {
  const brain = new DevelopmentDeploymentBrain();
  brain.acceptLorebook(book(20));
  const controller = new AbortController();
  const svc = brain.loreIntelligence; let studied = 0; const original = svc.studyObligation.bind(svc);
  svc.studyObligation = (...args) => { studied += 1; if (studied === 5) controller.abort(); return original(...args); };
  const first = await brain.runLoreStudyBatched({ scope: 'DUE', signal: controller.signal });
  assert.equal(first.aborted, true);
  const remaining = svc.dueObligationIds().length;
  assert.ok(remaining > 0 && remaining < 20, 'checkpointed: ' + remaining + ' still due');
  svc.studyObligation = original;
  const second = await brain.runLoreStudyBatched({ scope: 'DUE' });
  assert.equal(second.aborted, false);
  assert.equal(svc.dueObligationIds().length, 0);
  assert.ok(brain.readLoreStatus().study.entries.every((row) => row.operatorState === 'READY'));
});

test('study is a Runtime obligation recorded in the Work Ledger', async () => {
  const brain = new DevelopmentDeploymentBrain();
  brain.acceptLorebook(book(6)); await brain.runLoreStudyBatched({ scope: 'DUE' });
  const tasks = brain.runtimeDirector.ledger.list().filter((r) => r.obligation.taskType === 'LORE_STUDY');
  assert.ok(tasks.length >= 1, 'LORE_STUDY obligation in the ledger');
  assert.ok(tasks.every((r) => r.executionStatus === 'COMPLETE'), JSON.stringify(tasks.map((r) => r.executionStatus)));
  assert.equal(tasks[0].obligation.layer, 'L3');
});

test('installed path: the operator Run-study action is async Runtime batching and yields to a native generation', async () => {
  const { makeInstalled, EV } = await import('./helpers/installed-host.mjs');
  const h = makeInstalled({ chatId: 'chat:batch' });
  h.session.brain.acceptLorebook(book(15));
  const bindings = h.session.uiBindings();
  const action = bindings.loreStudyHost?.actions?.runLoreStudy ?? bindings.runLoreStudy;
  assert.equal(typeof action, 'function');
  // A native generation is pending: study must not run a slice until it ends.
  h.user('Hello there.');
  await h.emit(EV.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
  assert.ok(h.session.nativePending.size + h.session.nativeRuns.size > 0, 'precondition: generation in flight');
  const svc = h.session.brain.loreIntelligence; let studied = 0; const original = svc.studyObligation.bind(svc);
  svc.studyObligation = (...args) => { studied += 1; return original(...args); };
  const promise = action({ scope: 'DUE' });
  assert.equal(typeof promise?.then, 'function', 'async action');
  for (let i = 0; i < 12; i += 1) await macrotask();
  assert.equal(studied, 0, 'no slice ran while the generation was in flight');
  await h.emit(EV.CHAT_COMPLETION_PROMPT_READY, { chat: [{ role: 'user', content: 'x' }] });
  const idx = h.assistant('Hi.'); await h.emit(EV.MESSAGE_RECEIVED, idx, 'normal');
  const result = await promise;
  assert.equal(result.completedObligationCount, 15);
  assert.equal(studied, 15);
  h.session.destroy();
});

test('installed path: the operator Accept returns reference surfaces (no corpus copy); the owner state and status equal a full-receipt accept', async () => {
  const { makeInstalled } = await import('./helpers/installed-host.mjs');
  const run = async (viaOperator) => {
    const h = makeInstalled({ chatId: 'chat:acc' });
    const accept = viaOperator ? (h.session.uiBindings().loreStudyHost?.actions?.acceptLorebook ?? h.session.uiBindings().acceptLorebook) : (input) => h.session.brain.acceptLorebook(input);
    const first = await accept(book(12));
    await h.session.brain.runLoreStudyBatched({ scope: 'DUE' });
    const edited = book(12); edited.entries = edited.entries.map((e, i) => (i === 3 || i === 7 ? { ...e, content: e.content + ' It changed.' } : e));
    const second = await accept(edited);
    const status = h.session.brain.loreIntelligence.status();
    h.session.destroy();
    return { first, second, status };
  };
  const operator = await run(true), full = await run(false);
  for (const receipt of [operator.first, operator.second]) {
    assert.equal(receipt.receiptForm, 'REFERENCE');
    assert.equal(receipt.intelligence.kind, 'LoreIntelligenceStatusReference');
    assert.equal(receipt.ownerReceipt.status.kind, 'LoreIntelligenceStatusReference');
    assert.ok(JSON.stringify(receipt).length < JSON.stringify(full.second).length, 'smaller than the full receipt');
  }
  assert.equal(full.second.receiptForm, undefined, 'the default receipt is unchanged');
  assert.equal(full.second.intelligence.kind, 'LoreIntelligenceStatus');
  const core = (r) => ({ entryCount: r.entryCount, changedCount: r.changedCount, changes: r.ownerReceipt.changes, due: r.ownerReceipt.dueStudyObligations, sourceRevisionChanged: r.ownerReceipt.sourceRevisionChanged });
  assert.deepEqual(core(operator.second), core(full.second), 'same acceptance outcome');
  assert.equal(operator.second.changedCount, 2);
  assert.ok(operator.second.ownerReceipt.changes.some((c) => c.invalidatedRepresentationIds.length > 0), 'edited sources report their invalidated representations');
  assert.deepEqual(operator.status, full.status, 'the owner ends in the same state');
});
