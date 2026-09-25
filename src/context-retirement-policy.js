import { stableHash,utf8ByteLength } from './browser-runtime-utils.js';

const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();
const req=(value,name)=>{if(typeof value!=='string'||!value.trim())throw new TypeError(name+' must be a non-empty string');return value.trim();};
const durableKinds=new Set(['SCENE_EPISODE','SCENEEPISODE','SUMMARY','DURABLE_SUMMARY']);
const protectedTags=new Set(['UNRESOLVED_THREAD','HARD_RULE','EXCEPTION','RELATIONSHIP_CHANGE','OPERATOR_PINNED']);

function normalizeMessage(row,index){
  if(!row||typeof row!=='object')throw new TypeError('active context messages must be objects');
  const messageId=req(String(row.messageId??row.id??('message:'+index)),'messageId');
  const content=typeof row.content==='string'?row.content:'';
  return{
    ...clone(row),messageId,sequence:Number.isFinite(Number(row.sequence))?Number(row.sequence):index,
    role:String(row.role??'unknown'),content,
    sourceRevisionRefs:uniq(row.sourceRevisionRefs??(row.sourceRevisionId?[row.sourceRevisionId]:[])),
    provenanceRefs:uniq(row.provenanceRefs??[]),
    tags:uniq(row.tags??[]).map(x=>x.toUpperCase()),
  };
}

function coverageForMessage(message,coverage,chatId){
  const reasons=[];
  if(!coverage||typeof coverage!=='object')return{ok:false,reasons:['COVERAGE_MISSING']};
  const kind=String(coverage.kind??coverage.artifactType??'').toUpperCase();
  if(!durableKinds.has(kind))reasons.push('COVERAGE_NOT_DURABLE_ARTIFACT');
  if(coverage.committed!==true||coverage.durable===false)reasons.push('COVERAGE_NOT_COMMITTED');
  if(String(coverage.chatId??coverage.chatIdentity??'')!==chatId)reasons.push('CHAT_IDENTITY_MISMATCH');
  if(coverage.stale===true||String(coverage.state??'CURRENT').toUpperCase()==='STALE')reasons.push('COVERAGE_STALE');
  if(coverage.disputed===true||String(coverage.state??'CURRENT').toUpperCase()==='DISPUTED')reasons.push('COVERAGE_DISPUTED');
  const sourceRevisionRefs=uniq(coverage.sourceRevisionRefs??[]);
  const provenanceRefs=uniq(coverage.provenanceRefs??[]);
  if(!sourceRevisionRefs.length)reasons.push('SOURCE_REVISIONS_MISSING');
  if(!provenanceRefs.length)reasons.push('PROVENANCE_MISSING');
  const covers=uniq(coverage.coversMessageIds??coverage.messageIds??[]);
  if(!covers.includes(message.messageId))reasons.push('MESSAGE_NOT_COVERED');
  if(message.sourceRevisionRefs.length){
    const coveredRevisionRefs=new Set(uniq([...(coverage.coveredSourceRevisionRefs??[]),...provenanceRefs,...sourceRevisionRefs]));
    if(!message.sourceRevisionRefs.every(ref=>coveredRevisionRefs.has(ref)))reasons.push('MESSAGE_SOURCE_REVISION_NOT_PROVEN');
  }
  const probe=coverage.retrievalProbe??coverage.probe??null;
  if(!probe)reasons.push('RETRIEVAL_PROBE_MISSING');
  else{
    if(String(probe.status??'').toUpperCase()!=='PASS')reasons.push('RETRIEVAL_PROBE_FAILED');
    if(String(probe.chatId??chatId)!==chatId)reasons.push('RETRIEVAL_PROBE_CHAT_MISMATCH');
    const probeRefs=new Set(uniq(probe.sourceRevisionRefs??sourceRevisionRefs));
    if(!sourceRevisionRefs.every(ref=>probeRefs.has(ref)))reasons.push('RETRIEVAL_PROBE_REVISION_MISMATCH');
  }
  return{ok:reasons.length===0,reasons,coverageId:String(coverage.coverageId??coverage.id??stableHash({kind,chatId,sourceRevisionRefs,covers},{length:20})),kind,sourceRevisionRefs,provenanceRefs};
}

function protectedMessage(message){
  if(message.operatorPinned===true||message.unresolvedThread===true||message.hardRule===true||message.exception===true||message.relationshipChange===true)return true;
  return message.tags.some(tag=>protectedTags.has(tag));
}

export class NativeContextRetirementPolicy{
  constructor({defaultRecentWindow=6,transitionTail=2}={}){
    this.defaultRecentWindow=Math.max(1,Number(defaultRecentWindow)||6);
    this.transitionTail=Math.max(0,Number(transitionTail)||2);
  }

  evaluate({chatId,messages=[],coverage=[],recentWindow=this.defaultRecentWindow,sceneTransition=null}={}){
    const chat=req(chatId,'chatId');
    const normalized=(messages??[]).map(normalizeMessage).sort((a,b)=>a.sequence-b.sequence||a.messageId.localeCompare(b.messageId));
    const recentCount=Math.max(1,Number(recentWindow)||this.defaultRecentWindow);
    const recentIds=new Set(normalized.slice(-recentCount).map(row=>row.messageId));
    const coverageRows=Array.isArray(coverage)?coverage:[];
    const decisions=[],retireEligible=[],kept=[];
    for(const message of normalized){
      const reasons=[];
      if(recentIds.has(message.messageId))reasons.push('RECENT_VERBATIM_WINDOW');
      if(protectedMessage(message))reasons.push('PROTECTED_CONTEXT');
      const matches=coverageRows.filter(row=>(row?.coversMessageIds??row?.messageIds??[]).map(String).includes(message.messageId));
      const proofs=matches.map(row=>coverageForMessage(message,row,chat));
      const valid=proofs.find(row=>row.ok)??null;
      if(!reasons.length&&!valid){
        reasons.push(...uniq(proofs.flatMap(row=>row.reasons)));
        if(!proofs.length)reasons.push('DURABLE_COVERAGE_MISSING');
      }
      const eligible=reasons.length===0&&Boolean(valid);
      if(eligible)retireEligible.push(message.messageId);else kept.push(message.messageId);
      decisions.push({messageId:message.messageId,sequence:message.sequence,eligible,action:eligible?'RETIRE_FROM_ACTIVE_PROMPT':'KEEP_RAW',reasons:uniq(reasons),coverageId:valid?.coverageId??null,sourceRevisionRefs:valid?.sourceRevisionRefs??[],provenanceRefs:valid?.provenanceRefs??[]});
    }
    const retainedMessages=normalized.filter(row=>kept.includes(row.messageId));
    const rawBytes=utf8ByteLength(normalized.map(row=>row.content).join('\n'));
    const retainedBytes=utf8ByteLength(retainedMessages.map(row=>row.content).join('\n'));
    const transition=sceneTransition&&typeof sceneTransition==='object'?{
      kind:'ContextSceneTransitionCarry',
      previousSceneId:sceneTransition.previousSceneId??null,
      destinationSceneId:sceneTransition.destinationSceneId??sceneTransition.nextSceneId??null,
      compactPreviousSceneTail:normalized.slice(Math.max(0,normalized.length-recentCount-this.transitionTail),Math.max(0,normalized.length-recentCount)).slice(-this.transitionTail).map(row=>({messageId:row.messageId,role:row.role,content:row.content})),
      prefetchDestination:Boolean(sceneTransition.destinationSceneId??sceneTransition.nextSceneId),
      prefetchHints:uniq(sceneTransition.prefetchHints??[]),
    }:null;
    const abstained=retireEligible.length===0&&normalized.length>recentCount;
    return Object.freeze({
      kind:'NativeContextRetirementReceipt',contractVersion:1,chatId:chat,
      policy:'EVIDENCE_GATED_ACTIVE_PROMPT_RETIREMENT',hostHistoryMutation:false,
      recentWindow:recentCount,messageCount:normalized.length,retireEligibleMessageIds:retireEligible,
      keptRawMessageIds:kept,decisions,retainedMessages:clone(retainedMessages),sceneTransition:transition,
      measurements:{rawBytes,retainedBytes,exactByteSavings:Math.max(0,rawBytes-retainedBytes),retiredMessages:retireEligible.length,retainedMessages:kept.length},
      abstained,abstentionReason:abstained?'NO_MESSAGE_HAS_CURRENT_DURABLE_RETRIEVAL_PROOF':null,
      receiptId:'context-retirement:'+stableHash({chatId:chat,decisions:decisions.map(row=>[row.messageId,row.action,row.coverageId,row.reasons])},{length:24}),
    });
  }
}

export function contextRetirementContract(){
  return Object.freeze({
    kind:'NativeContextRetirementContract',contractVersion:1,
    requires:['EXACT_CHAT_IDENTITY','COMMITTED_SCENE_EPISODE_OR_SUMMARY','SOURCE_REVISIONS','PROVENANCE','SUCCESSFUL_RETRIEVAL_PROBE'],
    alwaysRetained:['RECENT_VERBATIM_WINDOW','UNRESOLVED_THREAD','HARD_RULE','EXCEPTION','RELATIONSHIP_CHANGE','OPERATOR_PINNED'],
    regressionBehavior:'REVERSE_OR_ABSTAIN',
    hostHistoryMutation:false,
    fixedStoryAssumption:false,
  });
}
