// Live finding (installed diagnostics 2026-09-29): PROMPT_PLAN took ~1.2 s on a 438-message chat because fitting the
// recent narrative re-rendered every shorter slice (quadratic). The allocator now bisects for the largest slice that fits
// when the estimator is the default length-based one. Equivalence: the same allocation, section for section, as the
// downward scan (forced here with a subclass estimator that estimates identically but is not the default class).
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveBudgetAllocator, DeterministicApproxTokenEstimator } from '../src/adaptive-context-budget.js';
import { sectionFromContribution } from '../src/adaptive-context-sections.js';
import { PromptSlot } from '../src/adaptive-context-contracts.js';

class ScanningEstimator extends DeterministicApproxTokenEstimator {}
function rng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; }; }
const spec = { owner: 'TEST', role: 'context', protected: false, band: 'DYNAMIC', cacheEligible: false };

function sections(random) {
  const narrative = Array.from({ length: 1 + Math.floor(random() * 60) }, (_, i) => ({ messageId: 'm' + i, role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(Math.floor(random() * 400)) + (random() < 0.1 ? '"\\\n' : '') }));
  const lore = Array.from({ length: 1 + Math.floor(random() * 30) }, (_, i) => random() < 0.2 ? 'plain lore ' + 'y'.repeat(Math.floor(random() * 200)) : { id: 'l' + i, e: 'Akira', p: 'guards', v: 'z'.repeat(Math.floor(random() * 300)), a: 'OWNER', cf: random() });
  const mk = (slot, content, priority, required = false) => sectionFromContribution({ id: slot, slot, semantic: false, priority, required, sourceRevisionIds: [], sourceCategory: 'TEST' }, { ...spec, protected: required }, content);
  return [mk(PromptSlot.CURRENT_SCENE, 'scene ' + 'w'.repeat(Math.floor(random() * 200)), 6, true), mk(PromptSlot.RECENT_NARRATIVE, narrative, 8), mk(PromptSlot.RELEVANT_LORE, lore, 5)];
}

test('bisected partial fit allocates exactly as the downward scan', () => {
  const fast = new AdaptiveBudgetAllocator(), scan = new AdaptiveBudgetAllocator({ estimator: new ScanningEstimator() });
  let partials = 0, cases = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const random = rng(seed), rows = sections(random);
    for (const preference of ['COMPACT', 'RICH']) {
      for (const budget of [40, 120, 300, 700, 1500, 3000, 6000, 12000, 30000]) {
        const profile = { contextWindow: 64000, reservedTokens: 20, structuredContextPreference: preference, sectionAllocationWeights: {} };
        const a = fast.allocate({ sections: rows, profile, budgetTokens: budget }), b = scan.allocate({ sections: rows, profile, budgetTokens: budget });
        assert.deepEqual(a, b, `seed ${seed} budget ${budget} ${preference}`);
        cases += 1; if (a.deferred?.some((row) => row.partial)) partials += 1;
      }
    }
  }
  assert.ok(partials > 100, 'the cases exercise partial fits (' + partials + ' of ' + cases + ')');
});

test('partial fit of a long narrative stays fast and keeps the newest messages', () => {
  const content = Array.from({ length: 438 }, (_, i) => ({ messageId: 'm' + i, role: 'assistant', content: ('Message ' + i + ' ').padEnd(3200, '.') }));
  const rows = [sectionFromContribution({ id: 'n', slot: PromptSlot.RECENT_NARRATIVE, semantic: false, priority: 8, required: false, sourceRevisionIds: [], sourceCategory: 'TEST' }, spec, content)];
  const profile = { contextWindow: 200000, reservedTokens: 0, structuredContextPreference: 'COMPACT', sectionAllocationWeights: {} };
  const started = performance.now();
  const plan = new AdaptiveBudgetAllocator().allocate({ sections: rows, profile, budgetTokens: 40000 });
  const elapsed = performance.now() - started;
  const kept = plan.sections[0].content;
  assert.equal(kept.at(-1).messageId, 'm437');
  const reference = new AdaptiveBudgetAllocator({ estimator: new ScanningEstimator() }).allocate({ sections: rows, profile, budgetTokens: 40000 });
  assert.equal(kept.length, reference.sections[0].content.length);
  assert.ok(elapsed < 400, 'bisection renders O(log n) slices (' + Math.round(elapsed) + ' ms)');
});
