import { evaluateWave10Corpus } from './jev-wave10-evaluator.mjs';

export async function evaluateWave22JevValue(){
  const source=await evaluateWave10Corpus();
  const deterministic=source.aggregates.byPath.DETERMINISTIC_ONLY;
  const jev=source.aggregates.byPath.JEV;
  const jevRows=source.cases.flatMap(row=>row.rows.filter(result=>result.path==='JEV'));
  const ambiguousCases=source.cases.filter(row=>row.ambiguous).length;
  const physicalFixtureAttempts=jevRows.filter(row=>row.providerId!=null).length;
  return Object.freeze({
    kind:'JEV_WAVE22_VALUE_REPORT',
    contractVersion:'1.0.0',
    sourceCorpus:source.corpusId,
    comparison:Object.freeze({
      deterministicOnly:Object.freeze({
        cases:deterministic.cases,correctnessRate:deterministic.validityRate,safeAbstentions:deterministic.safeAbstentions,
        falseCertainty:deterministic.falseCertainty,ambiguousResolvedValidly:deterministic.ambiguousResolvedValidly,
        ambiguousSafeUncertainty:deterministic.ambiguousSafeUncertainty,meanLatencyMs:deterministic.meanLatencyMs,totalTokens:deterministic.totalTokens,
      }),
      jevAssisted:Object.freeze({
        cases:jev.cases,correctnessRate:jev.validityRate,safeAbstentions:jev.safeAbstentions,falseCertainty:jev.falseCertainty,
        ambiguousResolvedValidly:jev.ambiguousResolvedValidly,ambiguousSafeUncertainty:jev.ambiguousSafeUncertainty,
        meanLatencyMs:jev.meanLatencyMs,totalTokens:jev.totalTokens,providerConsistencyRate:jev.providerConsistencyRate,
      }),
      delta:Object.freeze({
        correctnessRate:jev.validityRate-deterministic.validityRate,
        falseCertainty:jev.falseCertainty-deterministic.falseCertainty,
        ambiguousResolvedValidly:jev.ambiguousResolvedValidly-deterministic.ambiguousResolvedValidly,
        latencyMs:jev.meanLatencyMs-deterministic.meanLatencyMs,
        tokenProxyCost:jev.totalTokens-deterministic.totalTokens,
      }),
      ambiguousCases,
    }),
    executionEvidence:Object.freeze({
      fixtureMeasurementClass:'LOCAL_DETERMINISTIC',
      fixturePhysicalProviderAttempts:physicalFixtureAttempts,
      liveMeasurementClass:'NOT_MEASURED',
      authenticatedLiveProviderPhysicalAttempts:0,
      authenticatedOwnerAcceptedExecutions:0,
      liveLatencyMeasured:false,
      liveCostMeasured:false,
      fixturesCountAsLive:false,
      ft005Status:'OPEN_PENDING_INSTALLED_SILLYTAVERN_AUTHENTICATED_OPTIONAL_PROVIDER_EXECUTION_AND_OWNER_ADMISSION',
    }),
    safety:Object.freeze({
      falseCertaintyMustRemainVisible:true,authorityViolations:jev.authorityViolations,staleRejected:jev.staleRejected,
      aggregateScoreCanOverrideSafetyFailure:false,
    }),
  });
}
