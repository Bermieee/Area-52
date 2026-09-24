import { TelemetryEvent } from './constants.js';
import { emitTelemetry } from './telemetry.js';

export const ProviderHealthState=Object.freeze({
  HEALTHY:'HEALTHY',DEGRADED:'DEGRADED',SATURATED:'SATURATED',UNAVAILABLE:'UNAVAILABLE',COOLDOWN:'COOLDOWN',PROBE:'PROBE',
});

export class ProviderHealthModel {
  #profiles=new Map();
  constructor({windowSize=20,degradedFailureRate=.25,cooldownFailureRate=.5,cooldownMs=30000,telemetry=null}={}){
    this.windowSize=Math.max(4,Number(windowSize)||20);
    this.degradedFailureRate=clamp(degradedFailureRate);
    this.cooldownFailureRate=Math.max(this.degradedFailureRate,clamp(cooldownFailureRate));
    this.cooldownMs=Math.max(1,Number(cooldownMs)||30000);
    this.telemetry=telemetry;
  }
  register(providerProfileId,{maxConcurrency=1,manualDisabled=false}={}){
    if(typeof providerProfileId!=='string'||!providerProfileId)throw new TypeError('providerProfileId is required');
    if(this.#profiles.has(providerProfileId))throw new Error(`Provider health already registered: ${providerProfileId}`);
    this.#profiles.set(providerProfileId,{providerProfileId,maxConcurrency:Math.max(1,Number(maxConcurrency)||1),activeConcurrency:0,manualDisabled:Boolean(manualDisabled),state:manualDisabled?ProviderHealthState.UNAVAILABLE:ProviderHealthState.HEALTHY,cooldownUntil:null,events:[]});
    return this.snapshot(providerProfileId);
  }
  setManualDisabled(providerProfileId,disabled,{now=0}={}){
    const row=this.#required(providerProfileId);row.manualDisabled=Boolean(disabled);row.cooldownUntil=null;
    row.state=row.manualDisabled?ProviderHealthState.UNAVAILABLE:this.#derive(row,now);this.#emit(row);return this.snapshot(providerProfileId);
  }
  setConcurrency(providerProfileId,activeConcurrency,{now=0}={}){
    const row=this.#required(providerProfileId);row.activeConcurrency=Math.max(0,Number(activeConcurrency)||0);row.state=this.#derive(row,now);this.#emit(row);return this.snapshot(providerProfileId);
  }
  markUnavailable(providerProfileId,{now=0}={}){
    const row=this.#required(providerProfileId);row.events.push({failed:true,reason:'UNAVAILABLE',now:Number(now)||0});this.#trim(row);row.state=ProviderHealthState.UNAVAILABLE;this.#emit(row);return this.snapshot(providerProfileId);
  }
  observe(providerProfileId,{outcome='SUCCESS',timeout=false,validationFailure=false,transportFailure=false,rateLimited=false,activeConcurrency=null,manualDisabled=null,latencyMs=null,now=0}={}){
    const row=this.#required(providerProfileId);if(activeConcurrency!=null)row.activeConcurrency=Math.max(0,Number(activeConcurrency)||0);if(manualDisabled!=null)row.manualDisabled=Boolean(manualDisabled);
    const failed=String(outcome).toUpperCase()!=='SUCCESS'||timeout||validationFailure||transportFailure||rateLimited;
    row.events.push({failed,timeout:Boolean(timeout),validationFailure:Boolean(validationFailure),transportFailure:Boolean(transportFailure),rateLimited:Boolean(rateLimited),latencyMs:finiteOrNull(latencyMs),now:Number(now)||0});this.#trim(row);
    if(rateLimited||this.#failureRate(row)>=this.cooldownFailureRate){row.cooldownUntil=(Number(now)||0)+this.cooldownMs;row.state=ProviderHealthState.COOLDOWN;}
    else row.state=this.#derive(row,now);
    this.#emit(row);return this.snapshot(providerProfileId);
  }
  beginProbe(providerProfileId,{now=0}={}){
    const row=this.#required(providerProfileId);if(row.manualDisabled)return this.snapshot(providerProfileId);
    if(row.state===ProviderHealthState.COOLDOWN && Number(now)<Number(row.cooldownUntil??0))return this.snapshot(providerProfileId);
    row.state=ProviderHealthState.PROBE;this.#emit(row);return this.snapshot(providerProfileId);
  }
  completeProbe(providerProfileId,{success,now=0}={}){
    const row=this.#required(providerProfileId);row.cooldownUntil=null;
    if(success){row.events=[];row.state=ProviderHealthState.HEALTHY;}
    else {row.events.push({failed:true,reason:'PROBE_FAILED',now:Number(now)||0});this.#trim(row);row.cooldownUntil=(Number(now)||0)+this.cooldownMs;row.state=ProviderHealthState.COOLDOWN;}
    this.#emit(row);return this.snapshot(providerProfileId);
  }
  snapshot(providerProfileId=null){
    if(providerProfileId!=null){const row=this.#required(providerProfileId);return freeze(row,this.#failureRate(row));}
    return Object.freeze([...this.#profiles.values()].map((row)=>freeze(row,this.#failureRate(row))));
  }
  #derive(row,now){
    if(row.manualDisabled)return ProviderHealthState.UNAVAILABLE;
    if(row.state===ProviderHealthState.COOLDOWN && Number(now)<Number(row.cooldownUntil??0))return ProviderHealthState.COOLDOWN;
    if(row.activeConcurrency>=row.maxConcurrency)return ProviderHealthState.SATURATED;
    return this.#failureRate(row)>=this.degradedFailureRate?ProviderHealthState.DEGRADED:ProviderHealthState.HEALTHY;
  }
  #failureRate(row){return row.events.length?row.events.filter((x)=>x.failed).length/row.events.length:0;}
  #trim(row){if(row.events.length>this.windowSize)row.events.splice(0,row.events.length-this.windowSize);}
  #required(id){const row=this.#profiles.get(id);if(!row)throw new Error(`Unknown provider health profile: ${id}`);return row;}
  #emit(row){emitTelemetry(this.telemetry,TelemetryEvent.PROVIDER_HEALTH,{providerProfileId:row.providerProfileId,health:row.state,activeConcurrency:row.activeConcurrency,maxConcurrency:row.maxConcurrency,failureRate:this.#failureRate(row)});}
}
function freeze(row,failureRate){return Object.freeze({providerProfileId:row.providerProfileId,health:row.state,availability:row.manualDisabled?'UNAVAILABLE':'AVAILABLE',activeConcurrency:row.activeConcurrency,maxConcurrency:row.maxConcurrency,cooldownUntil:row.cooldownUntil,failureRate,manualDisabled:row.manualDisabled});}
function clamp(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;}
function finiteOrNull(value){if(value==null)return null;const n=Number(value);return Number.isFinite(n)?n:null;}
