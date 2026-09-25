import { DeliveryStatus } from './adaptive-context-contracts.js';
import { PromptPlanner } from './prompt-planner.js';
import { ModelAdapterRegistry } from './model-adapters.js';
import { CorePresentationRouter,createCorePromptDeliveryReceipt,attachObservedHostPromptEvidence,promptDeliveryIntegrationContract } from './prompt-presentation.js';
export { PromptSlotRegistry,ModelProfileRegistry } from './adaptive-context-slots.js';
export { DeterministicApproxTokenEstimator,AdaptiveBudgetAllocator } from './adaptive-context-budget.js';
export { PromptIntegrityGuard } from './prompt-integrity-guard.js';
export { ModelAdapterRegistry } from './model-adapters.js';
export { DeliveryLearningEngine,DeliveryPolicyStatus,DeliveryEvidenceState,feedbackMetricsFromBenchmark } from './delivery-learning.js';
export { CorePresentationRouter,createCorePromptDeliveryReceipt,attachObservedHostPromptEvidence,promptDeliveryIntegrationContract } from './prompt-presentation.js';

export class ContextDeliveryEngine extends PromptPlanner{
  constructor(options={}){super(options);this.adapterRegistry=options.adapterRegistry??new ModelAdapterRegistry();this.presentationRouter=options.presentationRouter??new CorePresentationRouter({profileRegistry:this.profileRegistry});}
  render({plan,profile=null,adapterOverride=null}){
    if(!plan)throw new TypeError('plan is required');const resolvedProfile=profile??this.profileRegistry.get(plan.modelProfileId);if(!resolvedProfile)return{ok:false,status:DeliveryStatus.PROFILE_UNAVAILABLE,failure:{code:'MODEL_PROFILE_UNAVAILABLE'}};const adapter=adapterOverride??this.adapterRegistry.get(resolvedProfile.adapterId);if(!adapter)return{ok:false,status:DeliveryStatus.ADAPTER_FAILED,failure:{code:'MODEL_ADAPTER_UNAVAILABLE',adapterId:resolvedProfile.adapterId}};
    try{const rendered=adapter.render(plan),adapterIntegrityReceipt=this.integrityGuard.validateAdapter({plan,rendered});if(!adapterIntegrityReceipt.valid)return{ok:false,status:DeliveryStatus.INTEGRITY_REJECTED,failure:{code:'ADAPTER_SEMANTIC_MUTATION',violations:adapterIntegrityReceipt.violations},rendered,adapterIntegrityReceipt};return{ok:true,status:DeliveryStatus.READY,rendered:Object.freeze(rendered),adapterIntegrityReceipt};}
    catch(error){return{ok:false,status:DeliveryStatus.ADAPTER_FAILED,failure:{code:'MODEL_ADAPTER_THROW',message:String(error?.message??error)}};}
  }
  deliver(input){
    const routing=this.presentationRouter.resolve({
      modelProfileId:input?.modelProfileId??null,fallbackProfileId:input?.fallbackProfileId??null,providerId:input?.providerId??null,modelId:input?.modelId??null,
      routeId:input?.routeId??null,observedCacheBehavior:input?.observedCacheBehavior??null,
    });
    const plannerProfileId=routing.reason==='EXPLICIT_COMPATIBLE_FALLBACK'?(input?.modelProfileId??routing.selectedProfileId):routing.selectedProfileId;
    const planned=this.createPlan({...input,modelProfileId:plannerProfileId});
    if(!planned.ok)return{...planned,presentationRouting:routing};
    const rendered=this.render({plan:planned.plan,profile:planned.profile});
    if(!rendered.ok)return{...planned,...rendered,presentationRouting:routing,ok:false};
    const receipt=createCorePromptDeliveryReceipt({plan:planned.plan,rendered:rendered.rendered,routing});
    return{...planned,...rendered,presentationRouting:routing,receipt,ok:true,status:DeliveryStatus.READY};
  }
  attachObservedHostEvidence(receipt,evidence={}){return attachObservedHostPromptEvidence(receipt,evidence);}
  integrationContract(){return promptDeliveryIntegrationContract();}
}
export class AdaptiveContextRuntime extends ContextDeliveryEngine{}
