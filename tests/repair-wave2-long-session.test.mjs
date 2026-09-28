// Wave 2 (audit D8/H3): long-session continuity on the installed session path. FAKE-HOST evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInstalled } from './helpers/installed-host.mjs';
import { createGoldenDeploymentLorebook } from '../src/deployment/brain.js';

const TURNS = Number(process.env.A52_LONG_TURNS || 100);
const filler = (i, n) => ('Turn ' + i + ': The lantern light flickers across the worn tavern tables while rain drums outside. ').repeat(Math.ceil(n / 95)).slice(0, n);

async function longSession({ withLore }) {
  const h = makeInstalled({ chatId: withLore ? 'chat:long:lore' : 'chat:long' });
  if (withLore) h.session.ingestLorebook({ ...createGoldenDeploymentLorebook(), chatId: h.context.chatId });
  const curve = [];
  for (let i = 1; i <= TURNS; i++) {
    const question = i === TURNS ? 'Where can Eris find the Sun Blade now?' : filler(i, 300);
    h.user(question);
    const r = await h.generate('normal', filler(i, 600));
    const sel = h.nativeBrain.uiBindings().readSelection({ chatId: h.context.chatId });
    const turn = h.nativeBrain.readTurn(sel.turnId);
    const sections = turn?.delivery?.plan?.sections ?? [];
    const scene = sections.find((s) => s.slot === 'CURRENT_SCENE');
    const input = sections.find((s) => s.slot === 'USER_INPUT');
    curve.push({ i, injected: h.injected(r), queryOk: turn?.query === question, planTokens: turn?.performance?.sizes?.promptPlanTokens ?? null,
      sceneTokens: scene ? Math.ceil(String(scene.text ?? '').length / 4) : 0, inputHasQuestion: String(input?.text ?? '').includes(question.slice(0, 40)),
      retirement: Boolean(turn?.contextRetirement), sections: sections.map((s) => s.slot) });
  }
  return { h, curve };
}

for (const withLore of [false, true]) {
  test(`${TURNS}-turn session ${withLore ? 'with story-bound Lore' : 'without Lore'}: context keeps being delivered and stays bounded`, async () => {
    const { h, curve } = await longSession({ withLore });
    const failures = curve.filter((c) => c.injected <= 0 || !c.queryOk);
    assert.deepEqual(failures.map((c) => c.i), [], 'every turn prepares and injects the current question');
    assert.deepEqual(h.errors(), []);
    assert.ok(curve.slice(30).every((c) => c.inputHasQuestion), 'USER_INPUT carries the current question after 30+ turns');
    const early = Math.max(...curve.slice(9, 20).map((c) => c.sceneTokens));
    const lateWindow = curve.slice(Math.max(20, curve.length - 40));
    const late = Math.max(...lateWindow.map((c) => c.sceneTokens));
    assert.ok(late <= early * 1.15 + 40, `CURRENT_SCENE projection stabilizes (early ${early}, late ${late})`);
    assert.ok(lateWindow.every((c) => c.planTokens <= 4096), 'plan stays within the delivery budget');
    assert.ok(curve.every((c) => c.retirement), 'installed path runs context retirement (activeContext supplied)');
    const hotTail = h.nativeBrain.core.hotCognition.snapshot?.(h.context.chatId)?.segments?.RECENT_EPISODE_TAIL?.value ?? null;
    if (hotTail) assert.ok(hotTail.length > 6, 'older tail evidence is retained in Hot state, not deleted');
    if (withLore) assert.ok(curve.at(-1).sections.includes('RELEVANT_LORE'), 'Lore still delivered on the final turn');
    console.log(JSON.stringify({ withLore, sample: curve.filter((c) => [1, 10, 20, 30, 50, 75, TURNS].includes(c.i)).map(({ i, planTokens, sceneTokens }) => ({ i, planTokens, sceneTokens })) }));
    h.session.destroy();
  });
}
