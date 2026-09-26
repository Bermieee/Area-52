import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const productionFiles = [
  'src/lore-contracts.js',
  'src/lore-source-registry.js',
  'src/lore-study-engine.js',
  'src/lore-study-runtime.js',
  'src/lore-representation-contracts.js',
  'src/lore-representation-compiler.js',
  'src/lore-representation-registry.js',
  'src/lore-multi-resolution.js',
  'src/lore-navigation-contracts.js',
  'src/lore-navigation-hierarchy.js',
  'src/lore-navigation-summary-registry.js',
  'src/lore-navigation-summary-builder.js',
  'src/lore-contextual-retrieval.js',
  'src/lore-hierarchy-retrieval-system.js',
  'src/lore-world-ontology.js',
  'src/lore-intelligence-service.js',
  'src/lore-authoring-contracts.js',
  'src/lore-semantic-authoring.js',
  'src/lore-structure-planner.js',
  'src/lore-merge-preview.js',
  'src/lore-authoring-service.js',
  'src/lore-authoring-lifecycle.js',
];

test('integration-visible Lore production modules avoid Node-only runtime dependencies', async () => {
  for (const path of productionFiles) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /\bBuffer\b/);
    assert.doesNotMatch(source, /\bprocess\b/);
    assert.doesNotMatch(source, /\brequire\s*\(/);
    assert.doesNotMatch(source, /node:/);
    assert.doesNotMatch(source, /from\s+['"](?:fs|path|worker_threads)['"]/);
  }
  const modules = await Promise.all(productionFiles.map((path) => import('../' + path)));
  assert.equal(modules.length, productionFiles.length);
});
