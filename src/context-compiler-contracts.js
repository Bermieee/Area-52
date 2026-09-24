import {utf8ByteLength,stableJson} from './browser-runtime-utils.js';

const THREAD_STATUS=new Set(['ACTIVE','BLOCKED','PAUSED']);
const req=(v,n)=>{if(typeof v!=='string'||!v.length)throw new TypeError(`${n} must be a non-empty string`);return v;};
const strings=(v,n)=>{if(!Array.isArray(v)||v.some(x=>typeof x!=='string'))throw new TypeError(`${n} must be an array of strings`);return[...new Set(v)].sort();};
const optionalString=(v,n)=>v===null||v===undefined?null:req(v,n);

export function createActiveThread({threadId,subjectRefs=[],objective=null,unresolvedQuestion=null,status='ACTIVE',priority=5,sourceRevisionIds=[],sceneRevision=null,evidenceRefs=[]}={}){
  req(threadId,'ActiveThread.threadId');if(!THREAD_STATUS.has(status))throw new TypeError(`ActiveThread.status has unsupported value: ${status}`);
  const p=Number(priority);if(!Number.isFinite(p)||p<0||p>100)throw new TypeError('ActiveThread.priority must be 0..100');
  if(objective===null&&unresolvedQuestion===null)throw new TypeError('ActiveThread requires objective or unresolvedQuestion');
  return{kind:'ActiveThread',id:`active-thread:${threadId}`,threadId,subjectRefs:strings(subjectRefs,'ActiveThread.subjectRefs'),objective:optionalString(objective,'ActiveThread.objective'),unresolvedQuestion:optionalString(unresolvedQuestion,'ActiveThread.unresolvedQuestion'),status,priority:p,sourceRevisionIds:strings(sourceRevisionIds,'ActiveThread.sourceRevisionIds'),sceneRevision:sceneRevision===null||sceneRevision===undefined?null:Number(sceneRevision),evidenceRefs:strings(evidenceRefs,'ActiveThread.evidenceRefs'),authorityClass:'UNRESOLVED'};
}
export function normalizeActiveThreads(activeThreads,{isCurrentRevision=()=>true}={}){
  if(!Array.isArray(activeThreads))throw new TypeError('activeThreads must be an array');const admitted=[],staleThreadIds=[];
  for(const input of activeThreads){const thread=input?.kind==='ActiveThread'?createActiveThread(input):createActiveThread(input);const stale=thread.sourceRevisionIds.some(id=>!isCurrentRevision(id));if(stale){staleThreadIds.push(thread.threadId);continue;}admitted.push(thread);}
  admitted.sort((a,b)=>b.priority-a.priority||a.threadId.localeCompare(b.threadId));return{admitted,staleThreadIds:staleThreadIds.sort()};
}
function subjectOf(fact){return fact?.e??fact?.subjectId??null;}
export function semanticPriorityForFact(fact,section,activeThreads=[]){
  const base={unresolved:100,current:90,activeThreads:95,historical:45,relevantLore:30,background:10}[section]??20;let score=base;const reasons=[`BASE_${String(section).toUpperCase()}`];const subject=subjectOf(fact);
  if(section==='activeThreads'){score+=Number(fact.priority??0);reasons.push('ACTIVE_THREAD');}
  for(const thread of activeThreads){if(subject&&thread.subjectRefs.includes(subject)){const boost=Math.min(40,10+Math.floor(thread.priority/4));score+=boost;reasons.push(`THREAD_RELEVANCE:${thread.threadId}`);}}
  return{score,reasons:[...new Set(reasons)]};
}
export function buildSemanticPriority({current=[],historical=[],unresolved=[],activeThreads=[]}={}){
  const rows=[];for(const [section,values] of [['current',current],['unresolved',unresolved],['historical',historical],['activeThreads',activeThreads]])for(const value of values){const p=semanticPriorityForFact(value,section,activeThreads);rows.push({semanticId:value.id,section,score:p.score,reasons:p.reasons});}
  return rows.sort((a,b)=>b.score-a.score||a.section.localeCompare(b.section)||a.semanticId.localeCompare(b.semanticId));
}
export function computeSemanticSizing({current=[],historical=[],unresolved=[],activeThreads=[],provenanceIndex={},dependencies=[]}={}){
  const sectionCounts={current:current.length,historical:historical.length,unresolved:unresolved.length,activeThreads:activeThreads.length};const semanticFactCount=current.length+historical.length+unresolved.length,semanticEntryCount=semanticFactCount+activeThreads.length;
  const serializedBytes=utf8ByteLength(stableJson({current,historical,unresolved,activeThreads,provenanceIndex,dependencies}));
  return{kind:'NeutralSemanticSizing',serializedBytes,semanticFactCount,activeThreadCount:activeThreads.length,semanticEntryCount,sectionCounts,averageBytesPerEntry:semanticEntryCount?Number((serializedBytes/semanticEntryCount).toFixed(3)):0,tokenEstimate:null,modelProfileId:null};
}
export function defaultRepresentationEligibility(){
  return{current:{required:true,allowed:['COMPACT','RICH']},historical:{required:true,allowed:['COMPACT','RICH']},unresolved:{required:true,allowed:['COMPACT','RICH']},activeThreads:{required:true,allowed:['COMPACT','RICH']}};
}
