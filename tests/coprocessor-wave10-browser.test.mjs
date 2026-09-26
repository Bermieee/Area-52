import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const safe=['evaluation/jev-wave10-corpus.mjs','evaluation/jev-wave10-evaluator.mjs','evaluation/jev-wave10-provider-qualification.mjs'];
test('Wave 10 reusable evaluation modules remain browser-safe',async()=>{for(const file of safe){const source=await fs.readFile(file,'utf8');assert.doesNotMatch(source,/from ['"]node:|require\(|process\.|Buffer\.|__dirname|__filename/,file)}});
test('Wave 10 evaluator executes through browser-safe production imports',async()=>{const {evaluateWave10Corpus}=await import('../evaluation/jev-wave10-evaluator.mjs'),r=await evaluateWave10Corpus();assert.equal(r.cases.length,13);assert.equal(r.aggregates.byPath.JEV.authorityViolations,0)});
