import { sha256Hex } from './browser-compat.js';

export const ARTIFACT_REFERENCE_VERSION = '1.0.0';
export const ArtifactReferenceStatus = Object.freeze({
  EXACT: 'EXACT', STALE: 'STALE', SUPERSEDED: 'SUPERSEDED', MISSING: 'MISSING', INVALID: 'INVALID',
});

export function createArtifactReference(input = {}) {
  const revision = Number(input.revision);
  if (!Number.isInteger(revision) || revision < 0) throw new TypeError('ArtifactReference.revision must be a non-negative integer');
  const selector = normalizeSliceSelector(input.sliceSelector ?? null);
  return deepFreeze({
    kind: 'ArtifactReference',
    contractVersion: ARTIFACT_REFERENCE_VERSION,
    artifactId: required(input.artifactId, 'artifactId'),
    artifactType: required(input.artifactType, 'artifactType'),
    owner: required(input.owner, 'owner'),
    revision,
    storageDomain: required(input.storageDomain ?? input.repositoryDomain ?? 'artifacts', 'storageDomain'),
    sourceRevisionSet: uniqueStrings(input.sourceRevisionSet ?? []),
    worldRevision: finiteOrNull(input.worldRevision),
    sceneRevision: finiteOrNull(input.sceneRevision),
    contentHash: optionalString(input.contentHash),
    sliceSelector: selector,
    provenanceRef: optionalString(input.provenanceRef),
    expiry: input.expiry == null ? null : structuredClone(input.expiry),
    authorityGranted: false,
    settlementAuthority: false,
    contextSealBypass: false,
  });
}

export function artifactReferenceFromEnvelope(envelope, options = {}) {
  if (!envelope || envelope.kind !== 'ArtifactEnvelope') throw new TypeError('ArtifactEnvelope is required');
  return createArtifactReference({
    artifactId: envelope.artifactId,
    artifactType: envelope.artifactType,
    owner: envelope.owner,
    revision: envelope.revision,
    storageDomain: options.storageDomain ?? options.repositoryDomain ?? 'artifacts',
    sourceRevisionSet: options.sourceRevisionSet ?? envelope.provenance?.sourceRevisionSet ?? [],
    worldRevision: options.worldRevision ?? envelope.provenance?.worldRevision ?? null,
    sceneRevision: options.sceneRevision ?? envelope.provenance?.sceneRevision ?? null,
    contentHash: options.contentHash ?? null,
    sliceSelector: options.sliceSelector ?? null,
    provenanceRef: options.provenanceRef ?? null,
    expiry: options.expiry ?? null,
  });
}

export function resolveArtifactReference(referenceInput, { repository, currentRevisionSet = null } = {}) {
  let reference;
  try { reference = createArtifactReference(referenceInput); }
  catch (error) { return result(ArtifactReferenceStatus.INVALID, null, referenceInput, error.message); }
  if (!repository || typeof repository.get !== 'function') return result(ArtifactReferenceStatus.INVALID, null, reference, 'repository.get is required');
  if (isFenceStale(reference, currentRevisionSet)) return result(ArtifactReferenceStatus.STALE, null, reference, 'revision fence mismatch');
  const exact = repository.get(reference.storageDomain, reference.artifactId, { revision: reference.revision });
  if (!exact) {
    const latest = repository.get(reference.storageDomain, reference.artifactId);
    if (!latest) return result(ArtifactReferenceStatus.MISSING, null, reference, 'artifact revision is missing');
    if (Number(latest.revision) > reference.revision) return result(ArtifactReferenceStatus.SUPERSEDED, null, reference, 'requested revision is no longer available; newer revision exists');
    return result(ArtifactReferenceStatus.MISSING, null, reference, 'artifact revision is missing');
  }
  const value = exact.value ?? exact;
  if (Number(exact.revision ?? value.revision) !== reference.revision) return result(ArtifactReferenceStatus.INVALID, null, reference, 'repository returned a different revision');
  if (value.kind === 'ArtifactEnvelope') {
    if (value.artifactId !== reference.artifactId) return result(ArtifactReferenceStatus.INVALID, null, reference, 'artifactId mismatch');
    if (value.artifactType !== reference.artifactType) return result(ArtifactReferenceStatus.INVALID, null, reference, 'artifactType mismatch');
    if (value.owner !== reference.owner) return result(ArtifactReferenceStatus.INVALID, null, reference, 'owner mismatch');
    if (Number(value.revision) !== reference.revision) return result(ArtifactReferenceStatus.INVALID, null, reference, 'envelope revision mismatch');
  }
  if (reference.contentHash && sha256Hex(JSON.stringify(value)) !== reference.contentHash) {
    return result(ArtifactReferenceStatus.INVALID, null, reference, 'content hash mismatch');
  }
  let material;
  try { material = selectSlice(value, reference.sliceSelector); }
  catch (error) { return result(ArtifactReferenceStatus.INVALID, null, reference, error.message); }
  return result(ArtifactReferenceStatus.EXACT, material, reference, null);
}

export function selectSlice(value, selector) {
  if (!selector || selector.length === 0) return structuredClone(value);
  let current = value;
  for (const segment of selector) {
    if (!current || typeof current !== 'object' || !(segment in current)) throw new Error(`slice not found: ${selector.join('.')}`);
    current = current[segment];
  }
  return structuredClone(current);
}

function result(status, material, reference, reason) {
  return Object.freeze({ status, material: material == null ? null : structuredClone(material), reference: safeClone(reference), reason, authorityGranted: false, settlementAuthority: false, contextSealBypass: false });
}
function isFenceStale(reference, current) {
  if (!current) return false;
  if (reference.worldRevision != null && Number(current.worldRevision) !== reference.worldRevision) return true;
  if (reference.sceneRevision != null && Number(current.sceneRevision) !== reference.sceneRevision) return true;
  if (reference.sourceRevisionSet.length) {
    const have = new Set(current.sourceRevisionSet ?? []);
    if (reference.sourceRevisionSet.some((revision) => !have.has(revision))) return true;
  }
  return false;
}
function normalizeSliceSelector(value) {
  if (value == null || value === '') return null;
  const parts = Array.isArray(value) ? value : String(value).split('.');
  if (!parts.length || parts.some((part) => typeof part !== 'string' || !part.trim() || ['__proto__','prototype','constructor'].includes(part.trim()))) throw new TypeError('sliceSelector contains an invalid segment');
  return Object.freeze(parts.map((part) => part.trim()));
}
function required(value, name) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`); return value.trim(); }
function optionalString(value) { return value == null ? null : required(value, 'optional string'); }
function finiteOrNull(value) { if (value == null) return null; const number = Number(value); if (!Number.isFinite(number)) throw new TypeError('revision fence must be finite'); return number; }
function uniqueStrings(values) { if (!Array.isArray(values)) throw new TypeError('sourceRevisionSet must be an array'); return [...new Set(values.map((value) => required(value, 'sourceRevisionSet item')))].sort(); }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
function safeClone(value) { try { return structuredClone(value); } catch { return null; } }
