import { PromptSlot,RepresentationMode,DeliveryStatus,stableDeliveryString } from './adaptive-context-contracts.js';
import { sliceFactSection } from './adaptive-context-sections.js';

export class DeterministicApproxTokenEstimator{
  constructor({id='deterministic-approx-v1',charsPerToken=4}={}){this.id=id;this.charsPerToken=charsPerToken;this.exact=false;}
  estimate(value){const text=typeof value==='string'?value:stableDeliveryString(value);return Math.max(1,Math.ceil(text.length/this.charsPerToken));}
}

const intentWeights={
  LOCATION:{[PromptSlot.CURRENT_WORLD_STATE]:8,[PromptSlot.HISTORICAL_SUPPORT]:6,[PromptSlot.UNRESOLVED_EVIDENCE]:8,[PromptSlot.CURRENT_SCENE]:5,[PromptSlot.RELEVANT_LORE]:3,[PromptSlot.CHARACTER_FOUNDATION]:1},
  CURRENT:{[PromptSlot.CURRENT_WORLD_STATE]:7,[PromptSlot.CURRENT_CHARACTER_STATE]:6,[PromptSlot.UNRESOLVED_EVIDENCE]:7,[PromptSlot.CURRENT_SCENE]:6,[PromptSlot.HISTORICAL_SUPPORT]:4},
  CHARACTER:{[PromptSlot.CURRENT_CHARACTER_STATE]:8,[PromptSlot.CHARACTER_FOUNDATION]:8,[PromptSlot.RELEVANT_LORE]:6,[PromptSlot.CURRENT_SCENE]:4,[PromptSlot.CURRENT_WORLD_STATE]:2},
  DESCRIPTION:{[PromptSlot.CURRENT_CHARACTER_STATE]:7,[PromptSlot.CHARACTER_FOUNDATION]:8,[PromptSlot.RELEVANT_LORE]:7,[PromptSlot.HISTORICAL_SUPPORT]:2},DEFAULT:{},
};
function normalizedIntent(intent='DEFAULT',userInput=''){const x=String(intent).toUpperCase();if(intentWeights[x])return x;const q=String(userInput).toLowerCase();if(/where|location|find/.test(q))return'LOCATION';if(/describe|appearance|personality|character/.test(q))return'DESCRIPTION';return'DEFAULT';}

export class AdaptiveBudgetAllocator{
  constructor({estimator=new DeterministicApproxTokenEstimator()}={}){this.estimator=estimator;}
  allocate({sections,profile,intent='DEFAULT',userInput='',budgetTokens=null}){
    const total=Math.min(profile.contextWindow,budgetTokens!==null&&budgetTokens!==undefined&&Number.isFinite(Number(budgetTokens))?Math.max(1,Math.floor(Number(budgetTokens))):profile.contextWindow),available=Math.max(0,total-profile.reservedTokens);
    const intentKey=normalizedIntent(intent,userInput),weights=intentWeights[intentKey]??intentWeights.DEFAULT;
    const measured=sections.map(section=>{const compactTokens=this.estimator.estimate(section.compactText),richTokens=this.estimator.estimate(section.richText),weight=(weights[section.slot]??2)+Number(profile.sectionAllocationWeights?.[section.slot]??0)+Math.max(0,Number(section.priority??0));return{...section,compactTokens,richTokens,weight};});
    const protectedRows=measured.filter(x=>x.protected),optionalRows=measured.filter(x=>!x.protected),protectedFloor=protectedRows.reduce((sum,x)=>sum+x.compactTokens,0),targetPool=Math.max(0,available-protectedFloor),weightTotal=measured.reduce((sum,x)=>sum+x.weight,0)||1;
    const targetsBySlot=Object.fromEntries(measured.map(x=>[x.slot,(x.protected?x.compactTokens:0)+Math.floor(targetPool*(x.weight/weightTotal))]));
    if(protectedFloor>available)return{ok:false,status:DeliveryStatus.DELIVERY_BUDGET_UNSATISFIABLE,intent:intentKey,budget:{available,total,reserved:profile.reservedTokens,protected:protectedFloor,allocated:0,remaining:available,targetsBySlot},sections:[],dropped:[],deferred:optionalRows.map(x=>x.slot),fallbackDecisions:['PROTECTED_MINIMUM_EXCEEDS_AVAILABLE']};
    const score=(row)=>(row.weight*1000)/Math.max(1,row.compactTokens),orderedOptional=[...optionalRows].sort((a,b)=>score(b)-score(a)||a.slot.localeCompare(b.slot));
    // Admission is semantic; richness is presentation. First admit every section that can
    // fit in its minimum COMPACT representation, then spend remaining headroom on RICH
    // serialization. This prevents rich protected presentation from evicting optional Lore.
    let remaining=available-protectedFloor;const decisions=[],partialDeferrals=[];
    for(const row of protectedRows)decisions.push({...row,representation:RepresentationMode.COMPACT,allocatedTokens:row.compactTokens,targetTokens:targetsBySlot[row.slot]??row.compactTokens,remainingTokensAtDecision:remaining,minimumTokens:row.compactTokens});
    for(const row of orderedOptional){
      const remainingTokensAtDecision=remaining;let representation=RepresentationMode.OMITTED,used=0,admitted=row;
      if(row.compactTokens<=remaining){representation=RepresentationMode.COMPACT;used=row.compactTokens;remaining-=used;}
      else if((row.slot===PromptSlot.RELEVANT_LORE||row.slot===PromptSlot.RECENT_NARRATIVE)&&Array.isArray(row.content)&&row.content.length>1&&remaining>0){
        // Lore keeps its highest-ranked leading entries; recent narrative keeps its newest trailing messages.
        const fromEnd=row.slot===PromptSlot.RECENT_NARRATIVE;
        let partial=null;
        const tryCount=(count)=>{const section=sliceFactSection(row,count,{fromEnd}),compactTokens=this.estimator.estimate(section.compactText);return compactTokens<=remaining?{section,compactTokens,count}:null;};
        if(this.estimator.constructor===DeterministicApproxTokenEstimator){
          // The largest count that fits, found by bisection instead of re-rendering every shorter slice (quadratic on long
          // chats: ~1.5 s for 438 messages). Same answer as the downward scan: a slice's compact text is the JSON array of
          // independently compacted elements, so its length, and this estimator's ceil(length / charsPerToken), never
          // decreases as elements are added. Other estimators keep the scan.
          let lo=1,hi=row.content.length-1;
          while(lo<=hi){const mid=(lo+hi)>>1,fit=tryCount(mid);if(fit){partial=fit;lo=mid+1;}else hi=mid-1;}
        }else{
          for(let count=row.content.length-1;count>=1;count-=1){const fit=tryCount(count);if(fit){partial=fit;break;}}
        }
        if(partial)partial.richTokens=this.estimator.estimate(partial.section.richText);
        if(partial){
          admitted={...partial.section,compactTokens:partial.compactTokens,richTokens:partial.richTokens,weight:row.weight};
          representation=RepresentationMode.COMPACT;used=partial.compactTokens;remaining-=used;
          partialDeferrals.push({
            slot:row.slot,reason:'OPTIONAL_SECTION_PARTIAL_REMAINDER_EXCEEDS_BUDGET',reasonClass:'BUDGET_CAPACITY',legacyReason:'OPTIONAL_DEFERRED_BY_BUDGET',
            requiredTokens:row.compactTokens,admittedTokens:used,remainingTokensAtDecision,shortfallTokens:Math.max(0,row.compactTokens-remainingTokensAtDecision),
            targetTokens:targetsBySlot[row.slot]??Math.max(0,used),priority:Number(row.priority??0),partial:true,
            originalEntryCount:row.content.length,admittedEntryCount:partial.count,deferredEntryCount:row.content.length-partial.count,
          });
        }
      }
      decisions.push({...admitted,representation,allocatedTokens:used,targetTokens:targetsBySlot[row.slot]??Math.max(0,used),remainingTokensAtDecision,minimumTokens:admitted.compactTokens});
    }
    if(profile.structuredContextPreference==='RICH'){
      const enrichment=[...decisions].filter(row=>row.representation!==RepresentationMode.OMITTED).sort((a,b)=>Number(b.protected)-Number(a.protected)||b.weight-a.weight||a.slot.localeCompare(b.slot));
      for(const row of enrichment){const extra=Math.max(0,row.richTokens-row.compactTokens);if(extra<=remaining){const index=decisions.findIndex(item=>item.slot===row.slot);decisions[index]={...decisions[index],representation:RepresentationMode.RICH,allocatedTokens:row.richTokens};remaining-=extra;}}
    }
    const bySlot=new Map(decisions.map(x=>[x.slot,x])),ordered=sections.map(x=>bySlot.get(x.slot)).filter(Boolean),omitted=ordered.filter(x=>x.representation===RepresentationMode.OMITTED);
    const omission=(x,reason)=>({slot:x.slot,reason,reasonClass:'BUDGET_CAPACITY',legacyReason:Number(x.priority??0)>=5?'OPTIONAL_DEFERRED_BY_BUDGET':'OPTIONAL_BUDGET_PRESSURE',requiredTokens:x.compactTokens,remainingTokensAtDecision:x.remainingTokensAtDecision,shortfallTokens:Math.max(0,x.compactTokens-x.remainingTokensAtDecision),targetTokens:x.targetTokens,priority:Number(x.priority??0)});
    const dropped=omitted.filter(x=>Number(x.priority??0)<5).map(x=>omission(x,'OPTIONAL_SECTION_MINIMUM_EXCEEDS_REMAINING_BUDGET')),deferred=[...omitted.filter(x=>Number(x.priority??0)>=5).map(x=>omission(x,'OPTIONAL_SECTION_MINIMUM_EXCEEDS_REMAINING_BUDGET')),...partialDeferrals],fallbackDecisions=[];
    if(ordered.some(x=>x.representation===RepresentationMode.COMPACT&&profile.structuredContextPreference==='RICH'))fallbackDecisions.push('COMPACT_SAFE_REPRESENTATION');if(dropped.length)fallbackDecisions.push('DROP_OPTIONAL_MATERIAL');if(partialDeferrals.length)fallbackDecisions.push('PARTIAL_OPTIONAL_LORE_BY_BUDGET');if(deferred.length)fallbackDecisions.push('DEFER_OPTIONAL_MATERIAL');const allocated=ordered.reduce((sum,x)=>sum+x.allocatedTokens,0);
    return{ok:true,status:DeliveryStatus.READY,intent:intentKey,budget:{available,total,reserved:profile.reservedTokens,protected:protectedFloor,allocated,remaining:Math.max(0,available-allocated),targetsBySlot},sections:ordered,dropped,deferred,fallbackDecisions};
  }
}
