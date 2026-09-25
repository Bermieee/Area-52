import { stableHash,stableJson } from './browser-runtime-utils.js';
import { SealFallbackState,createContextSealReceipt } from './publication-contracts.js';

export function stablePacketString(value){return stableJson(value);}
export function hashPacket(value){return stableHash(stablePacketString(value),{alreadyString:true});}
function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.freeze(value);for(const key of Object.keys(value))deepFreeze(value[key]);return value;
}

export class GenerationContextSeal {
  #sealed=new Map();
  #sequence=0;

  isTurnSealed(turnId){return this.#sealed.has(turnId);}

  seal({
    turnId,correlationId,packet,sourceRevisionIds=packet.dependencies??[],worldRevision=0,sceneRevision=0,
    admittedResultIds=[],rejectedResultIds=[],staleResultIds=[],fallbackState=SealFallbackState.NONE,
    deadline=null,sealedAt=null,dependencies=packet.dependencies??[],
  }){
    const frozen=deepFreeze(structuredClone(packet));
    const packetHash=hashPacket(frozen);
    const existing=this.#sealed.get(turnId);
    if(existing){
      if(existing.receipt.packetHash!==packetHash)throw new Error(`Turn ${turnId} is already sealed with different packet content`);
      return{packet:existing.packet,receipt:structuredClone(existing.receipt),duplicate:true};
    }

    this.#sequence+=1;
    const receipt=createContextSealReceipt({
      id:`context-seal:${this.#sequence}:${turnId}`,turnId,correlationId,packetId:frozen.id,packetHash,
      sourceRevisionIds:[...new Set(sourceRevisionIds)].sort(),worldRevision,sceneRevision,
      admittedResultIds:[...new Set(admittedResultIds)].sort(),rejectedResultIds:[...new Set(rejectedResultIds)].sort(),
      staleResultIds:[...new Set(staleResultIds)].sort(),fallbackState,deadline,sequence:this.#sequence,sealedAt,
      dependencies:[...new Set(dependencies)].sort(),immutable:true,
    });
    const stored={packet:frozen,receipt:deepFreeze(structuredClone(receipt))};
    this.#sealed.set(turnId,stored);
    return{packet:stored.packet,receipt:structuredClone(receipt),duplicate:false};
  }

  getPacket(turnId){return this.#sealed.get(turnId)?.packet??null;}
  getReceipt(turnId){const r=this.#sealed.get(turnId)?.receipt;return r?structuredClone(r):null;}
  verify(turnId){
    const stored=this.#sealed.get(turnId);if(!stored)return{sealed:false,hashMatches:false};
    return{sealed:true,hashMatches:hashPacket(stored.packet)===stored.receipt.packetHash,packetHash:stored.receipt.packetHash};
  }
}
