import {runIntegrationWave4Acceptance} from '../tests/integration-wave4-harness.js';
import {runIntegrationWave4Stress} from '../tests/integration-wave4-stress-harness.js';
const a=runIntegrationWave4Acceptance(),s=runIntegrationWave4Stress();
const out={kind:'Phase1IntegrationGateEvidence',branch:'Development-Nexus',sha:process.env.GITHUB_SHA??process.argv[2]??'UNSPECIFIED',wave4Acceptance:a.metrics,wave4Stress:s.metrics,contractMatrix:a.matrix.counts,ft002:a.ft002.state,ft005:a.ft005.state,ft006:'HARNESS_READY',uiReadModels:{context:a.contextRead.kind,promptPlan:a.promptRead.kind,forensic:a.forensicRead.kind},assemblyPreflight:a.preflight.state,browserMatrix:a.browserMatrix.counts,programGate:a.gateReport.gateState,phase2Started:false,uiImplementationStarted:false};
console.log(JSON.stringify(out,null,2));if(!a.pass||!s.pass)process.exitCode=1;
