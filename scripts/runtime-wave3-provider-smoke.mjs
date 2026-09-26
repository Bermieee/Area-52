import {
  CAPABILITIES,
  CognitiveRuntimeHost,
  WorkerDirector,
} from '../src/runtime/index.js';

const endpoint = process.env.AREA52_PROVIDER_URL;
if (!endpoint) {
  console.error('Set AREA52_PROVIDER_URL to a JSON HTTP provider endpoint. Optional: AREA52_PROVIDER_TOKEN, AREA52_PROVIDER_MODEL.');
  process.exitCode = 2;
} else {
  const token = process.env.AREA52_PROVIDER_TOKEN ?? null;
  const model = process.env.AREA52_PROVIDER_MODEL ?? 'area52-runtime-smoke';
  const director = new WorkerDirector({
    persistence: null,
    capacity: { NETWORK: 1 },
    foregroundReserve: { NETWORK: 1 },
    resultSink: (result) => console.log(JSON.stringify({ resultReady: result }, null, 2)),
  });
  const host = new CognitiveRuntimeHost({ director });
  host.registerExecutionResource({
    worker: {
      workerId: 'manual-http-provider',
      capabilities: [CAPABILITIES.SEMANTIC_JUDGMENT, CAPABILITIES.STRUCTURED_LLM],
      supportedLayers: ['L0', 'L1', 'L2', 'L3', 'L4'],
      resourceProfile: { NETWORK: 1 },
      provider: new URL(endpoint).host,
      implementationId: 'manual-json-http',
      model,
      foregroundEligible: true,
      backgroundEligible: true,
    },
    adapter: {
      async invoke({ task, job, units, signal }) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ model, task, job, units }),
          signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        return body.output ?? body;
      },
    },
  });

  const now = Date.now();
  const turn = {
    schemaVersion: '1.0.0',
    turnId: `manual:${now}`,
    eventId: `manual-event:${now}`,
    eventType: 'TURN_EVENT',
    eventVersion: '1.0.0',
    correlationId: `manual-corr:${now}`,
    sourceRevisionSet: ['manual-source:1'],
    worldRevision: 1,
    sceneRevision: 1,
    characterStateRevision: 1,
    createdAt: now,
    cognitiveLayer: 'L1',
    dedupeKey: `manual:${now}`,
  };
  const task = {
    schemaVersion: '1.0.0',
    kind: 'CognitiveTask',
    taskId: `manual-task:${now}`,
    taskType: 'MANUAL_PROVIDER_SMOKE',
    turnId: turn.turnId,
    correlationId: turn.correlationId,
    requiredCapabilities: [CAPABILITIES.SEMANTIC_JUDGMENT],
    cognitiveLayer: 'L1',
    resultClass: 'REQUIRED',
    sourceRevisionSet: turn.sourceRevisionSet,
    worldRevision: 1,
    sceneRevision: 1,
    characterStateRevision: 1,
    softDeadline: now + 15000,
    hardDeadline: now + 30000,
    dedupeKey: `manual-task:${now}`,
    fallbackPolicy: { type: 'DETERMINISTIC', maxRetries: 0, result: { status: 'UNRESOLVED', reason: 'provider-smoke-fallback' } },
    outputSchema: { type: 'object' },
    metadata: {
      freshnessToken: `manual-fresh:${now}`,
      requestedDestination: 'DIAGNOSTIC_ONLY',
      providerTimeoutMs: 25000,
      input: { instruction: 'Return one small JSON object proving this provider path executed.' },
    },
  };

  host.publishTurn(turn, [task]);
  const quorum = await host.native.awaitForeground(turn.turnId);
  console.log(JSON.stringify({ quorum, note: 'Manual smoke only; this does not constitute FT005 PASS.' }, null, 2));
}
