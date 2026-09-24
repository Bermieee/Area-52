import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {Area52CognitiveCore} from '../src/cognitive-core.js';

const host=(S,activity,id,content='',extra={})=>{const r=extra.messageRevision??1;return{activity,chatId:'stress',hostEventId:extra.hostEventId??`host:${id}:${activity}:r${r}`,messageId:extra.messageId??id,messageRevision:r,turnId:extra.turnId??`turn:${id}:${r}`,content,...extra};};
const fs=(S,value,revision,evidence,observationClass=S.ObservationClass.OBSERVED,confidence=1)=>S.createFieldState({value,revision,evidenceRefs:[evidence],observationClass,confidence});
async function loadScene(){const root=process.env.AREA52_SCENE_REF_ROOT;if(!root)throw new Error('AREA52_SCENE_REF_ROOT required');return import(pathToFileURL(path.join(root,'src/scene/index.js')).href);}
function rig(S){const timeline=[];let seq=0;const publisher=new S.SceneEventPublisher({sink:value=>timeline.push({seq:++seq,type:'event',value})}),contextInvalidationPublisher=new S.SceneContextInvalidationPublisher({sink:value=>timeline.push({seq:++seq,type:'invalidation',value})}),rt=new S.SceneLifecycleRuntime({publisher,contextInvalidationPublisher});return{rt,timeline,cursor:0};}
function core(){const c=new Area52CognitiveCore();c.activateHotCognitionChat('stress');return c;}
function feed(c,r){const receipts=[];for(;r.cursor<r.timeline.length;r.cursor++){const x=r.timeline[r.cursor];receipts.push(x.type==='event'?c.consumeCognitiveEvent(x.value):c.consumeSceneContextInvalidation(x.value));}const signal=r.rt.integrationSignal('stress');if(signal)receipts.push(c.consumeSceneSignal(signal));return{signal,receipts};}
function pub(c,i,previousPlan=null){const p=c.publishGenerationContext({turnId:`turn:stress:${i}`,correlationId:`corr:stress:${i}`,query:'Continue the current scene.',intent:'CURRENT',anchorEntityIds:[],sealedAt:1000+i}),d=c.deliverGenerationContext({published:p,generationId:`gen:stress:${i}`,modelProfileId:'RECENCY_WEIGHTED',userInput:'Continue the current scene.',previousPlan});return{p,d};}

export async function runFt002Wave10NativeSceneStress(){
 const S=await loadScene(),r=rig(S),c=core(),counts={sameSceneTurns:0,falseBoundaries:0,trueTransitions:0,castChurn:0,mentionedOnly:0,timeShifts:0,duplicates:0,stale:0,corrections:0,flashbackResumeCycles:0,promptPlans:0,hotOnly:0,retrievalTurns:0,reusedSegments:0,rebuiltSegments:0},failures=[];
 let priorPlan=null,turn=0;
 r.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'init','Mara begins in the hall.'),{extract:(e,s)=>({fields:{location:fs(S,{location:'Hall'},s.revision+1,e.sourceRevisionId),activeCast:fs(S,[{characterId:'Mara',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]}],s.revision+1,e.sourceRevisionId)}})});feed(c,r);let out=pub(c,++turn,priorPlan);priorPlan=out.d.plan;

 for(let i=1;i<=20;i++){
  const mentioned=i%2===0?[{characterId:'Eris',state:S.CastPresence.MENTIONED_ONLY,evidenceRefs:[`stress:${i}`]}]:[];
  r.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'stable'+i,`Same scene ${i}.`),{extract:(e,s)=>({fields:{activeThreads:fs(S,[`thread:${i%3}`],s.revision+1,e.sourceRevisionId),activeCast:fs(S,[{characterId:'Mara',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]},...mentioned],s.revision+1,e.sourceRevisionId),...(i%4===0?{narrativeTime:fs(S,{anchor:`tick:${i}`,mode:'CONTINUOUS'},s.revision+1,e.sourceRevisionId)}:{})},...(i%5===0?{boundarySignals:{doorway:1}}:{})})});
  const before=r.rt.chatScenes.get('stress'),f=feed(c,r),after=r.rt.chatScenes.get('stress');out=pub(c,++turn,priorPlan);priorPlan=out.d.plan;counts.sameSceneTurns++;counts.promptPlans++;if(out.p.cognitiveChoiceReceipt.paths.includes('HOT_ONLY'))counts.hotOnly++;else counts.retrievalTurns++;counts.reusedSegments+=out.d.plan.diagnosticReceipt.reuse.noChange;counts.rebuiltSegments+=out.d.plan.diagnosticReceipt.reuse.rebuild;
  if(i%5===0){counts.falseBoundaries++;if(before!==after)failures.push('false doorway boundary cut scene at '+i);}
  if(i%2===0){counts.mentionedOnly++;if(c.sceneIntegrationSnapshot().activeAnchorIds.includes('Eris'))failures.push('mentioned-only activated at '+i);}
  if(i%4===0)counts.timeShifts++;
  const dup=c.consumeSceneSignal(f.signal);counts.duplicates++;if(dup.status!=='DUPLICATE')failures.push('signal duplicate not idempotent '+i);
 }

 for(let i=1;i<=4;i++){
  const oldScene=r.rt.chatScenes.get('stress');
  r.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'transition'+i,`Move to room ${i}.`),{extract:(e,s)=>({fields:{location:fs(S,{location:`Room ${i}`},s.revision+1,e.sourceRevisionId)},boundarySignals:{locationTransition:1,explicitBreak:1},allowWhenRefreshRequired:true})});feed(c,r);out=pub(c,++turn,priorPlan);priorPlan=out.d.plan;counts.trueTransitions++;counts.retrievalTurns++;if(r.rt.chatScenes.get('stress')===oldScene)failures.push('true transition failed '+i);
  r.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'hydrate'+i,`Inside room ${i}; Eris ${i%2?'enters':'leaves'}.`),{extract:(e,s)=>({fields:{location:fs(S,{location:`Room ${i}`},s.revision+1,e.sourceRevisionId),activeCast:fs(S,i%2?[{characterId:'Mara',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]},{characterId:'Eris',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]}]:[{characterId:'Mara',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]}],s.revision+1,e.sourceRevisionId)}})});feed(c,r);counts.castChurn++;
 }

 for(let i=1;i<=4;i++){
  r.rt.ingestHostEvent(host(S,S.HostActivity.ASSISTANT_GENERATION_COMPLETE,'corr'+i,'Wrong place.'),{extract:(e,s)=>({fields:{location:fs(S,{location:'Wrong'},s.revision+1,e.sourceRevisionId,S.ObservationClass.INFERRED,.5)}})});const old=feed(c,r).signal;
  r.rt.ingestHostEvent(host(S,S.HostActivity.REGENERATE,'corr'+i,'Correct place.',{messageRevision:2}),{extract:(e,s)=>({fields:{location:fs(S,{location:'Correct'},s.revision+1,e.sourceRevisionId)}})});feed(c,r);const stale=c.consumeSceneSignal(old);counts.corrections++;counts.stale++;if(stale.status!=='STALE'||c.sceneIntegrationSnapshot().location.location!=='Correct')failures.push('correction stale fence '+i);
 }

 for(let i=1;i<=2;i++){
  const present=r.rt.chatScenes.get('stress');
  r.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'flash'+i,'Years earlier...'),{extract:(e,s)=>({fields:{narrativeTime:fs(S,{mode:'FLASHBACK',anchor:`past:${i}`},s.revision+1,e.sourceRevisionId)},boundarySignals:{flashback:1},relationship:S.SceneRelationship.FLASHBACK_OF})});feed(c,r);if(c.sceneIntegrationSnapshot().sceneRelationship!==S.SceneRelationship.FLASHBACK_OF)failures.push('flashback relation '+i);
  r.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'resume'+i,'Return to present.'),{extract:(e,s)=>({fields:{activeThreads:fs(S,['resume'],s.revision+1,e.sourceRevisionId)},boundarySignals:{explicitBreak:1},relationship:S.SceneRelationship.RESUMES,resumeSceneId:present})});feed(c,r);counts.flashbackResumeCycles++;if(r.rt.chatScenes.get('stress')!==present||c.sceneIntegrationSnapshot().sceneRelationship!==S.SceneRelationship.RESUMES)failures.push('resume relation '+i);
 }

 const state=c.sceneIntegrationSnapshot(),diag=c.sceneIntegrationDiagnostics();
 const invariants={sameSceneBounded:counts.sameSceneTurns===20,falseBoundariesContained:counts.falseBoundaries===4,mentionedOnlyNeverActive:failures.every(x=>!x.includes('mentioned-only')),trueTransitionsObserved:counts.trueTransitions===4,castChurnObserved:counts.castChurn===4,timeShiftObserved:counts.timeShifts===5,duplicatesIdempotent:failures.every(x=>!x.includes('duplicate')),staleCorrectionsFenced:counts.stale===4&&failures.every(x=>!x.includes('correction')),flashbackResumePreserved:counts.flashbackResumeCycles===2&&failures.every(x=>!x.includes('flashback')&&!x.includes('resume')),cacheAware:counts.promptPlans===20&&counts.reusedSegments>0&&counts.rebuiltSegments>0,boundedDiagnostics:(diag.recentReceipts?.length??0)<=32,noAuthority:state.canonicalMutationAuthority===false&&state.settlementAuthority===false&&state.contextSealBypass===false};
 return{pass:failures.length===0&&Object.values(invariants).every(Boolean),counts,invariants,failures,finalState:state};
}
