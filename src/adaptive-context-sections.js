import { PromptSlot,deliveryHash } from './adaptive-context-contracts.js';
const clone=(value)=>structuredClone(value),uniq=(values)=>[...new Set(values)].sort();
export function factTemporalStatus(fact,slot){if(fact?.temporalStatus)return String(fact.temporalStatus);if(slot===PromptSlot.CURRENT_WORLD_STATE||slot===PromptSlot.CURRENT_CHARACTER_STATE)return'CURRENT';if(slot===PromptSlot.ACTIVE_THREADS)return'UNRESOLVED';if(Array.isArray(fact?.t)&&fact.t[2])return fact.t[2];if(slot===PromptSlot.HISTORICAL_SUPPORT)return'HISTORICAL';if(slot===PromptSlot.UNRESOLVED_EVIDENCE)return'UNRESOLVED';return null;}
const factAuthority=(fact)=>fact?.a??fact?.authorityClass??null;
export const factKey=(fact,slot)=>String(fact?.id??deliveryHash([slot,fact?.e,fact?.p,fact?.v]));
function compactExternalEvidenceFact(fact){
  if(!fact||typeof fact!=='object'||!Object.prototype.hasOwnProperty.call(fact,'sourceClass')||!Object.prototype.hasOwnProperty.call(fact,'text'))return fact;
  const semantic=fact.semantic&&typeof fact.semantic==='object'?fact.semantic:null;
  const base={
    id:fact.id,eid:fact.evidenceId,sc:fact.sourceClass,a:fact.a,t:fact.temporalStatus,cf:fact.cf,
    hr:Boolean(fact.hardRule),ar:fact.artifactRef,sr:fact.sourceRevisionRefs,dr:fact.dependencyRevisionRefs,pr:fact.provenanceRefs,
  };
  return semantic?{...base,s:semantic}:{...base,text:fact.text};
}
function compactHotCognitionFact(fact){
  if(!fact||typeof fact!=='object'||!Object.prototype.hasOwnProperty.call(fact,'hotSegment'))return fact;
  return{e:fact.e,p:fact.p,v:fact.v,a:fact.a,cf:fact.cf,t:fact.t};
}
function compactFactForPresentation(fact){
  const external=compactExternalEvidenceFact(fact);
  return external===fact?compactHotCognitionFact(fact):external;
}
function compactPresentation(content){
  if(typeof content==='string')return content;
  if(Array.isArray(content))return content.map(compactFactForPresentation);
  return compactFactForPresentation(content);
}
function renderSection(slot,content){const richText=typeof content==='string'?content:`${slot}\n${JSON.stringify(content,null,2)}`,compactText=typeof content==='string'?content:JSON.stringify(compactPresentation(content));return{richText,compactText};}
function sourceRevisionsForFact(packet,fact){return uniq(packet.provenanceIndex?.[fact.id]??[]);}
export function packetFactMap(packet){const map=new Map();for(const [slot,rows] of [[PromptSlot.CURRENT_WORLD_STATE,packet.current??[]],[PromptSlot.HISTORICAL_SUPPORT,packet.historical??[]],[PromptSlot.UNRESOLVED_EVIDENCE,packet.unresolved??[]]])for(const fact of rows)map.set(fact.id,{fact,slot});for(const [field,rows] of Object.entries(packet)){if(['current','historical','unresolved','dependencies'].includes(field)||!Array.isArray(rows))continue;for(const fact of rows)if(fact&&typeof fact==='object'&&typeof fact.id==='string'&&!map.has(fact.id))map.set(fact.id,{fact,slot:null,packetField:field});}return map;}
function semanticEntry(packet,fact,slot){return{semanticKey:factKey(fact,slot),slot,authorityClass:factAuthority(fact),temporalStatus:factTemporalStatus(fact,slot),sourceRevisionIds:sourceRevisionsForFact(packet,fact),contentHash:deliveryHash(fact)};}
export function sectionFromFacts(packet,slot,facts,spec,{priority=0}={}){const content=clone(facts),rendered=renderSection(slot,content),sourceRevisionIds=uniq(facts.flatMap(f=>sourceRevisionsForFact(packet,f)));return{slot,owner:spec.owner,role:spec.role,protected:spec.protected,band:spec.band,cacheEligible:spec.cacheEligible,semantic:true,priority,content,...rendered,sourceRevisionIds,semanticManifest:facts.map(f=>semanticEntry(packet,f,slot))};}
export function sectionFromContribution(contribution,spec,content){const rendered=renderSection(contribution.slot,content);return{slot:contribution.slot,owner:spec.owner,role:spec.role,protected:spec.protected||contribution.required,band:spec.band,cacheEligible:spec.cacheEligible,semantic:contribution.semantic,priority:contribution.priority,content:clone(content),...rendered,sourceRevisionIds:uniq(contribution.sourceRevisionIds),semanticManifest:[],contributionId:contribution.id,sourceCategory:contribution.sourceCategory};}
export function orderSections(sections,profile){const rank=new Map(profile.positionOrder.map((slot,index)=>[slot,index]));return[...sections].sort((a,b)=>(rank.get(a.slot)??Number.MAX_SAFE_INTEGER)-(rank.get(b.slot)??Number.MAX_SAFE_INTEGER)||a.slot.localeCompare(b.slot));}
