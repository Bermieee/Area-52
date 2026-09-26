import { summarizeWave3Qualification } from '../src/coprocessor/index.js';

const report = summarizeWave3Qualification({ mode: 'REPLAYED' });
console.log(JSON.stringify({ kind: 'Wave3AcceptanceHarness', qualification: report, note: 'Run npm test, focused suites, stress, browser-like tests, syntax and ESM import for acceptance.' }, null, 2));
