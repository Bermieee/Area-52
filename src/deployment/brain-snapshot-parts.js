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
// Lossless shape encodings applied after the shared-subtree pass (all exactly reversible, asserted by tests):
//  - a homogeneous array of plain objects (same keys, same order, at least MIN_TABLE_ROWS) becomes {keys, rows}: the property
//    names are stored once instead of once per element;
//  - a string of at least MIN_STRING_LENGTH characters that occurs at least twice in the part becomes a reference into a
//    per-part string table.
// A record that already uses a reserved marker is stored verbatim (see dedupeRows).
const TABLE = '$area52Table';
const STRING_MARK = '\u0001';
const MIN_TABLE_ROWS = 3;
const MIN_STRING_LENGTH = 24;
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function encodeTables(node) {
  if (Array.isArray(node)) {
    if (node.length >= MIN_TABLE_ROWS && node.every(isPlain)) {
      const keys = Object.keys(node[0]);
      if (keys.length && node.every((row) => { const k = Object.keys(row); return k.length === keys.length && k.every((key, i) => key === keys[i]); })) {
        return { [TABLE]: { keys, rows: node.map((row) => keys.map((key) => encodeTables(row[key]))) } };
      }
    }
    return node.map(encodeTables);
  }
  if (isPlain(node)) { const out = {}; for (const [key, value] of Object.entries(node)) out[key] = encodeTables(value); return out; }
  return node;
}
function decodeTables(node) {
  if (Array.isArray(node)) return node.map(decodeTables);
  if (!isPlain(node)) return node;
  const keys = Object.keys(node);
  if (keys.length === 1 && keys[0] === TABLE) {
    const { keys: names, rows } = node[TABLE];
    if (!Array.isArray(names) || !Array.isArray(rows)) throw new Error('malformed table');
    return rows.map((row) => {
      if (!Array.isArray(row) || row.length !== names.length) throw new Error('malformed table row');
      const out = {}; names.forEach((name, i) => { out[name] = decodeTables(row[i]); }); return out; });
  }
  const out = {}; for (const key of keys) out[key] = decodeTables(node[key]);
  return out;
}
function encodeStrings(rows, blobs) {
  const counts = new Map();
  const count = (node) => {
    if (typeof node === 'string') { if (node.length >= MIN_STRING_LENGTH) counts.set(node, (counts.get(node) ?? 0) + 1); return; }
    if (Array.isArray(node)) { node.forEach(count); return; }
    if (isPlain(node)) Object.values(node).forEach(count);
  };
  count(rows); Object.values(blobs).forEach(count);
  const table = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] * b[0].length - a[1] * a[0].length).map(([text]) => text);
  if (!table.length) return { rows, blobs, strings: [] };
  const index = new Map(table.map((text, i) => [text, i]));
  const enc = (node) => {
    if (typeof node === 'string') return index.has(node) ? STRING_MARK + index.get(node).toString(36) : node;
    if (Array.isArray(node)) return node.map(enc);
    if (isPlain(node)) { const out = {}; for (const [key, value] of Object.entries(node)) out[key] = enc(value); return out; }
    return node;
  };
  const encBlobs = {}; for (const [hash, value] of Object.entries(blobs)) encBlobs[hash] = enc(value);
  return { rows: enc(rows), blobs: encBlobs, strings: table };
}
function decodeStrings(node, strings) {
  // Every marker string in a version-2 part is a reference (the encoder stores a record that already has one verbatim), so
  // a reference with no table entry is a torn part and throws, like a missing shared blob.
  const dec = (value) => {
    if (typeof value === 'string') {
      if (!value.startsWith(STRING_MARK)) return value;
      const text = strings[parseInt(value.slice(1), 36)];
      if (typeof text !== 'string') throw new Error('missing shared string');
      return text;
    }
    if (Array.isArray(value)) return value.map(dec);
    if (isPlain(value)) { const out = {}; for (const [key, item] of Object.entries(value)) out[key] = dec(item); return out; }
    return value;
  };
  return dec(node);
}

function dedupeRows(rows) {
  const raw = JSON.stringify(rows);
  // A reserved marker, or an own "__proto__" key (which plain assignment would turn into a prototype change on either
  // side of the round trip), is stored verbatim.
  if (raw.includes('"' + REF + '"') || raw.includes('"' + TABLE + '"') || raw.includes('"\\u0001') || raw.includes('"__proto__"')) return rows;
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
  const shaped = encodeStrings(encodeTables(encoded), Object.fromEntries(Object.entries(blobs).map(([hash, value]) => [hash, encodeTables(value)])));
  return { kind: 'Area52DedupedTurnRows', version: 2, rows: shaped.rows, blobs: shaped.blobs, strings: shaped.strings };
}
function inflateRows(input) {
  // Undo string references, then tables, then shared subtrees (the reverse of encoding).
  const strings = input.version === 2 ? input.strings : [];
  if (!Array.isArray(strings)) throw new Error('missing string table');
  const part = input.version === 2
    ? { rows: decodeTables(decodeStrings(input.rows, strings)), blobs: Object.fromEntries(Object.entries(input.blobs).map(([hash, value]) => [hash, decodeTables(decodeStrings(value, strings))])) }
    : input;
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
