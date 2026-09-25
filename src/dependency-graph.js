import {FrameworkFailureCode,SubsystemLifecycle} from './framework-contracts.js';
import {clone} from './framework-utils.js';

export class ServiceDependencyGraph{
  #manifests=new Map();
  setManifest(manifest){this.#manifests.set(manifest.subsystemId,clone(manifest));return this.resolve(manifest.subsystemId);}
  removeManifest(id){this.#manifests.delete(id);}
  getManifest(id){const x=this.#manifests.get(id);return x?clone(x):null;}
  services(){return[...this.#manifests.keys()].sort();}
  resolve(id){
    const m=this.#manifests.get(id);if(!m)return{serviceId:id,available:false,canActivate:false,missingRequired:[id],missingOptional:[],degraded:true,reasons:['service is not registered']};
    const usable=(dep)=>{const found=this.#manifests.get(dep.id);return found&&found.lifecycleState!==SubsystemLifecycle.DEPRECATED;};
    const missingRequired=m.requiredDependencies.filter(d=>!usable(d)).map(d=>d.id),missingOptional=m.optionalDependencies.filter(d=>!usable(d)).map(d=>d.id);
    const cycle=this.findRequiredCycle(id);const reasons=[];if(missingRequired.length)reasons.push(`missing required: ${missingRequired.join(', ')}`);if(missingOptional.length)reasons.push(`missing optional: ${missingOptional.join(', ')}`);if(cycle)reasons.push(`required dependency cycle: ${cycle.join(' -> ')}`);
    return{serviceId:id,available:true,canActivate:missingRequired.length===0&&!cycle,missingRequired,missingOptional,degraded:missingOptional.length>0||missingRequired.length>0||Boolean(cycle),cycle,reasons};
  }
  findRequiredCycle(startId=null){
    const visited=new Set(),active=new Set(),stack=[];let found=null;
    const visit=(id)=>{if(found)return;if(active.has(id)){const at=stack.indexOf(id);found=[...stack.slice(at),id];return;}if(visited.has(id))return;visited.add(id);active.add(id);stack.push(id);const m=this.#manifests.get(id);for(const dep of m?.requiredDependencies??[])if(this.#manifests.has(dep.id))visit(dep.id);stack.pop();active.delete(id);};
    if(startId)visit(startId);else for(const id of this.#manifests.keys())visit(id);return found;
  }
  validate(){const cycle=this.findRequiredCycle();const rows=this.services().map(id=>this.resolve(id));return{ok:!cycle&&rows.every(x=>x.missingRequired.length===0),code:cycle?FrameworkFailureCode.DEPENDENCY_CYCLE:null,cycle,services:rows};}
}
