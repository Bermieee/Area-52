const clone=(v)=>structuredClone(v);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();

export const ScenePrefetchIntentKind=Object.freeze({
  EXPLICIT_TRAVEL_DESTINATION:'EXPLICIT_TRAVEL_DESTINATION',
});

export function scenePrefetchIntentsFromNarrative(text){
  const raw=String(text??'').trim();
  if(!raw)return[];
  const subject=String.raw`(?:we|i|they|he|she|you|[\p{Lu}][\p{L}\p{N}'’_-]*)`;
  const verb=String.raw`(?:head|travel|journey|go|move|return|set\s+out)`;
  const progressiveVerb=String.raw`(?:heading|travell?ing|journeying|going|moving|returning|setting\s+out)`;
  const destination=String.raw`([^,.!?;:\n]{1,120}?)`;
  const stop=String.raw`(?=\s+(?:next|soon|later|tomorrow|today|tonight)\b|[,.!?;:\n]|$)`;
  const toward=String.raw`(?:for|to|toward|towards)`;
  const plannedLead=String.raw`(?:will|should|must|need\s+to|needs\s+to|plan\s+to|plans\s+to|intend\s+to|intends\s+to|want\s+to|wants\s+to|(?:am|are|is)\s+going\s+to)`;
  const patterns=[
    new RegExp(String.raw`\b${subject}\s+${plannedLead}\s+${verb}\s+${toward}\s+(?:the\s+)?${destination}${stop}`,'giu'),
    new RegExp(String.raw`\b${subject}(?:\s+(?:am|are|is)|(?:'m|'re|'s|’m|’re|’s))\s+${progressiveVerb}\s+${toward}\s+(?:the\s+)?${destination}${stop}`,'giu'),
    new RegExp(String.raw`\blet(?:'|’)s\s+${verb}\s+${toward}\s+(?:the\s+)?${destination}${stop}`,'giu'),
  ];
  const out=[],seen=new Set();
  for(const re of patterns){
    for(const match of raw.matchAll(re)){
      const value=String(match[1]??'').replace(/\s+/g,' ').trim();
      if(!value||value.length>120)continue;
      const key=value.toLocaleLowerCase();
      if(seen.has(key))continue;
      seen.add(key);
      out.push(Object.freeze({
        intentKind:ScenePrefetchIntentKind.EXPLICIT_TRAVEL_DESTINATION,
        locationRefs:Object.freeze([value]),
        entityRefs:Object.freeze([]),
        threadRefs:Object.freeze([]),
        sceneRefs:Object.freeze([]),
        priority:'HIGH',
        authority:'NONE',
      }));
      if(out.length>=4)return Object.freeze(out);
    }
  }
  return Object.freeze(out);
}

export class ScenePrefetchTrigger{
  constructor({maxPending=32,defaultTtlRevisions=3}={}){this.maxPending=maxPending;this.defaultTtlRevisions=defaultTtlRevisions;this.pending=new Map();this.seq=0;}
  recommend({sceneId,sceneRevision,trigger,entityRefs=[],locationRefs=[],threadRefs=[],sceneRefs=[],priority='NORMAL',evidenceRefs=[],sourceRevisionRefs=[],ttlRevisions=this.defaultTtlRevisions}){
    const normalized={
      sceneId:String(sceneId),sceneRevision:Number(sceneRevision),trigger:String(trigger),
      entityRefs:uniq(entityRefs),locationRefs:uniq(locationRefs),threadRefs:uniq(threadRefs),sceneRefs:uniq(sceneRefs),
      priority:String(priority??'NORMAL'),evidenceRefs:uniq(evidenceRefs),sourceRevisionSet:uniq(sourceRevisionRefs),
    };
    const dedupeKey=semanticKey(normalized);
    for(const row of this.pending.values())if(row.status==='ACTIVE'&&row.dedupeKey===dedupeKey)return clone(row);
    const id=`prefetch:${normalized.sceneId}:${normalized.sceneRevision}:${++this.seq}`;
    const r={
      kind:'PrefetchRecommendation',contractVersion:'1.0.0',recommendationId:id,dedupeKey,
      sceneId:normalized.sceneId,sceneRevision:normalized.sceneRevision,trigger:normalized.trigger,
      entityRefs:normalized.entityRefs,locationRefs:normalized.locationRefs,threadRefs:normalized.threadRefs,sceneRefs:normalized.sceneRefs,
      priority:normalized.priority,expiryRevision:normalized.sceneRevision+Number(ttlRevisions??this.defaultTtlRevisions),
      evidenceRefs:normalized.evidenceRefs,sourceRevisionRefs:[...normalized.sourceRevisionSet],sourceRevisionSet:[...normalized.sourceRevisionSet],
      authority:'NONE',runtimeSchedulingAuthority:false,retrievalAuthority:false,truthAuthority:false,contextSealAuthority:false,status:'ACTIVE',
    };
    while(this.pending.size>=this.maxPending){
      const terminal=[...this.pending.entries()].find(([,row])=>row.status!=='ACTIVE');
      if(!terminal)break;
      this.pending.delete(terminal[0]);
    }
    if(this.pending.size>=this.maxPending)return clone({...r,status:'DEFERRED',reasonCode:'PREFETCH_ACTIVE_CAPACITY_REACHED',cacheState:'NOT_CACHED',recovery:'FOREGROUND_RETRIEVAL_REVALIDATION_REQUIRED'});
    r.cacheState='CACHED';this.pending.set(id,r);return clone(r);
  }
  recommendFromIntents({sceneId,sceneRevision,intents=[],trigger='QUERY_PLAN',evidenceRefs=[],sourceRevisionRefs=[]}={}){
    const rows=[];
    for(const intent of intents.slice(0,8))rows.push(this.recommend({
      sceneId,sceneRevision,trigger:trigger+':'+String(intent.intentKind??'INTENT'),
      entityRefs:intent.entityRefs??[],locationRefs:intent.locationRefs??[],threadRefs:intent.threadRefs??[],sceneRefs:intent.sceneRefs??[],
      priority:intent.priority??(['LOCATION_CONTEXT','THREAT_CONTEXT',ScenePrefetchIntentKind.EXPLICIT_TRAVEL_DESTINATION].includes(intent.intentKind)?'HIGH':'NORMAL'),
      evidenceRefs,sourceRevisionRefs,
    }));
    return rows;
  }
  active({sceneId,sceneRevision}){this.expire({sceneId,sceneRevision});this.cancelSuperseded({sceneId,sceneRevision});return [...this.pending.values()].filter((x)=>x.sceneId===sceneId&&x.status==='ACTIVE'&&Number(x.sceneRevision)===Number(sceneRevision)).map(clone);}
  expire({sceneId,sceneRevision}){for(const r of this.pending.values())if(r.sceneId===sceneId&&r.status==='ACTIVE'&&r.expiryRevision<sceneRevision)r.status='EXPIRED';}
  cancelSuperseded({sceneId,sceneRevision}){for(const r of this.pending.values())if(r.sceneId===sceneId&&r.status==='ACTIVE'&&r.sceneRevision<sceneRevision)r.status='CANCELLED';}
  cancelOtherScenes({sceneId,reason='CHAT_CHANGED'}={}){const changed=[];for(const r of this.pending.values()){if(r.status!=='ACTIVE'||r.sceneId===sceneId)continue;r.status='CANCELLED';r.invalidators=uniq([...(r.invalidators??[]),reason]);changed.push(clone(r));}return changed;}
  invalidateBySource({sourceRevisionRefs=[],replacementRef=null}={}){const refs=new Set(uniq(sourceRevisionRefs)),changed=[];for(const r of this.pending.values()){if(r.status!=='ACTIVE'||!(r.sourceRevisionRefs??[]).some(ref=>refs.has(String(ref))))continue;r.status='CANCELLED';r.invalidators=uniq([...(r.invalidators??[]),replacementRef,...refs]);changed.push(clone(r));}return changed;}
  isFresh(recommendation,{sceneId,sceneRevision,sourceRevisionRefs=null}={}){if(!(recommendation?.kind==='PrefetchRecommendation'&&recommendation.status==='ACTIVE'&&recommendation.sceneId===sceneId&&Number(recommendation.sceneRevision)===Number(sceneRevision)&&Number(sceneRevision)<=Number(recommendation.expiryRevision)))return false;if(sourceRevisionRefs==null)return true;const current=new Set(uniq(sourceRevisionRefs));return (recommendation.sourceRevisionSet??recommendation.sourceRevisionRefs??[]).every(ref=>current.has(String(ref)));}
  exportState(){return clone({version:2,seq:this.seq,pending:[...this.pending.values()]});}
  static importState(state){const p=new ScenePrefetchTrigger();p.seq=state.seq??0;for(const r of state.pending??[]){const row={...clone(r)};row.dedupeKey=row.dedupeKey??semanticKey(row);p.pending.set(row.recommendationId,row);}return p;}
}

function semanticKey(value){
  const row={
    sceneId:String(value.sceneId??''),sceneRevision:Number(value.sceneRevision??0),trigger:String(value.trigger??''),
    entityRefs:uniq(value.entityRefs),locationRefs:uniq(value.locationRefs),threadRefs:uniq(value.threadRefs),sceneRefs:uniq(value.sceneRefs),
  };
  return JSON.stringify(row);
}
