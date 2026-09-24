import {FrameworkFailureCode} from './framework-contracts.js';
import {clone} from './framework-utils.js';
export class CognitiveServiceConformanceKit{
  constructor({framework,isCurrentRevision=()=>true}={}){this.framework=framework;this.isCurrentRevision=isCurrentRevision;}
  checkResult(serviceId,result={}){
    const failures=[];const semantic=result.semantic!==false;
    if(semantic&&(!result.provenance||typeof result.provenance!=='object'))failures.push({code:FrameworkFailureCode.MISSING_PROVENANCE});
    const revisions=result.sourceRevisionIds??result.provenance?.sourceRevisionIds??[];if(revisions.some(id=>!this.isCurrentRevision(id)))failures.push({code:FrameworkFailureCode.STALE_RESULT});
    if(result.directPromptInjection)failures.push({code:FrameworkFailureCode.CONTEXT_SEAL_REQUIRED});
    if(result.directCanonicalMutation)failures.push({code:FrameworkFailureCode.SETTLEMENT_REQUIRED});
    if(result.requestedAuthority){const auth=this.framework.services.authorize(serviceId,result.requestedAuthority);if(!auth.allowed)failures.push({code:auth.code??FrameworkFailureCode.UNDECLARED_AUTHORITY});}
    const route=this.framework.services.routeResult(serviceId,result);if(result.destination==='FOREGROUND'&&!route.foregroundAllowed)failures.push({code:FrameworkFailureCode.LIFECYCLE_AUTHORITY_BLOCKED});
    return{pass:failures.length===0,failures,route};
  }
  run({serviceId,artifactSamples=[],eventSamples=[],resultSamples=[],requireDiagnostics=true}={}){
    const info=this.framework.services.inspect(serviceId);const checks=[];if(!info)return{pass:false,failures:[{code:'UNKNOWN_SERVICE'}],checks:[]};
    checks.push({name:'manifest-valid',pass:true});
    for(const artifact of artifactSamples){const r=this.framework.artifacts.validateEnvelope(artifact);checks.push({name:`artifact:${artifact.artifactId??'unknown'}`,pass:r.ok,code:r.code??null});}
    for(const event of eventSamples){const r=this.framework.events.validate(event);checks.push({name:`event:${event.eventId??'unknown'}`,pass:r.ok,code:r.code??null});if(r.ok){this.framework.events.accept(event);const duplicate=this.framework.events.accept(event);checks.push({name:`event-idempotence:${event.eventId}`,pass:duplicate.ok&&duplicate.duplicate===true,code:duplicate.ok&&duplicate.duplicate===true?null:'EVENT_IDEMPOTENCE_FAILED'});}}
    for(const [i,result] of resultSamples.entries()){const r=this.checkResult(serviceId,result);checks.push({name:`result:${i}`,pass:r.pass,code:r.failures[0]?.code??null,failures:r.failures});}
    const deps=info.dependencies;checks.push({name:'dependencies',pass:deps.missingRequired.length===0,code:deps.missingRequired.length?FrameworkFailureCode.DEPENDENCY_REQUIRED_MISSING:null});
    checks.push({name:'optional-degradation-declared',pass:!deps.degraded||deps.missingRequired.length===0});
    const manifest=info.manifest;checks.push({name:'rebuild-recovery-declared',pass:Boolean(manifest.failureBehavior?.rebuildStrategy||manifest.failureBehavior?.recovery||manifest.failureBehavior?.mode)});
    if(requireDiagnostics)checks.push({name:'diagnostics-available',pass:Boolean(Object.keys(manifest.diagnostics??{}).length||manifest.failureBehavior?.diagnostics)});
    const failures=checks.filter(x=>!x.pass).map(x=>({code:x.code??'CONFORMANCE_CHECK_FAILED',check:x.name}));return{pass:failures.length===0,serviceId,lifecycleState:manifest.lifecycleState,checks:clone(checks),failures};
  }
}
