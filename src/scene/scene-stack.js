import { SceneRelationship, createSceneFrame } from './lifecycle-contracts.js';

const clone=(v)=>structuredClone(v);

export class SceneStack {
  constructor({maxDepth=16,maxHistory=64}={}){this.maxDepth=maxDepth;this.maxHistory=maxHistory;this.activeSceneId=null;this.frames=[];}

  open({sceneId,relationshipToPrior=SceneRelationship.CONTINUES,parentSceneId=null,interruptedSceneId=null,sourceRevisionRefs=[],evidenceRefs=[]}){
    if(this.frames.some((f)=>f.sceneId===sceneId&&!f.suspended))throw new Error(`duplicate active ownership: ${sceneId}`);
    if(this.frames.filter((f)=>f.resumable).length>=this.maxDepth)throw new Error('scene stack depth exceeded');
    if(relationshipToPrior===SceneRelationship.RESUMES)return this.resume(sceneId,{evidenceRefs,sourceRevisionRefs});
    if(relationshipToPrior===SceneRelationship.FLASHBACK_OF||relationshipToPrior===SceneRelationship.INTERRUPTS||relationshipToPrior===SceneRelationship.PARALLEL_TO||relationshipToPrior===SceneRelationship.ISOLATED){
      const active=this.current();if(active){active.suspended=true;active.resumable=true;interruptedSceneId??=active.sceneId;}
    }
    if(interruptedSceneId===sceneId)throw new Error('scene cannot interrupt itself');
    const frame=createSceneFrame({sceneId,relationshipToPrior,suspended:false,resumable:true,parentSceneId,interruptedSceneId,sourceRevisionRefs,evidenceRefs});
    this.frames.push(frame);this.activeSceneId=sceneId;return clone(frame);
  }

  current(){return this.frames.find((f)=>f.sceneId===this.activeSceneId)??null;}

  suspend(sceneId,{evidenceRefs=[]}={}){const f=this.frames.find((x)=>x.sceneId===sceneId);if(!f)throw new Error(`unknown scene frame: ${sceneId}`);f.suspended=true;f.evidenceRefs=[...new Set([...f.evidenceRefs,...evidenceRefs])];if(this.activeSceneId===sceneId)this.activeSceneId=null;return clone(f);}

  close(sceneId){const f=this.frames.find((x)=>x.sceneId===sceneId);if(!f)throw new Error(`unknown scene frame: ${sceneId}`);f.suspended=true;f.resumable=false;if(this.activeSceneId===sceneId)this.activeSceneId=null;const closed=this.frames.filter((x)=>!x.resumable);if(closed.length>this.maxHistory){const remove=new Set(closed.slice(0,closed.length-this.maxHistory));this.frames=this.frames.filter((x)=>!remove.has(x));}return clone(f);}

  resume(sceneId,{evidenceRefs=[],sourceRevisionRefs=[]}={}){
    const f=this.frames.find((x)=>x.sceneId===sceneId);if(!f)throw new Error(`cannot resume unknown scene: ${sceneId}`);if(!f.resumable)throw new Error(`scene not resumable: ${sceneId}`);
    const active=this.current();if(active&&active.sceneId!==sceneId)throw new Error(`cannot resume ${sceneId} while ${active.sceneId} owns active frame`);
    f.suspended=false;f.relationshipToPrior=SceneRelationship.RESUMES;f.evidenceRefs=[...new Set([...f.evidenceRefs,...evidenceRefs])];f.sourceRevisionRefs=[...new Set([...f.sourceRevisionRefs,...sourceRevisionRefs])];this.activeSceneId=sceneId;return clone(f);
  }

  relate(sceneId,relationshipToPrior){const f=this.frames.find((x)=>x.sceneId===sceneId);if(!f)throw new Error(`unknown scene frame: ${sceneId}`);f.relationshipToPrior=relationshipToPrior;return clone(f);}
  exportState(){return clone({version:1,maxDepth:this.maxDepth,maxHistory:this.maxHistory,activeSceneId:this.activeSceneId,frames:this.frames});}
  static importState(state){const stack=new SceneStack({maxDepth:state.maxDepth??16,maxHistory:state.maxHistory??64});stack.frames=(state.frames??[]).map((f)=>createSceneFrame(f));stack.activeSceneId=state.activeSceneId??null;if(stack.activeSceneId&&!stack.frames.some((f)=>f.sceneId===stack.activeSceneId&&!f.suspended))throw new Error('invalid restored active scene');return stack;}
}
