import {RetrievalIndexFamily,createIndexedArtifactRepresentation,stableRepresentationId} from './retrieval-index-contracts.js';
import {stableHash} from './browser-runtime-utils.js';

const TOKENS=/[a-z0-9_'-]+/g;
const tokenize=(text)=>String(text??'').toLowerCase().match(TOKENS)??[];
const counts=(tokens)=>{const out={};for(const token of tokens)out[token]=(out[token]??0)+1;return out;};
function denseVector(text,dimension=16){
  const vector=Array(dimension).fill(0);
  for(const token of tokenize(text)){
    const hex=stableHash(token,{length:16,alreadyString:true});
    const a=parseInt(hex.slice(0,8),16)>>>0,b=parseInt(hex.slice(8,16),16)>>>0;
    const index=a%dimension,sign=(b&1)?1:-1,weight=1+((b>>>1)%1000)/1000;vector[index]+=sign*weight;
  }
  const norm=Math.sqrt(vector.reduce((s,x)=>s+x*x,0))||1;
  return vector.map(x=>Number((x/norm).toFixed(8)));
}

export class DeterministicRetrievalRepresentationProvider{
  constructor({providerId='deterministic-representation-v1',denseDimension=16}={}){this.providerId=providerId;this.denseDimension=denseDimension;}
  represent(artifact,{indexFamily,adapterId,indexVersion}={}){
    const text=artifact.text??artifact.metadata?.representationText??artifact.semanticKey??artifact.artifactId;
    let representationData;
    if(indexFamily===RetrievalIndexFamily.SPARSE){
      const map=counts(tokenize(text));representationData={terms:Object.keys(map).sort().map(term=>({term,count:map[term]})),providerId:this.providerId};
    }else if(indexFamily===RetrievalIndexFamily.DENSE){
      representationData={vector:denseVector(text,this.denseDimension),dimension:this.denseDimension,providerId:this.providerId};
    }else{
      representationData={payload:String(text??''),providerId:this.providerId};
    }
    return createIndexedArtifactRepresentation({
      representationId:stableRepresentationId({adapterId,indexFamily,artifactId:artifact.artifactId,semanticKey:artifact.semanticKey,claimRefs:artifact.claimRefs,eventRefs:artifact.eventRefs}),
      representationRevision:artifact.artifactRevision,indexFamily,ownerArtifactId:artifact.artifactId,ownerArtifactRevision:artifact.artifactRevision,
      sourceId:artifact.sourceId,sourceRevision:artifact.sourceRevision,entityRefs:artifact.entityRefs,conceptRefs:artifact.metadata?.conceptRefs??[],
      claimRefs:artifact.claimRefs,eventRefs:artifact.eventRefs,relationshipRefs:artifact.relationshipRefs,
      authorityClass:artifact.authorityClass,truthStatusHint:artifact.truthStatusHint,provenanceRefs:artifact.provenanceRefs,
      dependencyInvalidators:artifact.dependencyInvalidators,indexAdapter:adapterId,indexVersion,
      representationData,representationText:String(text??''),semanticKey:artifact.semanticKey,
      metadata:{representationProvider:this.providerId,artifactType:artifact.artifactType},
    });
  }
  representQuery(text,indexFamily){
    if(indexFamily===RetrievalIndexFamily.SPARSE)return{terms:Object.keys(counts(tokenize(text))).sort()};
    if(indexFamily===RetrievalIndexFamily.DENSE)return{vector:denseVector(text,this.denseDimension),dimension:this.denseDimension};
    return{payload:String(text??'')};
  }
}
