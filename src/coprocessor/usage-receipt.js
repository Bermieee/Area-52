export function normalizeProviderUsageReceipt({usage={},providerProfileId=null,capability=null,latencyMs=0,pricing=null}={}){
  const inputUnits=number(usage.input_tokens??usage.prompt_tokens??usage.inputUnits??0);
  const outputUnits=number(usage.output_tokens??usage.completion_tokens??usage.outputUnits??0);
  const cacheHitUnits=number(usage.cache_hit_tokens??usage.cached_tokens??usage.prompt_tokens_details?.cached_tokens??usage.cacheHitUnits??0);
  let cost={status:'NOT_MEASURED',value:null,reason:'deterministic pricing metadata not configured'};
  if(pricing&&Number.isFinite(Number(pricing.inputPerMillion))&&Number.isFinite(Number(pricing.outputPerMillion))){
    const value=(inputUnits/1e6)*Number(pricing.inputPerMillion)+(outputUnits/1e6)*Number(pricing.outputPerMillion);
    cost={status:'MEASURED',value};
  }
  return Object.freeze({kind:'ProviderUsageReceipt',inputUnits,outputUnits,cacheHitUnits,latencyMs:number(latencyMs),providerProfileId,capability,cost:Object.freeze(cost)});
}
function number(value){const n=Number(value);return Number.isFinite(n)&&n>=0?n:0;}
