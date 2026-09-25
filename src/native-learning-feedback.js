const clone=(value)=>value==null?value:structuredClone(value);
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

export class NativeLearningFeedback{
  constructor({maxTurns=256,maxChannels=64,snapshot=null}={}){
    this.maxTurns=Math.max(16,Number(maxTurns)||256);
    this.maxChannels=Math.max(8,Number(maxChannels)||64);
    this.channels=new Map();
    this.turns=[];
    this.sequence=0;
    if(snapshot)this.restoreState(snapshot);
  }

  observeTurn({turnId,candidateEnvelope=null,publicationAssessment=null,cognitiveChoiceReceipt=null,packet=null}={}){
    const admitted=new Set([
      ...(publicationAssessment?.admittedCandidateIds??[]),
      ...(publicationAssessment?.supportCandidateIds??[]),
    ]);
    const candidates=candidateEnvelope?.candidates??[];
    const perChannel=new Map();
    for(const candidate of candidates){
      const channels=[...new Set((candidate.channelNominations??[]).map(x=>x.channelId).filter(Boolean))];
      for(const channelId of channels){
        const row=perChannel.get(channelId)??{attempts:0,admitted:0,rejected:0,stale:0};
        row.attempts+=1;
        if(candidate.freshness==='STALE')row.stale+=1;
        else if(admitted.has(candidate.candidateId))row.admitted+=1;
        else row.rejected+=1;
        perChannel.set(channelId,row);
      }
    }
    for(const [channelId,delta] of perChannel){
      const row=this.channels.get(channelId)??{channelId,attempts:0,admitted:0,rejected:0,stale:0,lastSequence:0};
      row.attempts+=delta.attempts;row.admitted+=delta.admitted;row.rejected+=delta.rejected;row.stale+=delta.stale;row.lastSequence=++this.sequence;
      this.channels.set(channelId,row);
    }
    const receipt={
      kind:'NativeLearningFeedbackReceipt',turnId:String(turnId??''),sequence:++this.sequence,
      channelOutcomes:[...perChannel.entries()].map(([channelId,row])=>({channelId,...row,bias:this.biasFor(channelId)})),
      admittedCandidateIds:[...admitted].sort(),
      reasonCodes:[...(cognitiveChoiceReceipt?.reasonCodes??[])],
      finalEvidenceRefs:[...(cognitiveChoiceReceipt?.finalEvidenceRefs??[])],
      packetDependencies:[...(packet?.dependencies??[])],
      canonicalMutationAuthority:false,settlementAuthority:false,
      policyEffect:'RETRIEVAL_RANK_BIAS_ONLY',
    };
    this.turns.push(receipt);if(this.turns.length>this.maxTurns)this.turns.splice(0,this.turns.length-this.maxTurns);
    this.#enforceChannelBound();
    return clone(receipt);
  }

  biasFor(channelId){
    const row=this.channels.get(String(channelId));if(!row||!row.attempts)return 0;
    const posterior=(row.admitted+1)/(row.attempts+2);
    const stalePenalty=row.stale/Math.max(1,row.attempts);
    return Number(clamp((posterior-.5)*.2-stalePenalty*.1,-.15,.15).toFixed(6));
  }

  channelStatus(){
    return [...this.channels.values()].map(row=>({...clone(row),bias:this.biasFor(row.channelId)})).sort((a,b)=>a.channelId.localeCompare(b.channelId));
  }

  diagnostics(){
    return{kind:'NativeLearningFeedbackDiagnostics',turns:this.turns.length,channels:this.channelStatus(),maxTurns:this.maxTurns,maxChannels:this.maxChannels,canonicalMutationAuthority:false,settlementAuthority:false};
  }

  exportState(){return clone({kind:'NativeLearningFeedbackSnapshot',maxTurns:this.maxTurns,maxChannels:this.maxChannels,sequence:this.sequence,channels:[...this.channels.entries()],turns:this.turns});}

  restoreState(snapshot){
    if(!snapshot||snapshot.kind!=='NativeLearningFeedbackSnapshot')throw new TypeError('NativeLearningFeedbackSnapshot is required');
    this.maxTurns=Math.max(16,Number(snapshot.maxTurns??this.maxTurns));this.maxChannels=Math.max(8,Number(snapshot.maxChannels??this.maxChannels));
    this.sequence=Number(snapshot.sequence??0);this.channels=new Map(clone(snapshot.channels??[]));this.turns=clone(snapshot.turns??[]).slice(-this.maxTurns);this.#enforceChannelBound();return this.exportState();
  }

  #enforceChannelBound(){
    while(this.channels.size>this.maxChannels){
      const oldest=[...this.channels.values()].sort((a,b)=>a.lastSequence-b.lastSequence||a.channelId.localeCompare(b.channelId))[0];
      if(!oldest)break;this.channels.delete(oldest.channelId);
    }
  }
}
