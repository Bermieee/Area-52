import { Capability } from './constants.js';

export const JEV_CAPABILITY_MIGRATION = Object.freeze({
  changeClassification: Object.freeze({
    legacyResponsibility: 'Decision Core change classification',
    capability: Capability.CHANGE_CLASSIFICATION,
    authority: 'ADVISORY',
  }),
  semanticJudgment: Object.freeze({
    legacyResponsibility: 'Decision Core semantic judgment',
    capability: Capability.SEMANTIC_JUDGMENT,
    authority: 'ADVISORY',
  }),
  proposalReview: Object.freeze({
    legacyResponsibility: 'Decision Core proposal review',
    capability: Capability.PROPOSAL_REVIEW,
    authority: 'ADVISORY',
  }),
  conflictInterpretation: Object.freeze({
    legacyResponsibility: 'Decision Core conflict interpretation',
    capability: Capability.CONFLICT_INTERPRETATION,
    authority: 'ADVISORY',
  }),
  truthJudgment: Object.freeze({
    legacyResponsibility: 'Decision Core truth judgment',
    capability: Capability.TRUTH_JUDGMENT,
    authority: 'ADVISORY',
  }),
});

export function jevCapabilityRequests() {
  return Object.values(JEV_CAPABILITY_MIGRATION).map((entry) => entry.capability);
}

export function assertAdvisoryJevMapping() {
  return Object.values(JEV_CAPABILITY_MIGRATION).every((entry) => entry.authority === 'ADVISORY');
}
