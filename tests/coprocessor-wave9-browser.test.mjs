import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JevDecisionCore, createJevDomainAdapterMatrix } from '../src/coprocessor/index.js';
import { currentFor, output, providerExecutor, sceneBoundary } from './wave9-fixtures.mjs';

const production = [
  '../src/coprocessor/jev-domain-adapter.js',
  '../src/coprocessor/jev-lore-adapter.js',
  '../src/coprocessor/jev-scene-adapter.js',
  '../src/coprocessor/jev-retrieval-truth-adapter.js',
  '../src/coprocessor/jev-adapter-matrix.js',
];

test('Wave 9 production adapter modules are browser/SillyTavern safe', async () => {
  const banned = [/\bBuffer\b/, /\bprocess\b/, /\brequire\s*\(/, /from\s+['"]node:/, /from\s+['"]fs['"]/, /from\s+['"]path['"]/, /worker_threads/];
  for (const path of production) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    for (const pattern of banned) assert.equal(pattern.test(source), false, `${path} contains ${pattern}`);
  }
});

test('browser-like representative adapter path executes without Node-only production dependencies', async () => {
  const m = createJevDomainAdapterMatrix({ core: new JevDecisionCore({ providerExecutor: providerExecutor(() => ({ payload: output({ selected: ['RESUME_PRIOR_SCENE'], rejected: ['CONTINUE_SCENE', 'OPEN_NEW_SCENE', 'UNRESOLVED'], evidenceUsed: ['scene:a', 'scene:b'] }) })) }) });
  const input = sceneBoundary('browser-scene');
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(proposal.proposalType, 'SceneDecisionProposal');
  assert.equal(proposal.mutationAuthority, false);
});