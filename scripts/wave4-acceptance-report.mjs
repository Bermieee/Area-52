import {
  DeterministicSemanticJudgeAdapter, benchmarkCandidateScaling, externalPrecisionAvailability,
  runExternalPrecisionBenchmark, runPrecisionGainBenchmark, runTemporalPrecisionBenchmark,
  runTwoStagePrecisionBenchmark, summarizeWave4PrecisionQualification,
} from '../src/coprocessor/index.js';

const gain = await runPrecisionGainBenchmark();
const temporal = await runTemporalPrecisionBenchmark();
const twoStage = await runTwoStagePrecisionBenchmark({ secondStageAdapter: new DeterministicSemanticJudgeAdapter() });
const scaling = await benchmarkCandidateScaling({ sizes: [8, 32, 64, 128, 256] });
const flashRank = await runExternalPrecisionBenchmark({ adapterId: 'flashrank' });
const colBert = await runExternalPrecisionBenchmark({ adapterId: 'colbert-late-interaction' });
const qualification = summarizeWave4PrecisionQualification({
  broadBaseline: gain.baseline, precision: gain.precision, temporal,
  contradiction: [true], fallback: [true], providerInterchange: [true], scaling,
  external: { flashRank, colBert },
});
console.log(JSON.stringify({ gain, temporal, twoStage, scaling, availability: externalPrecisionAvailability(), qualification }, null, 2));
