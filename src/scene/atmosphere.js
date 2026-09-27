import { ObservationClass, createFieldState } from './contracts.js';

const DIMENSIONS = Object.freeze(['tension','danger','intimacy','urgency','uncertainty','humor','grief','hostility']);
const clamp=(value,fallback=0)=>Math.max(0,Math.min(1,Number.isFinite(Number(value))?Number(value):fallback));
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))];

function normalizeDimension(input){
  if(typeof input==='number')return{score:clamp(input),confidence:.5,evidenceRefs:[]};
  if(!input||typeof input!=='object')return null;
  return{
    score:clamp(input.score??input.value,0),
    confidence:clamp(input.confidence,.5),
    evidenceRefs:uniq(input.evidenceRefs??[]),
  };
}

export class AtmosphereTracker {
  constructor({ttlRevisions=2}={}){this.ttlRevisions=Math.max(1,Math.min(16,Number(ttlRevisions)||2));}
  nextScene({ revision, evidenceRefs = [], dimensions = {} } = {}) { return this.update({ revision, evidenceRefs, dimensions }); }
  update({ revision, evidenceRefs = [], dimensions = {} }) {
    const value = {};
    const sharedRefs=uniq(evidenceRefs);
    let minConfidence = 1;
    for (const name of DIMENSIONS) {
      if (!(name in (dimensions??{}))) continue;
      const input=normalizeDimension(dimensions[name]);
      if(!input)continue;
      const refs=uniq([...input.evidenceRefs,...sharedRefs]);
      value[name]={score:input.score,confidence:input.confidence,evidenceRefs:refs};
      minConfidence=Math.min(minConfidence,input.confidence);
    }
    const refs=uniq([...sharedRefs,...Object.values(value).flatMap((x)=>x.evidenceRefs)]);
    return createFieldState({
      value,
      confidence:Object.keys(value).length?minConfidence:0,
      evidenceRefs:refs,
      observationClass:Object.keys(value).length?ObservationClass.INFERRED:ObservationClass.UNKNOWN,
      revision,
      metadata:{
        sceneScoped:true,
        canonical:false,
        dimensions:DIMENSIONS,
        expiresAfterRevision:Number(revision)+this.ttlRevisions,
        proseStyleAuthority:false,
        factCreationAuthority:false,
        settlementAuthority:false,
        recursiveValidationAllowed:false,
      },
    });
  }
}

export { DIMENSIONS as AtmosphereDimensions };
