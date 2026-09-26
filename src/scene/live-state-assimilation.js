const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))];

export const SceneSnapshotScope=Object.freeze({FIELD_SLICE:'FIELD_SLICE',CURRENT_SCENE:'CURRENT_SCENE',SIGNIFICANT_REVISIONS:'SIGNIFICANT_REVISIONS'});

export class SceneSmartSnapshotSelector{
  constructor({maxFields=8,maxSourceRefs=32,maxSignificant=6}={}){
    this.maxFields=Math.max(1,Math.min(32,Number(maxFields)||8));
    this.maxSourceRefs=Math.max(4,Math.min(128,Number(maxSourceRefs)||32));
    this.maxSignificant=Math.max(1,Math.min(16,Number(maxSignificant)||6));
  }

  select({record,affectedFields=[]}={}){
    const scene=record?.snapshots?.at?.(-1)??null;
    if(!scene)return null;
    const names=uniq(affectedFields).filter(name=>Object.prototype.hasOwnProperty.call(scene.fields??{},name)).slice(0,this.maxFields);
    if(names.length){
      const fields=Object.fromEntries(names.map(name=>[name,clone(scene.fields[name])]));
      return Object.freeze({
        kind:'SceneSmartSnapshotSelection',contractVersion:'1.0.0',scope:SceneSnapshotScope.FIELD_SLICE,
        sceneId:scene.sceneId,sceneRevision:scene.revision,fields,
        sourceRevisionRefs:uniq([...scene.sourceRevisionRefs,...names.flatMap(name=>scene.fields?.[name]?.evidenceRefs??[])]).slice(-this.maxSourceRefs),
        fullSnapshotIncluded:false,authority:'READ_ONLY',mutationAuthority:false,
      });
    }
    return Object.freeze({
      kind:'SceneSmartSnapshotSelection',contractVersion:'1.0.0',scope:SceneSnapshotScope.CURRENT_SCENE,
      sceneId:scene.sceneId,sceneRevision:scene.revision,fields:clone(scene.fields??{}),
      sourceRevisionRefs:uniq(scene.sourceRevisionRefs).slice(-this.maxSourceRefs),
      fullSnapshotIncluded:true,authority:'READ_ONLY',mutationAuthority:false,
    });
  }

  significant({record,limit=this.maxSignificant}={}){
    const cap=Math.max(1,Math.min(this.maxSignificant,Number(limit)||this.maxSignificant));
    const snapshots=record?.snapshots??[],byRevision=new Map(snapshots.map(row=>[row.revision,row]));
    const scored=(record?.deltas??[]).map(delta=>{
      const names=Object.keys(delta.changedFields??{});let score=0;
      if(names.includes('location'))score+=6;if(names.includes('narrativeTime'))score+=6;if(names.includes('activeCast'))score+=4;
      if(names.includes('activeThreads'))score+=3;if(names.includes('immediateObjects'))score+=3;if(names.includes('atmosphere'))score+=1;
      if(delta.fullRefreshRequired)score+=8;
      return{revision:delta.toRevision,score,reasons:names,sourceRevisionRefs:uniq(delta.evidenceRefs)};
    }).sort((a,b)=>b.score-a.score||b.revision-a.revision);
    const latest=snapshots.at(-1);const chosen=[];const seen=new Set();
    if(latest){chosen.push({revision:latest.revision,score:Number.MAX_SAFE_INTEGER,reasons:['CURRENT'],sourceRevisionRefs:uniq(latest.sourceRevisionRefs)});seen.add(latest.revision);}
    for(const row of scored){if(chosen.length>=cap)break;if(seen.has(row.revision))continue;chosen.push(row);seen.add(row.revision);}
    return Object.freeze({
      kind:'SceneSignificantSnapshotSelection',contractVersion:'1.0.0',scope:SceneSnapshotScope.SIGNIFICANT_REVISIONS,
      sceneId:record?.sceneId??latest?.sceneId??null,
      revisions:chosen.map(row=>Object.freeze({...row,available:byRevision.has(row.revision)})),
      authority:'READ_ONLY',mutationAuthority:false,
    });
  }
}
