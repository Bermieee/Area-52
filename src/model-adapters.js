import { deliveryHash } from './adaptive-context-contracts.js';
const clone=(value)=>structuredClone(value);
export const PROVIDER_MESSAGE_ROLES=Object.freeze(['system','user','assistant']);
const SUPPORTED=new Set(PROVIDER_MESSAGE_ROLES);
export function providerRoleForSemanticRole(role){
  const semantic=String(role??'');
  if(semantic==='context')return'system';
  if(SUPPORTED.has(semantic))return semantic;
  const error=new Error('UNSUPPORTED_PROVIDER_MESSAGE_ROLE:'+semantic);
  error.code='UNSUPPORTED_PROVIDER_MESSAGE_ROLE';
  throw error;
}
class MessagesAdapter{
  render(plan){
    const messages=[],messageMap=[];
    for(const segment of plan.segments)for(const section of segment.sections){
      const providerRole=providerRoleForSemanticRole(section.role),index=messages.length;
      messages.push({role:providerRole,content:'['+section.slot+']\n'+section.text});
      messageMap.push({
        index,slot:section.slot,sectionIdentity:section.sectionIdentity??null,owner:section.owner??null,priority:Number(section.priority??0),
        semanticRole:section.role,providerRole,segmentBand:segment.band,representation:section.representation??null,
        sourceRevisionIds:[...(section.sourceRevisionIds??[])],provenanceSourceRevisionIds:[...(section.sourceRevisionIds??[])],
        semanticManifestIdentity:deliveryHash(section.semanticManifest??[]),
      });
    }
    return{
      kind:'RenderedModelInput',adapterId:'messages-v1',format:'messages',
      chatId:plan.chatId??null,turnId:plan.turnId,generationId:plan.generationId,promptPlanId:plan.promptPlanId,
      contextSealId:plan.contextSealId,sealedPacketHash:plan.sealedPacketHash,modelProfileId:plan.modelProfileId,
      messages,messageMap,supportedProviderRoles:[...PROVIDER_MESSAGE_ROLES],
      semanticManifest:clone(plan.segments.flatMap(s=>s.semanticManifest??[])),
    };
  }
}
class StructuredBlocksAdapter{
  render(plan){
    return{
      kind:'RenderedModelInput',adapterId:'structured-blocks-v1',format:'structured-blocks',
      chatId:plan.chatId??null,turnId:plan.turnId,generationId:plan.generationId,promptPlanId:plan.promptPlanId,
      contextSealId:plan.contextSealId,sealedPacketHash:plan.sealedPacketHash,modelProfileId:plan.modelProfileId,
      blocks:plan.segments.map(segment=>({band:segment.band,reuseState:segment.reuseState,sections:segment.sections.map(s=>({
        slot:s.slot,sectionIdentity:s.sectionIdentity??null,owner:s.owner??null,priority:Number(s.priority??0),
        role:s.role,content:s.text,sourceRevisionIds:[...(s.sourceRevisionIds??[])],
      }))})),
      semanticManifest:clone(plan.segments.flatMap(s=>s.semanticManifest??[])),
    };
  }
}
export class ModelAdapterRegistry{constructor(){this.adapters=new Map([['messages-v1',new MessagesAdapter()],['structured-blocks-v1',new StructuredBlocksAdapter()]]);}register(id,adapter){if(!id||typeof adapter?.render!=='function')throw new TypeError('adapter requires id and render(plan)');this.adapters.set(id,adapter);}get(id){return this.adapters.get(id)??null;}}
