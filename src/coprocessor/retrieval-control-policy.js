export const RetrievalQuality=Object.freeze({HIGH:'HIGH',MIXED:'MIXED',LOW:'LOW'});

export function retrievalControlDecision({
  quality,
  simpleTurn=false,
  correctiveAttempt=0,
  maxCorrectiveAttempts=1,
}={}){
  if(simpleTurn)return Object.freeze({action:'SKIP',reason:'HOT_COGNITION_SUFFICIENT',allowLongTermMemory:false,corrective:false});
  if(quality===RetrievalQuality.HIGH)return Object.freeze({action:'PROCEED',reason:'HIGH_QUALITY',allowLongTermMemory:true,corrective:false});
  if(quality===RetrievalQuality.MIXED&&Number(correctiveAttempt)<Math.max(0,Number(maxCorrectiveAttempts))){
    return Object.freeze({action:'CORRECTIVE_RETRIEVAL',reason:'MIXED_QUALITY',allowLongTermMemory:false,corrective:true,nextAttempt:Number(correctiveAttempt)+1});
  }
  if(quality===RetrievalQuality.MIXED)return Object.freeze({action:'NO_LONG_TERM_MEMORY',reason:'CORRECTIVE_BUDGET_EXHAUSTED',allowLongTermMemory:false,corrective:false});
  if(quality===RetrievalQuality.LOW)return Object.freeze({action:'NO_LONG_TERM_MEMORY',reason:'LOW_QUALITY',allowLongTermMemory:false,corrective:false});
  throw new TypeError('quality must be HIGH, MIXED or LOW');
}
