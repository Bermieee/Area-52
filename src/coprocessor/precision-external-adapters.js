import { ExternalPrecisionAdapter, PrecisionMeasurementStatus } from './precision-benchmark.js';

export function createFlashRankBenchmarkAdapter({ runner = null, providerId = 'external:flashrank', modelId = null } = {}) {
  return new ExternalPrecisionAdapter({ adapterId: 'flashrank', runner, providerId, modelId });
}

export function createColBertBenchmarkAdapter({ runner = null, providerId = 'external:colbert', modelId = null } = {}) {
  return new ExternalPrecisionAdapter({ adapterId: 'colbert-late-interaction', runner, providerId, modelId });
}

export function externalPrecisionAvailability({ flashRankRunner = null, colBertRunner = null } = {}) {
  return Object.freeze({
    flashRank: typeof flashRankRunner === 'function'
      ? Object.freeze({ status: PrecisionMeasurementStatus.MEASURED, executable: true, architecturalRole: 'OPTIONAL_CAPABILITY' })
      : Object.freeze({ status: PrecisionMeasurementStatus.NOT_MEASURED, executable: false, architecturalRole: 'OPTIONAL_CAPABILITY', reason: 'FlashRank runtime/model not supplied' }),
    colBert: typeof colBertRunner === 'function'
      ? Object.freeze({ status: PrecisionMeasurementStatus.MEASURED, executable: true, architecturalRole: 'OPTIONAL_CAPABILITY' })
      : Object.freeze({ status: PrecisionMeasurementStatus.NOT_MEASURED, executable: false, architecturalRole: 'OPTIONAL_CAPABILITY', reason: 'ColBERT runtime/model not supplied' }),
  });
}
