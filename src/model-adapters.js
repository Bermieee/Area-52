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
        index,slot:section.slot,semanticRole:section.role,providerRole,segmentBand:segment.band,
        representation:section.representation??null,sourceRevisionIds:[...(section.sourceRevisionIds??[])],
      });
    }
    return{
      kind:'RenderedModelInput',adapterId:'messages-v1',format:'messages',
      contextSealId:plan.contextSealId,sealedPacketHash:plan.sealedPacketHash,messages,messageMap,
      supportedProviderRoles:[...PROVIDER_MESSAGE_ROLES],
      semanticManifest:clone(plan.segments.flatMap(s=>s.semanticManifest??[])),
    };
  }
}
class StructuredBlocksAdapter{render(plan){return{kind:'RenderedModelInput',adapterId:'structured-blocks-v1',format:'structured-blocks',contextSealId:plan.contextSealId,sealedPacketHash:plan.sealedPacketHash,blocks:plan.segments.map(segment=>({band:segment.band,reuseState:segment.reuseState,sections:segment.sections.map(s=>({slot:s.slot,role:s.role,content:s.text}))})),semanticManifest:clone(plan.segments.flatMap(s=>s.semanticManifest??[]))};}}
export class ModelAdapterRegistry{constructor(){this.adapters=new Map([['messages-v1',new MessagesAdapter()],['structured-blocks-v1',new StructuredBlocksAdapter()]]);}register(id,adapter){if(!id||typeof adapter?.render!=='function')throw new TypeError('adapter requires id and render(plan)');this.adapters.set(id,adapter);}get(id){return this.adapters.get(id)??null;}}
