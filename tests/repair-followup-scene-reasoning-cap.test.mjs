// Live finding (installed diagnostics 2026-09-29): the Sidecar Scene call on OpenRouter (z-ai/glm-5.3-flash) ended with
// finish_reason=length, content null and ~2,600 reasoning tokens against a 2,400-token budget: the model spent the whole
// generation budget reasoning. Contract pinned here:
//  - the Scene budget caps reasoning at what is left after the estimated final answer;
//  - the HTTP adapter sends that cap as OpenRouter's `reasoning` object, only to OpenRouter hosts (other endpoints unchanged);
//  - with the cap, a reasoning model that would otherwise exhaust the budget returns its answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityProfileRegistry } from '../src/coprocessor/capability-profiles.js';
import { OpenAICompatibleProviderAdapter, ProviderAdapterRegistry } from '../src/coprocessor/provider-adapters.js';
import { SpecialistExecutionLayer } from '../src/coprocessor/provider-execution.js';
import { createSceneObservationTask, SceneObservationSpecialist } from '../src/coprocessor/scene-observation-specialist.js';
import { Capability } from '../src/coprocessor/constants.js';

const narrative = 'Mara carries an object through the gallery while several people discuss their plans. '.repeat(20);
const task = () => createSceneObservationTask({ chatId: 'chat', turnId: 'turn', generationId: 'generation', correlationId: 'corr', sourceRevisionId: 'source@1', sceneRevision: 1, narrative, foregroundBudgetMs: 5000 });
const input = { narrative, sceneId: 'scene', baseRevision: 1, evidenceRef: 'evidence', sourceRevisionId: 'source@1' };
const ANSWER = JSON.stringify({ fields: {}, boundarySignals: {} });

function layerWith(adapter, { limit = 16000 } = {}) {
  const profiles = new CapabilityProfileRegistry(), adapters = new ProviderAdapterRegistry();
  profiles.register({ profileId: 'scene', workerId: 'worker', providerId: adapter.providerId, modelId: adapter.modelId, capabilities: [Capability.STRUCTURED_EXTRACTION], structuredOutput: true, maxOutputTokens: limit, maxContextTokens: 32000, latencyClass: 'LOW' });
  adapters.register(adapter);
  return new SpecialistExecutionLayer({ profiles, adapters, specialists: { SCENE_OBSERVATION: SceneObservationSpecialist } });
}
function recordingAdapter() {
  const options = [];
  return { options, providerId: 'provider', modelId: 'fixture', capabilities: [Capability.STRUCTURED_EXTRACTION], invoke: async (t, i, opts) => { options.push(opts); return { text: ANSWER, usage: {}, metadata: {}, startedAt: Date.now(), completedAt: Date.now(), latencyMs: 0 }; } };
}
function httpAdapter(endpoint, onBody) {
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => onBody(body) };
  };
  return new OpenAICompatibleProviderAdapter({ providerId: 'provider', modelId: 'z-ai/glm-5.3-flash', endpoint, apiKey: 'test-only', fetchImpl, capabilities: [Capability.STRUCTURED_EXTRACTION] });
}

test('the Scene budget reserves the estimated answer and gives reasoning only the rest', async () => {
  const unlimited = recordingAdapter();
  await layerWith(unlimited).execute(task(), { input });
  const t = task(), estimate = t.metadata.expectedOutputTokens;
  const [open] = unlimited.options;
  assert.equal(open.maxOutputTokens, estimate * 4, 'unchanged total budget: estimate plus 3x reasoning allowance');
  assert.equal(open.reasoningMaxTokens, estimate * 3);
  assert.ok(open.maxOutputTokens - open.reasoningMaxTokens >= estimate);

  const limited = recordingAdapter(), limit = estimate + 100;
  await layerWith(limited, { limit }).execute(task(), { input });
  assert.equal(limited.options[0].maxOutputTokens, limit);
  assert.equal(limited.options[0].reasoningMaxTokens, 100, 'a provider-limited budget still keeps the estimated answer');

  const exact = recordingAdapter();
  await layerWith(exact, { limit: estimate }).execute(task(), { input });
  assert.equal(exact.options[0].reasoningMaxTokens, 0);
});

test('the reasoning cap is sent only to OpenRouter hosts, as its reasoning object', async () => {
  const seen = [];
  const reply = (body) => { seen.push(body); return { model: body.model, choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }], usage: {} }; };
  const call = (endpoint, reasoningMaxTokens) => httpAdapter(endpoint, reply).invoke(task(), { messages: [{ role: 'user', content: 'x' }] }, { maxOutputTokens: 2400, reasoningMaxTokens });

  await call('https://openrouter.ai/api/v1', 1800);
  assert.deepEqual(seen.at(-1).reasoning, { max_tokens: 1800 });
  assert.equal(seen.at(-1).max_tokens, 2400, 'the overall budget is unchanged');
  await call('https://openrouter.ai/api/v1', 0);
  assert.deepEqual(seen.at(-1).reasoning, { effort: 'none' });
  await call('https://openrouter.ai/api/v1', null);
  assert.equal('reasoning' in seen.at(-1), false, 'no cap requested, nothing sent');
  for (const endpoint of ['https://api.example.invalid/v1', 'https://openrouter.ai.example.invalid/v1', 'http://localhost:5001/v1']) {
    await call(endpoint, 1800);
    assert.equal('reasoning' in seen.at(-1), false, endpoint + ' gets the request unchanged');
    assert.equal(seen.at(-1).max_tokens, 2400);
  }
});

test('with the cap, a reasoning model that would exhaust the budget returns its Scene answer', async () => {
  // Emulates the live failure: without a reasoning cap the model reasons past max_tokens and returns no content.
  const emulate = (body) => {
    const cap = body.reasoning?.max_tokens;
    if (!Number.isFinite(cap)) return { model: body.model, choices: [{ message: { content: null, reasoning: 'thinking…' }, finish_reason: 'length' }], usage: { completion_tokens: body.max_tokens, completion_tokens_details: { reasoning_tokens: body.max_tokens } } };
    assert.ok(body.max_tokens - cap > 0, 'room is left for the answer');
    return { model: body.model, choices: [{ message: { content: ANSWER, reasoning: 'thinking…' }, finish_reason: 'stop' }], usage: { completion_tokens: cap + 20, completion_tokens_details: { reasoning_tokens: cap } } };
  };
  const onOpenRouter = await layerWith(httpAdapter('https://openrouter.ai/api/v1', emulate)).execute(task(), { input });
  assert.equal(onOpenRouter.status, 'SUCCESS');
  // The same model behind an endpoint that does not define the control still fails visibly (not silently "fixed").
  await assert.rejects(() => layerWith(httpAdapter('https://api.example.invalid/v1', emulate)).execute(task(), { input }), (e) => /final completion text|MALFORMED/i.test(String(e?.message) + String(e?.code)));
});
