import { TelemetryEvent } from './constants.js';

const BLOCKED_KEYS=new Set(['prompt','rawPrompt','rawResponse','fullResponse','payload','messages','candidateBodies']);
const DEFAULT_BOUNDS=Object.freeze({maxDepth:5,maxKeys:64,maxArray:64,maxString:768});

export class CoprocessorTelemetry {
  #subscribers = new Set();
  #events = [];
  constructor({ limit = 2000, bounds = {} } = {}) {
    this.limit = Math.max(1, Number(limit) || 2000);
    this.bounds={...DEFAULT_BOUNDS,...bounds};
  }

  emit(type, payload = {}) {
    if (!Object.values(TelemetryEvent).includes(type)) throw new TypeError(`Unknown coprocessor telemetry event: ${type}`);
    let safePayload;
    try{safePayload=sanitize(payload,this.bounds);}
    catch{safePayload={telemetryError:'SANITIZE_FAILED'};}
    const event = Object.freeze({type,payload:Object.freeze(safePayload)});
    this.#events.push(event);
    if (this.#events.length > this.limit) this.#events.splice(0,this.#events.length-this.limit);
    for (const handler of [...this.#subscribers]) { try { handler(event); } catch {} }
    return event;
  }

  subscribe(handler) {
    if(typeof handler!=='function')throw new TypeError('telemetry subscriber must be a function');
    this.#subscribers.add(handler);
    return () => this.#subscribers.delete(handler);
  }
  list() { return [...this.#events]; }
}

export function emitTelemetry(telemetry,type,payload={}){
  if(!telemetry||typeof telemetry.emit!=='function')return null;
  try{return telemetry.emit(type,payload);}catch{return null;}
}

function sanitize(payload,bounds,depth=0,seen=new WeakSet()) {
  if(payload==null||typeof payload==='number'||typeof payload==='boolean')return payload;
  if(typeof payload==='string')return payload.length>bounds.maxString?`${payload.slice(0,bounds.maxString)}…[clipped]`:payload;
  if(typeof payload==='bigint')return String(payload);
  if(typeof payload!=='object')return String(payload);
  if(depth>=bounds.maxDepth)return '[depth-clipped]';
  if(seen.has(payload))return '[circular]';
  seen.add(payload);
  if(Array.isArray(payload)){
    const out=payload.slice(0,bounds.maxArray).map(value=>sanitize(value,bounds,depth+1,seen));
    if(payload.length>bounds.maxArray)out.push(`[+${payload.length-bounds.maxArray} items clipped]`);
    return out;
  }
  const safe={};let count=0;
  for(const [key,value] of Object.entries(payload)){
    if(BLOCKED_KEYS.has(key))continue;
    if(count>=bounds.maxKeys){safe.__clippedKeys=Object.keys(payload).length-count;break;}
    safe[key]=sanitize(value,bounds,depth+1,seen);count+=1;
  }
  return safe;
}
