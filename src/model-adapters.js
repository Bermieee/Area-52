const clone=(value)=>structuredClone(value);
const PROVIDER_MESSAGE_ROLES=new Set(['system','user','assistant','tool']);

function providerRole(role){
  const semanticRole=String(role??'context').toLowerCase();
  if(PROVIDER_MESSAGE_ROLES.has(semanticRole))return semanticRole;
  if(semanticRole==='context')return 'system';
  throw new TypeError('Unsupported provider message role: '+semanticRole);
}

class MessagesAdapter{
  render(plan,{profile=null,routing=null}={}){
    const messages=[],messageManifest=[],fullBySlot=new Map((plan.sections??[]).map(section=>[section.slot,section]));
    for(const segment of plan.segments)for(const section of segment.sections){
      const semanticRole=String(section.role??'context').toLowerCase(),outboundRole=providerRole(semanticRole),full=fullBySlot.get(section.slot)??section;
      const index=messages.length;
      messages.push({role:outboundRole,content:`[${section.slot}]\n${section.text}`});
      messageManifest.push({
        index,slot:section.slot,semanticRole,outboundRole,sectionIdentity:section.sectionIdentity??full.sectionIdentity??null,
        representation:section.representation??full.representation??null,sourceRevisionIds:[...(full.sourceRevisionIds??[])],
        priority:Number(full.priority??0),required:Boolean(full.required),protected:Boolean(full.protected),
      });
    }
    return{
      kind:'RenderedModelInput',adapterId:'messages-v1',format:'messages',
      promptPlanId:plan.promptPlanId,generationId:plan.generationId,turnId:plan.turnId,
      contextSealId:plan.contextSealId,sealedPacketHash:plan.sealedPacketHash,
      providerId:routing?.providerId??null,modelProfileId:profile?.modelProfileId??plan.modelProfileId,
      messages,messageManifest,
      semanticManifest:clone(plan.segments.flatMap(s=>s.semanticManifest??[])),
    };
  }
}
class StructuredBlocksAdapter{
  render(plan){
    return{
      kind:'RenderedModelInput',adapterId:'structured-blocks-v1',format:'structured-blocks',
      promptPlanId:plan.promptPlanId,generationId:plan.generationId,turnId:plan.turnId,
      contextSealId:plan.contextSealId,sealedPacketHash:plan.sealedPacketHash,
      blocks:plan.segments.map(segment=>({band:segment.band,reuseState:segment.reuseState,sections:segment.sections.map(s=>({slot:s.slot,role:s.role,content:s.text}))})),
      semanticManifest:clone(plan.segments.flatMap(s=>s.semanticManifest??[])),
    };
  }
}
export class ModelAdapterRegistry{
  constructor(){this.adapters=new Map([['messages-v1',new MessagesAdapter()],['structured-blocks-v1',new StructuredBlocksAdapter()]]);}
  register(id,adapter){if(!id||typeof adapter?.render!=='function')throw new TypeError('adapter requires id and render(plan)');this.adapters.set(id,adapter);}
  get(id){return this.adapters.get(id)??null;}
}
