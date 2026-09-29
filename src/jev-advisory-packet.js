// Next-turn prompt consumption of a Jev advisory (audit D11, owner direction 2026-09-29).
//
// Path: the advisory was requested through the Runtime for an ESTABLISHED Lore conflict set, admitted by the Lore owner's
// review (status ADVISED), and is looked up by the choice controller on a later turn that the same conflict shapes. Here it
// is attached to THAT later turn's packet, before its seal, as a separate `advisories` row:
//   - never a claim, never in current / historical / unresolved / relevantLore; authority ADVISORY, canonical false;
//   - attached only when every member source revision of the conflict set is already evidence in this packet, so the note
//     sits next to the alternatives it is about (and the integrity guard's revision fence covers it);
//   - the caller re-checks freshness immediately before attaching; a stale advisory is not attached;
//   - an earlier turn's seal is never touched (this changes only the packet being built).
// The planner renders it inside the documented UNRESOLVED_EVIDENCE slot (PROMPT_SLOT_CONTRACT: sealed-packet source only).
import { stableHash } from './browser-runtime-utils.js';

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const uniq = (list) => [...new Set(list)];
export const JEV_ADVISORY_NOTE = 'ADVISORY ONLY (Jev assessment reviewed by the Lore owner): not a fact and not a resolution. The related accounts remain unresolved; do not treat either as settled because of this note.';

export function attachJevAdvisoryToPacket(packet, advisory) {
  const fence = uniq(advisory?.sourceRevisionSet ?? []).sort();
  if (!advisory?.id || !fence.length || advisory.authorityGranted === true || advisory.canonicalMutation === true) return { packet: clone(packet), attached: false, reason: 'ADVISORY_INVALID' };
  const provenance = packet.provenanceIndex ?? {};
  const rows = ['current', 'historical', 'unresolved', 'relevantLore', 'episodicMemory'].flatMap((field) => (packet[field] ?? []).map((row) => row));
  const covered = new Set(rows.flatMap((row) => provenance[row.id] ?? []));
  if (!fence.every((ref) => covered.has(ref))) return { packet: clone(packet), attached: false, reason: 'ADVISORY_MEMBERS_NOT_IN_PACKET' };
  const relatesTo = rows.filter((row) => (provenance[row.id] ?? []).some((ref) => fence.includes(ref))).map((row) => row.id).sort();
  const id = 'jev-advisory-note:' + stableHash({ advisoryId: advisory.id, fence }, { length: 20 });
  const row = {
    id, kind: 'JevAdvisoryNote', e: 'jev-advisory', p: String(advisory.conflictSetId), v: String(advisory.classification ?? 'UNCLASSIFIED'),
    a: 'ADVISORY', t: [null, null, 'UNRESOLVED'], advisoryOnly: true, canonical: false, note: JEV_ADVISORY_NOTE,
    classification: advisory.classification ?? null, conflictSetId: String(advisory.conflictSetId), advisoryId: String(advisory.id),
    sourceTurnId: advisory.sourceTurnId ?? null, ownerReview: advisory.status ?? null, relatesTo, destination: 'NEXT_TURN',
  };
  const next = clone(packet);
  next.advisories = [row];
  next.provenanceIndex = { ...(next.provenanceIndex ?? {}), [id]: fence };
  next.dependencies = uniq([...(next.dependencies ?? []), ...fence]).sort();
  next.id = String(packet.id) + ':advisory:' + stableHash({ id, fence }, { length: 16 });
  return { packet: next, attached: true, row: clone(row) };
}
