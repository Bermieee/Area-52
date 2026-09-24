const bytes=(value)=>Buffer.byteLength(JSON.stringify(value),'utf8');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const factKey=(f)=>JSON.stringify([f.e??f.subjectId,f.p??f.predicate,f.v??f.value]);

export function benchmarkContextCompression({rawRepresentation,compiledPacket,requirements={}}){
  const compiledFacts=[...(compiledPacket.current??[]),...(compiledPacket.historical??[]),...(compiledPacket.unresolved??[])];
  const compiledKeys=new Set(compiledFacts.map(factKey));
  const facts=requirements.facts??[];
  const factualRetention=facts.length?facts.filter(f=>compiledKeys.has(factKey(f))).length/facts.length:1;

  const temporal=requirements.temporal??[];
  const temporalRetention=temporal.length?temporal.filter(req=>{
    const fact=compiledFacts.find(f=>factKey(f)===factKey(req));
    return fact&&Array.isArray(fact.t)&&
      (req.status===undefined||fact.t[2]===req.status)&&
      (req.validFrom===undefined||fact.t[0]===req.validFrom)&&
      (req.validUntil===undefined||fact.t[1]===req.validUntil);
  }).length/temporal.length:1;

  const unresolved=requirements.unresolved??[];
  const unresolvedKeys=new Set((compiledPacket.unresolved??[]).map(factKey));
  const contradictionRetention=unresolved.length?unresolved.filter(f=>unresolvedKeys.has(factKey(f))).length/unresolved.length:1;

  const provenance=requirements.provenance??[];
  const provenanceRetention=provenance.length?provenance.filter(({factId,sourceRevisionIds})=>{
    const actual=compiledPacket.provenanceIndex?.[factId]??[];
    return sourceRevisionIds.every(id=>actual.includes(id));
  }).length/provenance.length:1;

  const relationships=requirements.relationships??[];
  const relationshipRetention=relationships.length?relationships.filter(f=>compiledKeys.has(factKey(f))).length/relationships.length:1;

  const rawBytes=bytes(rawRepresentation),compiledBytes=bytes(compiledPacket);
  return{
    kind:'ContextCompressionBenchmark',
    rawBytes,compiledBytes,compressionRatio:rawBytes?Number((compiledBytes/rawBytes).toFixed(6)):1,
    factualRetention,temporalRetention,contradictionRetention,
    unresolvedThreadRetention:contradictionRetention,provenanceRetention,relationshipRetention,
    pass:[factualRetention,temporalRetention,contradictionRetention,provenanceRetention,relationshipRetention].every(x=>x===1),
  };
}

const ORDER_SECTIONS=['current','character','unresolved','supportingLore','historical'];

export function buildContextOrderVariants(sections={}){
  const values=Object.fromEntries(ORDER_SECTIONS.map(name=>[name,sections[name]??[]]));
  const orders=[
    ['current','character','unresolved','supportingLore','historical'],
    ['unresolved','current','character','supportingLore','historical'],
    ['historical','supportingLore','current','character','unresolved'],
    ['supportingLore','current','unresolved','character','historical'],
    ['character','current','unresolved','historical','supportingLore'],
  ];
  return orders.map((order,index)=>({
    kind:'ContextOrderVariant',id:`context-order:${index+1}`,order,
    sections:order.map((name,position)=>({name,position,content:structuredClone(values[name])})),
    positionIndex:Object.fromEntries(order.map((name,position)=>[name,position])),
  }));
}

export function compareContextOrderMeasurements(variants,measurements=[]){
  const byId=new Map(measurements.map(x=>[x.variantId,x]));
  return variants.map(variant=>({
    variantId:variant.id,order:[...variant.order],
    measurement:byId.get(variant.id)??null,
  }));
}
