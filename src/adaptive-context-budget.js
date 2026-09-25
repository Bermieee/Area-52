import { PromptSlot,RepresentationMode,DeliveryStatus,stableDeliveryString } from './adaptive-context-contracts.js';

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
    // Admission is semantic; richness is presentation. Admit as many compact sections as
    // the budget permits before spending any headroom on richer serialization. This
    // prevents a rich protected section from evicting optional material that would have
    // fit safely in compact form.
    let remaining=available-protectedFloor;const decisions=[];
    for(const row of protectedRows)decisions.push({...row,representation:RepresentationMode.COMPACT,allocatedTokens:row.compactTokens,targetTokens:targetsBySlot[row.slot]??row.compactTokens});
    for(const row of orderedOptional){
      let representation=RepresentationMode.OMITTED,used=0;
      if(row.compactTokens<=remaining){representation=RepresentationMode.COMPACT;used=row.compactTokens;remaining-=used;}
      decisions.push({...row,representation,allocatedTokens:used,targetTokens:targetsBySlot[row.slot]??Math.max(0,used)});
    }
    if(profile.structuredContextPreference==='RICH'){
      const enrichment=[...decisions].filter(row=>row.representation!==RepresentationMode.OMITTED)
        .sort((a,b)=>Number(b.protected)-Number(a.protected)||b.weight-a.weight||a.slot.localeCompare(b.slot));
      for(const row of enrichment){
        const extra=Math.max(0,row.richTokens-row.compactTokens);
        if(extra<=remaining){
          const index=decisions.findIndex(item=>item.slot===row.slot);
          decisions[index]={...decisions[index],representation:RepresentationMode.RICH,allocatedTokens:row.richTokens};
          remaining-=extra;
        }
      }
    }
    const bySlot=new Map(decisions.map(x=>[x.slot,x])),ordered=sections.map(x=>bySlot.get(x.slot)).filter(Boolean),omitted=ordered.filter(x=>x.representation===RepresentationMode.OMITTED),dropped=omitted.filter(x=>Number(x.priority??0)<5).map(x=>({slot:x.slot,reason:'OPTIONAL_BUDGET_PRESSURE'})),deferred=omitted.filter(x=>Number(x.priority??0)>=5).map(x=>({slot:x.slot,reason:'OPTIONAL_DEFERRED_BY_BUDGET'})),fallbackDecisions=[];
    if(ordered.some(x=>x.representation===RepresentationMode.COMPACT&&profile.structuredContextPreference==='RICH'))fallbackDecisions.push('COMPACT_SAFE_REPRESENTATION');if(dropped.length)fallbackDecisions.push('DROP_OPTIONAL_MATERIAL');if(deferred.length)fallbackDecisions.push('DEFER_OPTIONAL_MATERIAL');const allocated=ordered.reduce((sum,x)=>sum+x.allocatedTokens,0);
    return{ok:true,status:DeliveryStatus.READY,intent:intentKey,budget:{available,total,reserved:profile.reservedTokens,protected:protectedFloor,allocated,remaining:Math.max(0,available-allocated),targetsBySlot},sections:ordered,dropped,deferred,fallbackDecisions};
  }
}
