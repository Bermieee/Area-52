import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('installed extension loads the full Brain styling without global page resets', () => {
  const entry = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const host = readFileSync(new URL('../styles/ui-core-host.css', import.meta.url), 'utf8');
  assert.match(entry, /@import url\("\.\/styles\/ui-core-host\.css"\)/);
  for (let wave = 2; wave <= 8; wave++) {
    assert.match(entry, new RegExp(`@import url\\("\\./styles/ui-core-wave${wave}\\.css"\\)`));
  }
  assert.match(host, /\.a52-wave12-host-root/);
  assert.doesNotMatch(host, /(?:^|\n)body\s*\{/);
  assert.doesNotMatch(host, /(?:^|\n)\*\s*\{/);
});
