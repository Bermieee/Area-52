// Lore temporal and conflict rules (audit D7), owner-approved shape:
//   R1 attribution: a source reporting X is not X being uncertain. Speaker/source is kept and the statement is classed as
//      OBSERVATION (direct perception), HEARSAY (relayed or asserted without an established basis) or SPECULATION (modal or
//      belief). Only HEARSAY and SPECULATION are unresolved; an observation is a source-attested claim.
//   R2 time: `at` and `claimAt` are validated coordinates {value, timeline, unit}. Missing, malformed or incompatible
//      (different timeline or unit) times are UNKNOWN and never compared.
//   R3 supersession: a later, non-hearsay claim replaces an earlier state only when entity identity, normalized property AND
//      temporal applicability all match (same timeline, comparable coordinates, the earlier claim as-of state). A reported
//      claim never settles anything.
//   R4 conflict: differing values conflict only for the same normalized single-valued property of the same entity while
//      their applicability provably overlaps. Change over time (superseded states) is not a contradiction. Unknown overlap
//      is not a conflict.
// Nothing here writes to a source, a seal or a Truth decision; the output is evidence for the Lore owner and Truth.
import { stableHash, stableStringify } from './lore-contracts.js';

export const TEMPORAL_RULES_REVISION = 'lore-temporal-rules-v1';
export const DEFAULT_TIME_UNIT = 'ORDER';

export const AttributionMode = Object.freeze({ OBSERVATION: 'OBSERVATION', HEARSAY: 'HEARSAY', SPECULATION: 'SPECULATION' });

// Properties with exactly one value at a time. A predicate not listed here has no conflict semantics (never invented).
const PROPERTY_TABLE = Object.freeze({
  state: { property: 'state', cardinality: 'ONE' },
  fate: { property: 'fate', cardinality: 'ONE' },
  location: { property: 'location', cardinality: 'ONE' },
  owner: { property: 'owner', cardinality: 'ONE' },
  possessor: { property: 'possessor', cardinality: 'ONE' },
});
export function normalizedProperty(predicate) {
  const row = PROPERTY_TABLE[String(predicate || '').toLowerCase()];
  return row ? { ...row } : { property: null, cardinality: null };
}

// ---------- R2 ----------
function asCoordinate(raw) {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) ? raw : null;
  if (typeof raw === 'string' && /^-?\d{1,15}$/.test(raw.trim())) return Number(raw.trim());
  return null;
}
export function readSourceTime(metadata = {}, { lorebookId = null } = {}) {
  const problems = [];
  const timeline = String(metadata.timeline ?? lorebookId ?? '') || null;
  const rawUnit = metadata.timeUnit == null ? DEFAULT_TIME_UNIT : String(metadata.timeUnit);
  const unit = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(rawUnit) ? rawUnit.toUpperCase() : null;
  if (unit === null) problems.push('TIME_UNIT_INVALID');
  const coordinate = (key) => {
    if (metadata[key] == null) return null;
    const value = asCoordinate(metadata[key]);
    if (value === null) { problems.push(key.toUpperCase() + '_INVALID'); return null; }
    if (!timeline || unit === null) { problems.push(key.toUpperCase() + '_UNANCHORED'); return null; }
    return { value, timeline, unit };
  };
  return { at: coordinate('at'), claimAt: coordinate('claimAt'), problems };
}
// -1, 0, 1, or 'UNKNOWN' when either time is missing or the two are not on the same timeline and unit.
export function compareTimes(a, b) {
  if (!a || !b || a.timeline !== b.timeline || a.unit !== b.unit) return 'UNKNOWN';
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

// ---------- R1 ----------
const SPEAKER = '(.{1,60}?)';
const HEARSAY_VERBS = 'claims?|claimed|says?|said|reports?|reported|states?|stated|writes|wrote|alleges?|alleged|heard|told|whispers?|whispered|rumou?rs?|rumou?red';
const OBSERVE_VERBS = 'saw|witnessed|observed|watched|noticed';
const SPECULATE_VERBS = 'suspects?|suspected|believes?|believed|guesses|guessed|speculates?|speculated|supposes?|supposed|thinks?|thought|fears?|feared|hopes?|hoped';
const cleanSpeaker = (text) => String(text || '').replace(/^(?:the|a|an)\s+/i, '').replace(/\s+/g, ' ').trim() || null;
export function parseAttribution(sentence) {
  const s = String(sentence || '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  let m;
  if ((m = s.match(/^according to (.+?),\s*(.+)$/i))) return { mode: AttributionMode.HEARSAY, speaker: cleanSpeaker(m[1]), marker: 'according to', clause: m[2] };
  if ((m = s.match(/^(?:rumou?r has it that|it is (?:said|rumou?red) that|people say(?: that)?|they say(?: that)?)\s+(.+)$/i))) return { mode: AttributionMode.HEARSAY, speaker: null, marker: 'rumour', clause: m[1] };
  if ((m = s.match(new RegExp('^' + SPEAKER + '\\s+(' + OBSERVE_VERBS + ')\\s+(?:that\\s+)?(.+)$', 'i')))) return { mode: AttributionMode.OBSERVATION, speaker: cleanSpeaker(m[1]), marker: m[2].toLowerCase(), clause: m[3] };
  if ((m = s.match(new RegExp('^' + SPEAKER + '\\s+(' + SPECULATE_VERBS + ')\\s+(?:that\\s+)?(.+)$', 'i')))) return { mode: AttributionMode.SPECULATION, speaker: cleanSpeaker(m[1]), marker: m[2].toLowerCase(), clause: m[3] };
  if ((m = s.match(new RegExp('^' + SPEAKER + '\\s+(' + HEARSAY_VERBS + ')\\s+(?:that\\s+)?(.+)$', 'i')))) return { mode: AttributionMode.HEARSAY, speaker: cleanSpeaker(m[1]), marker: m[2].toLowerCase(), clause: m[3] };
  if ((m = s.match(/^(.+?)\b(?:may|might|could|possibly|perhaps|probably)\b(.+)$/i))) return { mode: AttributionMode.SPECULATION, speaker: null, marker: 'modal', clause: (m[1] + m[2]).replace(/\s+/g, ' ').trim() };
  return null;
}
export const isUnresolvedAttribution = (attribution) => attribution?.mode === AttributionMode.HEARSAY || attribution?.mode === AttributionMode.SPECULATION;

// ---------- clause grammar (structured, not keyword flags) ----------
const REMOVE = '(?:removed|taken|took|moved|carried off|carried away)';
const STEAL = '(?:stolen|stole)';
const DESTROY = '(?:destroyed|burned|burnt|ruined)';
const lemma = (verb) => (new RegExp('^' + STEAL + '$', 'i').test(verb) ? 'stolen' : new RegExp('^' + REMOVE + '$', 'i').test(verb) ? 'removed' : 'destroyed');
const eventSlug = (text) => String(text || '').toLowerCase().replace(/^(?:the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || null;
const ADV = '(?:shortly |just |long |right )?';
const AUX = '(was|were|had been|(?:may|might|could|must) have been)';
const isModal = (aux) => /^(?:may|might|could|must)\b/i.test(aux || '');
// Returns {subject, predicate, value, applicability, qualifier} or null. `subject` is a raw name for the caller to resolve.
export function analyzeClause(clause) {
  const s = String(clause || '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  let m;
  const eventFate = (subject, value, event, relation, agent = null) => ({ subject, predicate: 'fate', value, applicability: { kind: 'FROM_EVENT', event, relation }, qualifier: agent ? { agent } : null });
  // "<actor> removed the X shortly before the fire" / "someone took the X after the raid"
  if ((m = s.match(new RegExp('^(?:(.+?)\\s+)?(' + REMOVE + '|' + STEAL + ')\\s+(?:the\\s+)?(.+?)\\s+' + ADV + '(before|after|during)\\s+(?:the\\s+)?(.+)$', 'i')))) {
    const event = eventSlug(m[5]);
    if (event) return eventFate(m[3], lemma(m[2]) + '-' + m[4].toLowerCase() + '-' + event, event, m[4].toLowerCase(), /^(?:someone|somebody|a\s+\w+)$/i.test(m[1] || '') || !m[1] ? null : m[1]);
  }
  // "the X was removed shortly before the fire"
  if ((m = s.match(new RegExp('^(?:the\\s+)?(.+?)\\s+' + AUX + '\\s+(' + REMOVE + '|' + STEAL + ')\\s+' + ADV + '(before|after|during)\\s+(?:the\\s+)?(.+)$', 'i')))) {
    const event = eventSlug(m[5]);
    if (event) return { ...eventFate(m[1], lemma(m[3]) + '-' + m[4].toLowerCase() + '-' + event, event, m[4].toLowerCase()), modal: isModal(m[2]) };
  }
  // "the X is/was destroyed in the fire"
  if ((m = s.match(new RegExp('^(?:the\\s+)?(.+?)\\s+(?:(is|was|were|had been|(?:may|might|could|must) have been)\\s+)?' + DESTROY + '\\s+(in|during|by)\\s+(?:the\\s+)?(.+)$', 'i')))) {
    const event = eventSlug(m[4]);
    if (event) return { ...eventFate(m[1], 'destroyed-' + m[3].toLowerCase() + '-' + event, event, m[3].toLowerCase()), modal: isModal(m[2]) };
  }
  // "the X survived the fire"
  if ((m = s.match(/^(?:the\s+)?(.+?)\s+survived\s+(?:the\s+)?(.+)$/i))) {
    const event = eventSlug(m[2]);
    if (event) return eventFate(m[1], 'survived-' + event, event, 'through');
  }
  // "the X burns down" / "burned down": a state change of X at the source's own time
  if ((m = s.match(/^(?:the\s+)?(.+?)\s+(?:burns|burned|burnt)\s+down$/i))) return { subject: m[1], predicate: 'state', value: 'destroyed', applicability: { kind: 'AS_OF' }, qualifier: null };
  return null;
}

// ---------- R3 / R4: cross-source resolution ----------
const isReported = (claim) => isUnresolvedAttribution(claim.payload?.attribution);
function coordOf(claim) { return claim.payload?.sourceTime?.at ?? null; }
function identityKey(claim, canonical) { const id = claim.payload?.subjectId; return canonical.get(id) ?? id; }

// Unambiguous alias identity: entity E is the same as E' when E's canonical name is an alias of exactly one other entity.
export function buildIdentityMap(entities = []) {
  const byAlias = new Map(), canonicalName = new Map();
  for (const e of entities) {
    const id = e.payload?.entityId; if (!id) continue;
    canonicalName.set(id, String(e.payload.canonicalName || '').toLowerCase());
    for (const alias of e.payload.aliases || []) { const k = String(alias).toLowerCase(); if (!byAlias.has(k)) byAlias.set(k, new Set()); byAlias.get(k).add(id); }
  }
  const map = new Map();
  for (const [id, name] of canonicalName) {
    const owners = [...(byAlias.get(name) || [])].filter((other) => other !== id);
    if (owners.length === 1 && (byAlias.get(name)?.size ?? 0) === 2) map.set(id, owners[0]);
  }
  return map;
}

// E1 (event identity, proposed addition to R3/R4): two event names denote the same event when their slugs are equal, or when
// one is the whole-token suffix of the other ("fire" and "ember-tavern-fire": "the fire" after "the Ember Tavern fire").
// Different modifiers ("ember-tavern-fire" and "river-district-fire") never match. Anything else is UNKNOWN, not a conflict.
export function sameEvent(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split('-'), tb = b.split('-');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((token, i) => token === long[long.length - short.length + i]);
}

function applicabilityOverlap(a, b, supersededIds) {
  const pa = a.payload?.applicability, pb = b.payload?.applicability;
  if (!pa || !pb) return 'UNKNOWN';
  if (pa.kind === 'FROM_EVENT' && pb.kind === 'FROM_EVENT') return sameEvent(pa.event, pb.event) ? 'YES' : 'UNKNOWN';
  if (pa.kind === 'AS_OF' && pb.kind === 'AS_OF') {
    if (isReported(a) || isReported(b)) return 'UNKNOWN';
    if (supersededIds.has(a.id) || supersededIds.has(b.id)) return 'NO';
    return compareTimes(coordOf(a), coordOf(b)) === 0 ? 'YES' : 'UNKNOWN';
  }
  return 'UNKNOWN';
}

// claims: current CLAIM artifacts. entities: current ENTITY artifacts (identity aliases).
// -> { superseded: Map(id -> {by, property, reason}), conflicts: [LoreConflictSet], unknownOverlaps: n, revision }
// Scope: two claims interact (supersede, conflict) only when `coScoped(bookA, bookB)` says their lorebooks are read together;
// by default only claims of the same lorebook interact, so unrelated stories never affect each other.
export function resolveLoreTemporal({ claims = [], entities = [], scopeOf = (claim) => claim.payload?.sourceTime?.at?.timeline ?? claim.sourceId, coScoped = (a, b) => a === b } = {}) {
  const canonical = buildIdentityMap(entities);
  const groups = new Map();
  for (const claim of claims) {
    const p = claim.payload || {};
    const prop = p.property ? { property: p.property, cardinality: p.cardinality } : normalizedProperty(p.predicate);
    if (!prop.property || prop.cardinality !== 'ONE' || !p.applicability) continue;
    const key = identityKey(claim, canonical) + '|' + prop.property;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(claim);
  }
  const superseded = new Map(), conflicts = [];
  let unknownOverlaps = 0;
  for (const [key, rows] of [...groups.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    // R3: as-of state claims, non-hearsay, same timeline: an earlier one ends when a later one with a different value exists.
    const states = rows.filter((c) => c.payload.applicability.kind === 'AS_OF' && !isReported(c) && coordOf(c));
    for (const earlier of states) {
      const later = states.filter((c) => c.id !== earlier.id && coScoped(scopeOf(earlier), scopeOf(c)) && compareTimes(coordOf(earlier), coordOf(c)) === -1
        && stableStringify(c.payload.value) !== stableStringify(earlier.payload.value));
      if (later.length) {
        later.sort((x, y) => coordOf(x).value - coordOf(y).value);
        superseded.set(earlier.id, { by: later[0].id, property: key.split('|').pop(), reason: 'LATER_SAME_ENTITY_PROPERTY_TIMELINE' });
      }
    }
    // R4: differing values with provably overlapping applicability form conflict components.
    const parent = new Map(rows.map((c) => [c.id, c.id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const linked = new Set();
    for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i], b = rows[j];
      if (stableStringify(a.payload.value) === stableStringify(b.payload.value)) continue;
      if (!coScoped(scopeOf(a), scopeOf(b))) continue;
      const overlap = applicabilityOverlap(a, b, new Set(superseded.keys()));
      if (overlap === 'UNKNOWN') { unknownOverlaps += 1; continue; }
      if (overlap === 'YES') { parent.set(find(a.id), find(b.id)); linked.add(a.id); linked.add(b.id); }
    }
    const comps = new Map();
    for (const c of rows) if (linked.has(c.id)) { const r = find(c.id); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(c); }
    for (const members of comps.values()) {
      const values = [...new Set(members.map((c) => stableStringify(c.payload.value)))].sort();
      conflicts.push({
        kind: 'LoreConflictSet',
        id: 'conflict:' + stableHash(key + '|' + values.join('|')),
        slotKey: key,
        property: key.split('|').pop(),
        artifactIds: members.map((c) => c.id).sort(),
        semanticIds: members.map((c) => c.semanticId).sort(),
        values: members.map((c) => ({ artifactId: c.id, value: c.payload.value, attribution: c.payload.attribution?.mode ?? 'ASSERTED', speaker: c.payload.attribution?.speaker ?? null })).sort((x, y) => x.artifactId.localeCompare(y.artifactId)),
        status: 'UNRESOLVED',
        authorityClass: 'UNRESOLVED',
        basis: 'SAME_ENTITY_PROPERTY_OVERLAPPING_APPLICABILITY',
      });
    }
  }
  conflicts.sort((a, b) => a.id.localeCompare(b.id));
  const conflictedIds = new Set(conflicts.flatMap((row) => row.artifactIds));
  return { kind: 'LoreTemporalResolution', revision: TEMPORAL_RULES_REVISION, superseded, conflicts, conflictedIds, unknownOverlaps, groupCount: groups.size };
}
