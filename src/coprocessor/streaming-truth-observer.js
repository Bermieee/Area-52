export class StreamingTruthObserver {
  constructor({deterministicCheck,semanticVerifier=null,minClauseChars=8,maxBufferChars=4096}={}){
    if(typeof deterministicCheck!=='function')throw new TypeError('deterministicCheck is required');
    this.deterministicCheck=deterministicCheck;this.semanticVerifier=semanticVerifier;this.minClauseChars=Math.max(1,Number(minClauseChars)||8);
    this.maxBufferChars=Math.max(this.minClauseChars,Number(maxBufferChars)||4096);this.buffer='';
  }
  async push(text,context={}){
    const releasedText=String(text??'');this.buffer=(this.buffer+releasedText).slice(-this.maxBufferChars);
    const parts=this.buffer.split(/(?<=[.!?])\s+/);const complete=[];
    if(/[.!?]\s*$/.test(this.buffer)){complete.push(...parts);this.buffer='';}
    else{this.buffer=parts.pop()??'';complete.push(...parts);}
    const observations=[];
    for(const raw of complete){const claim=raw.trim();if(claim.length<this.minClauseChars)continue;let result=await this.deterministicCheck(claim,context);
      if(result?.classification==='AMBIGUOUS'&&typeof this.semanticVerifier==='function')result=await this.semanticVerifier(claim,context,result);
      observations.push({kind:'StreamingTruthObservation',mode:'OBSERVE',claim,classification:result?.classification??'UNRESOLVED',
        confidence:Number(result?.confidence??0),reason:result?.reason??null,worldRevision:context.worldRevision??null,sceneRevision:context.sceneRevision??null,
        intercepted:false});}
    return{mode:'OBSERVE',releasedText,intercepted:false,observations};
  }
  async flush(context={}){if(!this.buffer.trim())return{mode:'OBSERVE',releasedText:'',intercepted:false,observations:[]};const pending=this.buffer;this.buffer='';
    if(pending.trim().length<this.minClauseChars)return{mode:'OBSERVE',releasedText:'',intercepted:false,observations:[]};
    const result=await this.deterministicCheck(pending.trim(),context);return{mode:'OBSERVE',releasedText:'',intercepted:false,observations:[{kind:'StreamingTruthObservation',
      mode:'OBSERVE',claim:pending.trim(),classification:result?.classification??'UNRESOLVED',confidence:Number(result?.confidence??0),reason:result?.reason??null,
      worldRevision:context.worldRevision??null,sceneRevision:context.sceneRevision??null,intercepted:false}]};}
}
