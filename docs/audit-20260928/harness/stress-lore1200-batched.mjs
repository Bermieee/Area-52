// STRESS (LOCAL_DETERMINISTIC_NODE, synthetic lorebook): 1,200-entry Lorebook studied through Runtime batches.
// Reports total time, the longest event-loop stall while it ran, and coverage. Compare with stress-lore1200.mjs
// (one synchronous call). N= overrides the size.
import { DevelopmentDeploymentBrain } from '../../../src/deployment/brain.js';
const N = Number(process.env.N || 1200), chatId = 'chat:lore' + N;
const places = ['Ember Tavern', 'Silver Keep', 'Greyharbor', 'River District', 'Ashfall Pass', 'Moonwell', 'Thornwood', 'Saint Veyra'];
const names = Array.from({ length: 150 }, (_, i) => ['Mara', 'Eris', 'Kael', 'Lyra', 'Tomas', 'Anya', 'Rhys', 'Selene', 'Dorian', 'Mira'][i % 10] + (i >= 10 ? ' ' + String.fromCharCode(65 + (i % 26)) + (i >> 5) : ''));
const entries = Array.from({ length: N }, (_, i) => ({ uid: 'e' + i, content: `${names[i % 150]} guards the ${['vault', 'gate', 'archive', 'forge'][i % 4]} of ${places[i % 8]}. ${names[i % 150]} distrusts ${names[(i * 7 + 3) % 150]} after the incident of year ${900 + (i % 97)}.`, metadata: { title: 'Entry ' + i, at: i, treePath: ['P', '' + (i % 20)] } }));
const brain = new DevelopmentDeploymentBrain();
brain.acceptLorebook({ id: 'synthetic-' + N, title: 'Synthetic ' + N, chatId, discovery: { kind: 'AuditSyntheticFixture', stableId: 'synthetic-' + N, exactAuthoredSource: true }, entries });
let last = performance.now(), maxGap = 0, ticks = 0;
const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; ticks += 1; }, 1);
const t0 = performance.now();
const result = await brain.runLoreStudyBatched({ scope: 'DUE' });
const total = performance.now() - t0;
clearInterval(timer);
const status = brain.readLoreStatusReference().study;
console.log(JSON.stringify({ N, totalMs: Math.round(total), longestEventLoopStallMs: Math.round(maxGap), ticks, completed: result.completedObligationCount, mappingCount: result.mappingCount, ready: status.counts.byOperatorState, due: brain.loreIntelligence.dueObligationIds().length, aborted: result.aborted }));
