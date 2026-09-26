import { SettlementDecisionType } from './contracts.js';

const clone=(v)=>structuredClone(v);

export class SettlementBoundary {
  #policies=new Map();
  #audits=new Map();
  #sequence=0;

  constructor({registry,graph,worldStateSettlement,entityRegistry=null}){
    this.registry=registry;this.graph=graph;this.worldStateSettlement=worldStateSettlement;this.entityRegistry=entityRegistry;
    this.registerOwner('WORLD_STATE',{
      approval:'OPTIONAL',
      validate:(proposal)=>({ok:true,reason:'world-state owner policy accepted proposal shape'}),
      settle:(proposal)=>this.worldStateSettlement.settle(proposal),
    });
  }

  registerOwner(owner,{approval='OPTIONAL',validate=()=>({ok:true}),settle}={}){
    if(typeof owner!=='string'||!owner)throw new TypeError('owner must be a non-empty string');
    if(!['OPTIONAL','REQUIRED','NONE'].includes(approval))throw new TypeError('approval must be OPTIONAL, REQUIRED, or NONE');
    if(typeof settle!=='function')throw new TypeError('owner policy requires a settle function');
    this.#policies.set(owner,{approval,validate,settle});
    return this.ownerPolicy(owner);
  }

  ownerPolicy(owner){
    const policy=this.#policies.get(owner);
    return policy?{owner,approval:policy.approval,registered:true}:{owner,registered:false};
  }

  settle(proposal,{operatorApproved=false,judgmentMetadata=null}={}){
    const validation=this.#validateCommon(proposal);
    if(!validation.ok)return this.#reject(proposal,validation,judgmentMetadata);

    const policy=this.#policies.get(proposal.owner);
    if(!policy)return this.#reject(proposal,{ok:false,stage:'owner-policy',reason:`unsupported canonical owner: ${proposal.owner}`},judgmentMetadata);

    const ownerValidation=policy.validate(proposal);
    if(!ownerValidation?.ok)return this.#reject(proposal,{ok:false,stage:'owner-policy',reason:ownerValidation?.reason??'owner policy rejected proposal'},judgmentMetadata);

    if(policy.approval==='REQUIRED'&&!operatorApproved){
      const decision={
        kind:'SettlementDecision',
        id:`settlement-boundary-decision:${this.#sequence+1}:${proposal.id}`,
        proposalId:proposal.id,decision:SettlementDecisionType.UNRESOLVED,owner:proposal.owner,
        evidenceIds:[...(proposal.evidenceIds??[])],sourceRevisionIds:[...(proposal.sourceRevisionIds??[])],
        worldRevision:this.graph.revision,reason:'operator approval required before canonical mutation',
        consideredClaimIds:[],receiptId:null,
        diagnostics:{validation:[validation,ownerValidation],approvalState:'REQUIRED',judgmentMetadata},
      };
      return this.#record(proposal,{decision,receipt:null},validation,ownerValidation,judgmentMetadata,'PENDING_APPROVAL');
    }

    const settled=policy.settle(proposal);
    return this.#record(proposal,settled,validation,ownerValidation,judgmentMetadata,'COMPLETE');
  }

  #validateCommon(proposal){
    if(!proposal||typeof proposal!=='object')return{ok:false,stage:'schema',reason:'proposal is missing'};
    if(typeof proposal.id!=='string'||!proposal.id)return{ok:false,stage:'schema',reason:'proposal id is missing'};
    if(typeof proposal.owner!=='string'||!proposal.owner)return{ok:false,stage:'schema',reason:'proposal owner is missing'};
    if(!Array.isArray(proposal.evidenceIds)||!Array.isArray(proposal.sourceRevisionIds)||!Array.isArray(proposal.freshnessRevisionIds))return{ok:false,stage:'schema',reason:'proposal revision/evidence arrays are invalid'};
    if(proposal.evidenceIds.some(id=>!this.registry.isArtifactValid(id)))return{ok:false,stage:'evidence',reason:'proposal evidence is missing or invalid'};
    if(proposal.freshnessRevisionIds.some(id=>!this.registry.isActiveRevision(id)))return{ok:false,stage:'freshness',reason:'proposal source revision is stale'};
    const identityRevisionRefs=proposal.payload?.claim?.identityRevisionRefs??[];
    if(this.entityRegistry&&identityRevisionRefs.some(ref=>!this.entityRegistry.isCurrentRevisionRef(ref)))return{ok:false,stage:'identity-freshness',reason:'proposal identity revision is stale'};
    return{ok:true,stage:'common-validation',reason:'schema, evidence, source freshness, and identity freshness validation passed'};
  }

  #reject(proposal,validation,judgmentMetadata){
    const decision={
      kind:'SettlementDecision',id:`settlement-boundary-reject:${this.#sequence+1}:${proposal?.id??'unknown'}`,
      proposalId:proposal?.id??'unknown',decision:SettlementDecisionType.REJECT,owner:proposal?.owner??'UNREGISTERED',
      evidenceIds:[...(proposal?.evidenceIds??[])],sourceRevisionIds:[...(proposal?.sourceRevisionIds??[])],
      worldRevision:this.graph.revision,reason:validation.reason,consideredClaimIds:[],receiptId:null,
      diagnostics:{validation:[validation],approvalState:'NOT_EVALUATED',judgmentMetadata},
    };
    return this.#record(proposal??{id:'unknown',owner:'UNREGISTERED',evidenceIds:[],sourceRevisionIds:[]},{decision,receipt:null},validation,null,judgmentMetadata,'REJECTED');
  }

  #record(proposal,settled,validation,ownerValidation,judgmentMetadata,approvalState){
    this.#sequence+=1;
    const claim=proposal.payload?.claim??null,identityRevisionRefs=[...(claim?.identityRevisionRefs??[])];
    const decision={...clone(settled.decision),diagnostics:{
      ...(settled.decision?.diagnostics??{}),
      validation:[validation,...(ownerValidation?[ownerValidation]:[])],
      approvalState,
      judgmentMetadata,
      identityRevisionRefs,
    }};
    const base=settled.receipt;
    const audit={
      kind:'SettlementAuditReceipt',id:`settlement-audit:${this.#sequence}:${proposal.id}`,
      sequence:this.#sequence,proposalId:proposal.id,destinationOwner:proposal.owner,decision:decision.decision,
      evidenceIds:[...(proposal.evidenceIds??[])],sourceRevisionIds:[...(proposal.sourceRevisionIds??[])],identityRevisionRefs,
      worldRevision:this.graph.revision,authorityInformation:claim?{authorityClass:claim.authorityClass,confidence:claim.confidence}:null,
      temporalInformation:claim?.temporal?clone(claim.temporal):null,
      consideredConflicts:[...(decision.consideredClaimIds??[])],
      supersededArtifacts:[...(base?.supersededArtifactIds??[])],
      settledArtifacts:[...(base?.settledArtifactIds??[])],
      rejectionReason:decision.decision===SettlementDecisionType.REJECT?decision.reason:null,
      unresolvedReason:decision.decision===SettlementDecisionType.UNRESOLVED?decision.reason:null,
      validationResults:clone(decision.diagnostics?.validation??[]),
      judgmentMetadata:clone(judgmentMetadata),canonicalReceiptId:base?.id??null,approvalState,
    };
    this.#audits.set(audit.id,audit);
    return{decision,receipt:base?{...clone(base),auditReceiptId:audit.id}:null,audit:clone(audit)};
  }

  explain(auditId){const a=this.#audits.get(auditId);return a?clone(a):null;}
  audits(){return[...this.#audits.values()].map(clone);}
}
