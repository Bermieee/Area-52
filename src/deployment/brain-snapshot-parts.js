// Splits a Native Brain snapshot into storage parts so a checkpoint writes only what changed.
//
// The three arrays that grow with the story (turn records, Work Ledger records, Context Seal entries) are cut into
// fixed-size chunks; every chunk is its own part. The storage adapter reuses a part whose checksum is unchanged, so a
// settled prefix is never rewritten and a checkpoint costs roughly the changed tail plus the small core part.
// `unpackBrainSnapshot` is the exact inverse (asserted by tests); a missing chunk makes the whole story unusable
// (returns null) rather than restoring a torn Brain.
import { sha256Hex } from '../coprocessor/browser-compat.js';
const CHUNK = { turns: 1, ledger: 16, seal: 16 };
const pad = (n) => String(n).padStart(5, '0');


// Storage-level dedupe (O8, owner-authorised: no change to the published seal, its hash or the evidence).
// A turn record repeats the same large candidate lists many times. Inside ONE turn part, every sub-tree whose JSON is at
// least MIN_SHARED characters is stored once in `blobs` and referenced by content hash; unpacking re-inflates each
// reference into an independent copy, so the restored record is deep-equal to the original (asserted by tests). A record
// that already contains the reference key is stored verbatim rather than risk ambiguity.
const REF = '$area52Ref';
const MIN_SHARED = 512;
function dedupeRows(rows) {
  if (JSON.stringify(rows).includes('"' + REF + '"')) return rows;
  const blobs = {};
  const enc = (node) => {
    if (node === null || typeof node !== 'object') return { value: node, size: 0 };
    let size = 2, out;
    if (Array.isArray(node)) {
      out = node.map((child) => { const r = enc(child); size += r.size + 1; return r.value; });
    } else {
      out = {};
      for (const [key, child] of Object.entries(node)) { if (child === undefined) continue; const r = enc(child); size += key.length + r.size + 4; out[key] = r.value; }
    }
    if (size < MIN_SHARED) return { value: out, size };
    const text = JSON.stringify(out), hash = sha256Hex(text).slice(0, 32);
    if (!(hash in blobs)) blobs[hash] = out;
    return { value: { [REF]: hash }, size: 24 + REF.length };
  };
  const encoded = rows.map((row) => enc(row).value);
  return { kind: 'Area52DedupedTurnRows', rows: encoded, blobs };
}
function inflateRows(part) {
  const dec = (node) => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(dec);
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === REF) { const target = part.blobs[node[REF]]; if (target === undefined) throw new Error('missing shared blob'); return dec(target); }
    const out = {};
    for (const key of keys) out[key] = dec(node[key]);
    return out;
  };
  return part.rows.map(dec);
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function packBrainSnapshot(snapshot) {
  const core = { ...snapshot };
  const turns = core.turns ?? []; delete core.turns;
  const ledger = core.runtimeLedger?.records ?? [];
  core.runtimeLedger = { ...(core.runtimeLedger ?? {}) }; delete core.runtimeLedger.records;
  const seal = core.core?.contextSeal?.sealed ?? [];
  core.core = { ...(core.core ?? {}), contextSeal: { ...(core.core?.contextSeal ?? {}) } }; delete core.core.contextSeal.sealed;
  const parts = {};
  const layout = { version: 1, turns: 0, ledger: 0, seal: 0, sizes: CHUNK };
  chunks(turns, CHUNK.turns).forEach((rows, i) => { parts['brain.turns:' + pad(i)] = dedupeRows(rows); layout.turns += 1; });
  chunks(ledger, CHUNK.ledger).forEach((rows, i) => { parts['brain.ledger:' + pad(i)] = rows; layout.ledger += 1; });
  chunks(seal, CHUNK.seal).forEach((rows, i) => { parts['brain.seal:' + pad(i)] = rows; layout.seal += 1; });
  parts.brain = { kind: 'Area52NativeBrainSnapshotCore', layout, core };
  return parts;
}

export function unpackBrainSnapshot(parts) {
  const head = parts?.brain;
  if (!head) return null;
  // A snapshot stored as one piece (older/simple hosts) is returned as is.
  if (head.kind === 'Area52NativeBrainSnapshot') return head;
  if (head.kind !== 'Area52NativeBrainSnapshotCore') return null;
  const { layout, core } = head;
  const gather = (prefix, count) => {
    const rows = [];
    for (let i = 0; i < count; i += 1) {
      const part = parts[prefix + ':' + pad(i)];
      if (prefix === 'brain.turns' && part?.kind === 'Area52DedupedTurnRows') { try { rows.push(...inflateRows(part)); } catch { return null; } continue; }
      if (!Array.isArray(part)) return null;
      rows.push(...part);
    }
    return rows;
  };
  const turns = gather('brain.turns', layout.turns), ledger = gather('brain.ledger', layout.ledger), seal = gather('brain.seal', layout.seal);
  if (!turns || !ledger || !seal) return null;
  const snapshot = { ...core, turns };
  snapshot.runtimeLedger = { ...core.runtimeLedger, records: ledger };
  snapshot.core = { ...core.core, contextSeal: { ...core.core.contextSeal, sealed: seal } };
  return snapshot;
}
