const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))];

export class AtmosphereConsumptionPolicy{
  constructor({enabled=true,maxAgeRevisions=2,maxDimensions=8}={}){
    this.enabled=Boolean(enabled);this.maxAgeRevisions=Math.max(1,Math.min(16,Number(maxAgeRevisions)||2));this.maxDimensions=Math.max(1,Math.min(8,Number(maxDimensions)||8));
  }
  consume({atmosphere,currentSceneRevision,generationDerivedEvidenceRefs=[]}={}){
    const base={kind:'SceneAtmosphereContribution',contractVersion:'1.0.0',authority:'ADVISORY_INFERENCE',canonical:false,proseStyleAuthority:false,factCreationAuthority:false,settlementAuthority:false,contextSealAuthority:false,recursiveValidationAllowed:false,readOnly:true};
    if(!this.enabled)return Object.freeze({...base,status:'DISABLED',dimensions:{},evidenceRefs:[]});
    if(!atmosphere||atmosphere.observationClass!=='INFERRED')return Object.freeze({...base,status:'UNAVAILABLE',dimensions:{},evidenceRefs:[]});
    const evidenceRefs=uniq(atmosphere.evidenceRefs??[]),generated=new Set(uniq(generationDerivedEvidenceRefs));
    if(evidenceRefs.length&&evidenceRefs.every(ref=>generated.has(ref)))return Object.freeze({...base,status:'REJECTED_RECURSIVE_EVIDENCE',dimensions:{},evidenceRefs});
    const revision=Number(atmosphere.revision??0),current=Number(currentSceneRevision??revision),expiry=Number(atmosphere.metadata?.expiresAfterRevision??(revision+this.maxAgeRevisions));
    if(current>expiry||current-revision>this.maxAgeRevisions)return Object.freeze({...base,status:'EXPIRED',dimensions:{},evidenceRefs,revision,expiryRevision:expiry});
    const entries=Object.entries(atmosphere.value??{}).sort((a,b)=>Number(b[1]?.score??0)-Number(a[1]?.score??0)).slice(0,this.maxDimensions);
    return Object.freeze({...base,status:'AVAILABLE',revision,expiryRevision:expiry,dimensions:clone(Object.fromEntries(entries)),evidenceRefs,influenceModes:['RETRIEVAL_PRIORITY','COGNITIVE_ATTENTION'],promptStyleInstruction:null});
  }
}
