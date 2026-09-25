const clone=(v)=>v==null?v:structuredClone(v);
const req=(v,n)=>{if(typeof v!=='string'||!v.trim())throw new TypeError(n+' must be a non-empty string');return v.trim();};
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
const parse=(v)=>{const m=String(v??'').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);return m?{major:Number(m[1]),minor:Number(m[2]??0),patch:Number(m[3]??0)}:null;};

export const ContractDriftStatus=Object.freeze({
  NO_CHANGE:'NO_CHANGE',
  COMPATIBLE_EXTENSION:'COMPATIBLE_EXTENSION',
  REQUIRES_ADAPTER:'REQUIRES_ADAPTER',
  BREAKING_CHANGE:'BREAKING_CHANGE',
  UNKNOWN:'UNKNOWN',
});

export function createPublicContractSnapshot({lane,checkpoint,accepted=false,contracts=[]}={}){
  return{
    kind:'PublicContractSnapshot',
    lane:req(lane,'lane'),
    checkpoint:req(checkpoint,'checkpoint'),
    accepted:Boolean(accepted),
    contracts:[...contracts].map(c=>({
      contractId:req(c.contractId??c.family,'contractId'),
      version:req(c.version??'1.0.0','version'),
      requiredFields:uniq(c.requiredFields??c.requiredFeatures),
      optionalFields:uniq(c.optionalFields??c.features),
      enumValues:Object.fromEntries(Object.entries(c.enumValues??{}).map(([k,v])=>[k,uniq(v)])),
      authorityRules:uniq(c.authorityRules),
      semantics:uniq(c.semantics),
    })).sort((a,b)=>a.contractId.localeCompare(b.contractId)),
  };
}

function cmpSet(oldValues,newValues){
  const a=new Set(oldValues??[]),b=new Set(newValues??[]);
  return{
    added:[...b].filter(x=>!a.has(x)).sort(),
    removed:[...a].filter(x=>!b.has(x)).sort(),
    same:a.size===b.size&&[...a].every(x=>b.has(x)),
  };
}
function mergeStatus(statuses){
  if(statuses.includes(ContractDriftStatus.BREAKING_CHANGE))return ContractDriftStatus.BREAKING_CHANGE;
  if(statuses.includes(ContractDriftStatus.UNKNOWN))return ContractDriftStatus.UNKNOWN;
  if(statuses.includes(ContractDriftStatus.REQUIRES_ADAPTER))return ContractDriftStatus.REQUIRES_ADAPTER;
  if(statuses.includes(ContractDriftStatus.COMPATIBLE_EXTENSION))return ContractDriftStatus.COMPATIBLE_EXTENSION;
  return ContractDriftStatus.NO_CHANGE;
}

export function comparePublicContractSnapshots(accepted,current){
  if(!accepted||!current)return{kind:'ContractDriftReport',status:ContractDriftStatus.UNKNOWN,rows:[],reason:'SNAPSHOT_MISSING'};
  const byOld=new Map((accepted.contracts??[]).map(x=>[x.contractId,x])),byNew=new Map((current.contracts??[]).map(x=>[x.contractId,x]));
  const ids=uniq([...byOld.keys(),...byNew.keys()]),rows=[];
  for(const id of ids){
    const a=byOld.get(id),b=byNew.get(id);
    if(!a||!b){rows.push({contractId:id,status:a?ContractDriftStatus.BREAKING_CHANGE:ContractDriftStatus.COMPATIBLE_EXTENSION,reason:a?'CONTRACT_REMOVED':'CONTRACT_ADDED',accepted:clone(a??null),current:clone(b??null)});continue;}
    const av=parse(a.version),bv=parse(b.version);
    if(!av||!bv){rows.push({contractId:id,status:ContractDriftStatus.UNKNOWN,reason:'VERSION_UNPARSEABLE',accepted:clone(a),current:clone(b)});continue;}
    if(av.major!==bv.major){rows.push({contractId:id,status:ContractDriftStatus.BREAKING_CHANGE,reason:'MAJOR_VERSION_CHANGED',accepted:clone(a),current:clone(b)});continue;}
    const required=cmpSet(a.requiredFields,b.requiredFields),optional=cmpSet(a.optionalFields,b.optionalFields),authority=cmpSet(a.authorityRules,b.authorityRules),semantics=cmpSet(a.semantics,b.semantics);
    const enumChanges=[];for(const key of uniq([...Object.keys(a.enumValues??{}),...Object.keys(b.enumValues??{})])){const c=cmpSet(a.enumValues?.[key],b.enumValues?.[key]);if(!c.same)enumChanges.push({field:key,...c});}
    let status=ContractDriftStatus.NO_CHANGE,reason='IDENTICAL';
    if(required.removed.length||authority.removed.length||semantics.removed.length||enumChanges.some(x=>x.removed.length)){status=ContractDriftStatus.BREAKING_CHANGE;reason='REQUIRED_OR_SEMANTIC_SURFACE_REMOVED';}
    else if(required.added.length){status=ContractDriftStatus.REQUIRES_ADAPTER;reason='NEW_REQUIRED_SURFACE';}
    else if(optional.removed.length||authority.added.length||semantics.added.length){status=ContractDriftStatus.REQUIRES_ADAPTER;reason='SEMANTIC_OR_OPTIONAL_BEHAVIOR_CHANGED';}
    else if(optional.added.length||enumChanges.some(x=>x.added.length)||av.minor!==bv.minor||av.patch!==bv.patch){status=ContractDriftStatus.COMPATIBLE_EXTENSION;reason='BACKWARD_COMPATIBLE_EXTENSION';}
    rows.push({contractId:id,status,reason,required,optional,authority,semantics,enumChanges,acceptedVersion:a.version,currentVersion:b.version});
  }
  return{kind:'ContractDriftReport',lane:current.lane,acceptedCheckpoint:accepted.checkpoint,currentCheckpoint:current.checkpoint,status:mergeStatus(rows.map(x=>x.status)),rows};
}

export function buildContractDriftMatrix(entries=[]){
  const reports=entries.map(x=>comparePublicContractSnapshots(x.accepted,x.current));
  return{kind:'ContractDriftMatrix',reports,counts:Object.fromEntries(Object.values(ContractDriftStatus).map(s=>[s,reports.filter(x=>x.status===s).length])),hasBreaking:reports.some(x=>x.status===ContractDriftStatus.BREAKING_CHANGE)};
}
