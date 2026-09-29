// Native-path Jev advisory (audit D11), owner-approved shape: Jev may ADVISE on genuinely unresolved alternatives.
//
// Genuine alternatives are the Lore owner's ESTABLISHED conflict sets (R4), not raw candidate counts. The request goes through
// the documented Runtime path (a NEARLINE obligation on the Work Ledger, executed by the Worker Director) to the documented
// TEMPORAL Jev adapter (`adjudicateJevForOwner`), which enforces the bounded request, the revision fence and the owner
// review contract. The result is a NEXT_TURN advisory:
//   - it never mutates the turn it was requested for (that turn is already sealed), any Context Seal, or Lore;
//   - it is admitted only while its fence is current: every member's source revision is still current and the same
//     conflict set (same members and values) still exists; a stale result is recorded as rejected, never applied;
//   - it does not resolve anything: the alternatives stay UNRESOLVED, the choice controller reports the advisory as
//     PRESERVE_UNRESOLVED with a result reference.
// Jev stays optional: nothing is requested unless the host attached a Jev service AND reports it configured.
import { JevDomain } from './coprocessor/jev-domain-adapter.js';
import { LoreJevDecisionKind, LoreReconciliationClassification } from './coprocessor/jev-lore-adapter.js';
import { adjudicateJevForOwner } from './coprocessor/owner-integration.js';
import { reviewLoreJevAdvisory } from './lore-jev-owner-review.js';
import { stableHash } from './browser-runtime-utils.js';

export const NATIVE_JEV_ADVISORY_LIMITS = Object.freeze({ maxSetsPerTurn: 2, maxMembersPerSet: 8, maxRows: 64, maxSummaryChars: 240 });
const FRESH_TOKEN = (setId) => 'temporal-advisory:' + setId;
// The Lore owner's review fences an advisory by the Lore revision it was made against. For a conflict advisory that revision
// is the conflict set (members, values) plus its member source revisions, so it moves exactly when the evidence moves.
const loreFence = (set) => stableHash(set.id + '|' + [...(set.sourceRevisionRefs ?? [])].sort().join(','));
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const uniq = (list) => [...new Set(list)];

export class NativeJevAdvisory {
  #service = null;
  #configured = () => false;
  #executionEvidence = null;

  constructor({ snapshot = null, limits = NATIVE_JEV_ADVISORY_LIMITS } = {}) {
    this.limits = { ...NATIVE_JEV_ADVISORY_LIMITS, ...limits };
    this.rows = new Map((snapshot?.rows ?? []).map((row) => [row.conflictSetId, clone(row)]));
    this.skipped = clone(snapshot?.skipped ?? []).slice(-32);
    this.sequence = Number(snapshot?.sequence ?? 0);
  }

  // The host supplies the Jev service (a JevDomainAdapterService), whether a Jev resource is actually configured, and
  // optionally the provider-execution evidence so a silent native fallback is never presented as Jev advice.
  attach({ service = null, isConfigured = () => true, executionEvidence = null } = {}) {
    if (service !== null && typeof service.adjudicate !== 'function') throw new TypeError('Jev advisory service requires adjudicate(input, options)');
    this.#service = service;
    this.#configured = typeof isConfigured === 'function' ? isConfigured : () => Boolean(isConfigured);
    this.#executionEvidence = typeof executionEvidence === 'function' ? executionEvidence : null;
    return { kind: 'NativeJevAdvisoryAttachReceipt', attached: Boolean(service), required: false, authorityGranted: false };
  }

  get available() {
    if (!this.#service) return false;
    try { return Boolean(this.#configured()); } catch { return false; }
  }

  // Conflict sets that shaped this turn's delivered Lore context and that still need advice.
  candidateSets({ loreInterface, record }) {
    if (!this.available || typeof loreInterface?.conflictSets !== 'function') return [];
    const delivered = new Set((record?.published?.candidates ?? []).flatMap((c) => c.sourceRevisionRefs ?? []));
    const out = [];
    let sets;
    try { sets = loreInterface.conflictSets({ chatId: record.chatId, certainty: 'ESTABLISHED' }) ?? []; } catch { return []; }
    for (const set of sets) {
      if (!set.sourceRevisionRefs.some((ref) => delivered.has(ref))) continue;
      if (set.members.length > this.limits.maxMembersPerSet || set.alternatives.length < 2) { this.#skip(set.id, set.members.length > this.limits.maxMembersPerSet ? 'TOO_MANY_MEMBERS' : 'NOT_TWO_ALTERNATIVES'); continue; }
      const standing = this.rows.get(set.id);
      if (standing && this.isFresh(standing, loreInterface)) continue; // already advised against this exact fence
      out.push(set);
      if (out.length >= this.limits.maxSetsPerTurn) break;
    }
    return out;
  }

  #skip(conflictSetId, reason) {
    if (!this.skipped.some((row) => row.conflictSetId === conflictSetId && row.reason === reason)) this.skipped.push({ conflictSetId, reason });
    while (this.skipped.length > 32) this.skipped.shift();
  }

  #buildInput({ set, record, now }) {
    const evidence = set.members.map((m) => ({
      evidenceId: 'conflict-member:' + m.claimId,
      sourceRef: m.sourceRevisionId,
      summary: `${set.property}: ${String(m.value)} (${m.attribution}${m.speaker ? ' by ' + m.speaker : ''})`.slice(0, this.limits.maxSummaryChars),
      provenanceRefs: [m.sourceRevisionId],
      revision: 1, available: true, stale: false,
    }));
    const refs = evidence.map((row) => row.evidenceId);
    const option = (optionId, label) => ({ optionId, label, evidenceRefs: refs, provenanceRefs: uniq(set.sourceRevisionRefs), payload: {} });
    return {
      domain: JevDomain.LORE,
      decisionKind: LoreJevDecisionKind.RECONCILIATION,
      decisionId: 'native-jev-advisory:' + set.id,
      turnId: String(record.turnId),
      taskId: 'task:native-jev-advisory:' + set.id,
      correlationId: String(record.correlationId),
      causationId: String(record.generationId ?? record.turnId),
      owner: 'LORE_OWNER',
      options: [
        option(LoreReconciliationClassification.CONTRADICTORY, 'A genuine contradiction'),
        option(LoreReconciliationClassification.TEMPORALLY_DISTINCT, 'Applies to different times or continuities'),
        option(LoreReconciliationClassification.COMPLEMENTARY, 'The accounts fit together'),
        option(LoreReconciliationClassification.UNRESOLVED, 'Keep unresolved'),
      ],
      evidence,
      provenanceRefs: uniq(set.sourceRevisionRefs),
      sourceRevisionSet: uniq(set.sourceRevisionRefs),
      worldRevision: 0, sceneRevision: 0, characterStateRevision: 0, ownerRevision: 0,
      loreRevision: loreFence(set),
      freshnessToken: FRESH_TOKEN(set.id),
      deadline: now + 5000, softDeadline: now + 3000, maxRetries: 0,
      adapterMetadata: { conflictSetId: set.id, property: set.property, alternatives: set.alternatives.map((alt) => alt.length) },
    };
  }

  // Current fence for one conflict set (used both by the Jev freshness check and by consumption).
  #currentState(set, loreInterface) {
    let current = null;
    try { current = (loreInterface.conflictSets({ chatId: set.chatId, certainty: 'ESTABLISHED' }) ?? []).find((row) => row.id === set.id) ?? null; } catch { current = null; }
    return {
      sourceRevisionSet: current ? uniq(current.sourceRevisionRefs) : [],
      worldRevision: 0, sceneRevision: 0, characterStateRevision: 0,
      domainRevisions: { lore: current ? loreFence(current) : 'GONE', owner: 0 },
      freshnessToken: FRESH_TOKEN(current ? current.id : 'GONE'),
    };
  }

  // Runs one advisory (called by the Runtime executor). Never throws; every outcome is a row.
  async run({ set, record, loreInterface }) {
    const base = {
      kind: 'NativeJevAdvisory',
      id: 'jev-advisory:' + stableHash(set.id + '|' + record.turnId),
      conflictSetId: set.id, property: set.property, chatId: record.chatId,
      sourceTurnId: record.turnId, sourceSealId: record.published?.sealReceipt?.id ?? null,
      memberClaimIds: set.members.map((m) => m.claimId).sort(),
      fence: { sourceRevisionSet: uniq(set.sourceRevisionRefs), conflictSetId: set.id, loreFence: loreFence(set) },
      destination: 'NEXT_TURN', appliesToTurnId: null,
      advisory: true, authorityGranted: false, canonicalMutation: false, settlementPerformed: false, contextSealMutated: false, loreMutated: false,
      sequence: ++this.sequence,
    };
    const finish = (status, extra = {}) => ({ ...base, status, classification: null, ownerDecision: null, reasonCode: null, providerEvidence: null, ...extra });
    if (!this.available) return finish('UNAVAILABLE', { reasonCode: 'JEV_NOT_CONFIGURED' });
    const sealBefore = record.published?.sealReceipt?.id ?? null;
    let admission;
    try {
      admission = await adjudicateJevForOwner({
        service: this.#service,
        input: this.#buildInput({ set: { ...set, chatId: record.chatId }, record, now: Date.now() }),
        currentRevisionState: () => this.#currentState({ ...set, chatId: record.chatId }, loreInterface),
        // The requested turn is already sealed and is never touched: the advisory targets the NEXT turn, and its own fence is
        // the freshness gate, so the post-seal rejection (which protects the current turn) does not apply.
        sealed: false,
        // The Lore owner decides admissibility of an advisory classification (documented owner boundary); it never mutates
        // Lore, Truth or a seal. Its revision oracle is the same conflict-set fence the request carried.
        ownerReview: async (proposal) => {
          const current = this.#currentState({ ...set, chatId: record.chatId }, loreInterface).domainRevisions.lore;
          return reviewLoreJevAdvisory(proposal, { currentLoreRevision: current === 'GONE' ? null : current });
        },
      });
    } catch (error) {
      return finish('FAILED', { reasonCode: String(error?.code ?? error?.message ?? 'JEV_ADVISORY_FAILED').slice(0, 120) });
    }
    // Re-check the fence at admission: nothing it depends on may have moved while Jev was running.
    const after = this.#currentState({ ...set, chatId: record.chatId }, loreInterface);
    const stillFresh = after.domainRevisions.lore === loreFence(set) && uniq(set.sourceRevisionRefs).every((ref) => after.sourceRevisionSet.includes(ref));
    if (record.published?.sealReceipt?.id !== sealBefore) return finish('REJECTED_SEAL_CHANGED', { reasonCode: 'SEAL_CHANGED_DURING_ADVISORY' });
    const proposal = admission?.proposal ?? null;
    const evidence = this.#executionEvidence?.(String(record.turnId)) ?? null;
    if (!stillFresh || admission?.status === 'REJECTED_STALE') return finish('REJECTED_STALE', { reasonCode: 'CONFLICT_SET_OR_SOURCE_REVISION_CHANGED', ownerDecision: admission?.ownerDecision ?? null });
    if (evidence && evidence.status !== 'LIVE_PROVIDER') {
      return finish('NOT_ADVISED_NO_LIVE_PROVIDER', { reasonCode: 'NO_LIVE_JEV_PROVIDER', providerEvidence: { status: evidence.status, fallbackUsed: Boolean(evidence.fallbackUsed) } });
    }
    const classification = proposal?.proposedOutcome ?? null;
    const advised = admission?.accepted === true && classification && classification !== LoreReconciliationClassification.UNRESOLVED;
    return finish(advised ? 'ADVISED' : 'UNRESOLVED', {
      classification, ownerDecision: admission?.ownerDecision ?? null, reasonCode: admission?.reasonCode ?? null,
      providerEvidence: evidence ? { status: evidence.status, fallbackUsed: Boolean(evidence.fallbackUsed) } : null,
    });
  }

  remember(row) {
    if (!row?.conflictSetId) return null;
    this.rows.set(row.conflictSetId, clone(row));
    while (this.rows.size > this.limits.maxRows) this.rows.delete(this.rows.keys().next().value);
    return row;
  }

  // An advisory is usable only while its own fence is current (same conflict set, all member revisions current) and it
  // reached a classification. Anything else is ignored, never applied.
  isFresh(row, loreInterface) {
    if (!row || !['ADVISED'].includes(row.status)) return false;
    const state = this.#currentState({ id: row.conflictSetId, chatId: row.chatId }, loreInterface);
    return state.domainRevisions.lore === row.fence.loreFence && row.fence.sourceRevisionSet.every((ref) => state.sourceRevisionSet.includes(ref));
  }

  // Choice-controller lookup (only consulted when the turn already has two or more unresolved alternatives): the standing
  // fresh advisory whose whole fence (every member's source revision) is covered by the delivered candidates.
  lookup(alternatives, { loreInterface, candidates = [] } = {}) {
    if (typeof loreInterface?.conflictSets !== 'function') return null;
    // The conflict set shaped this turn if all its member sources are among the delivered candidates (an asserted member is
    // not itself an unresolved alternative, so the alternatives alone would never cover it).
    const refs = new Set((candidates ?? []).flatMap((c) => c.sourceRevisionRefs ?? []));
    const claims = new Set((alternatives ?? []).flatMap((a) => a.claimIds ?? []));
    if (!refs.size && !claims.size) return null;
    for (const row of this.rows.values()) {
      const covered = row.fence.sourceRevisionSet.every((ref) => refs.has(ref)) || (claims.size > 0 && row.memberClaimIds.every((id) => claims.has(id)));
      if (covered && this.isFresh(row, loreInterface)) return clone(row);
    }
    return null;
  }

  list() { return [...this.rows.values()].map(clone); }
  snapshot() { return { kind: 'NativeJevAdvisorySnapshot', rows: this.list(), skipped: clone(this.skipped), sequence: this.sequence }; }
  diagnostics() {
    const counts = {};
    for (const row of this.rows.values()) counts[row.status] = (counts[row.status] ?? 0) + 1;
    return { kind: 'NativeJevAdvisoryDiagnostics', attached: Boolean(this.#service), configured: this.available, counts, skipped: clone(this.skipped), limits: { ...this.limits }, authorityGranted: false };
  }
}
