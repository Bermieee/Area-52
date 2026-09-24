export const clone=(value)=>value===undefined?undefined:structuredClone(value);
export const freeze=(value)=>Object.freeze(value);
export const enumSet=(value)=>new Set(Object.values(value));
export const req=(value,name)=>{if(typeof value!=='string'||!value.trim())throw new TypeError(`${name} must be a non-empty string`);return value;};
export const strings=(value,name)=>{if(!Array.isArray(value)||value.some(x=>typeof x!=='string'||!x))throw new TypeError(`${name} must be an array of non-empty strings`);return [...value];};
export const array=(value,name)=>{if(!Array.isArray(value))throw new TypeError(`${name} must be an array`);return clone(value);};
export const serial=(value,name)=>{try{JSON.stringify(value);}catch{throw new TypeError(`${name} must be JSON-serializable`);}return clone(value);};
export const oneOf=(value,set,name)=>{if(!set.has(value))throw new TypeError(`${name} has unsupported value: ${value}`);return value;};
export function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
export const stableString=(value)=>JSON.stringify(stable(value));
export const equal=(a,b)=>stableString(a)===stableString(b);
export function normalizeNamedList(value,name){
  if(!Array.isArray(value))throw new TypeError(`${name} must be an array`);
  return value.map((row,index)=>{
    if(typeof row==='string')return{id:req(row,`${name}[${index}]`)};
    if(!row||typeof row!=='object')throw new TypeError(`${name}[${index}] must be a string or object`);
    const id=req(row.id??row.subsystemId??row.name,`${name}[${index}].id`);
    return{id,...serial(Object.fromEntries(Object.entries(row).filter(([k])=>!['id','subsystemId','name'].includes(k))),`${name}[${index}]`)};
  });
}
export class FrameworkError extends Error{
  constructor(code,message,details={}){super(message);this.name='FrameworkError';this.code=code;this.details=clone(details);}
}
