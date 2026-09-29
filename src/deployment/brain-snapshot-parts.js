// Splits a Native Brain snapshot into storage parts so a checkpoint writes only what changed.
//
// The three arrays that grow with the story (turn records, Work Ledger records, Context Seal entries) are cut into
// fixed-size chunks; every chunk is its own part. The storage adapter reuses a part whose checksum is unchanged, so a
// settled prefix is never rewritten and a checkpoint costs roughly the changed tail plus the small core part.
// `unpackBrainSnapshot` is the exact inverse (asserted by tests); a missing chunk makes the whole story unusable
// (returns null) rather than restoring a torn Brain.
const CHUNK = { turns: 1, ledger: 16, seal: 16 };
const pad = (n) => String(n).padStart(5, '0');

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
  chunks(turns, CHUNK.turns).forEach((rows, i) => { parts['brain.turns:' + pad(i)] = rows; layout.turns += 1; });
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
