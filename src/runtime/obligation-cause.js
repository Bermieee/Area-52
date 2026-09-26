const FIELDS=['eventType','eventId','correlationId','chatId','turnId','generationId','parentReceiptId','producerId','consumerId','worldRevision','sceneRevision'];
const clean=(value)=>typeof value==='string'||typeof value==='number'?String(value).slice(0,160):null;
export function sanitizeObligationCause(cause){
  if(cause==null)return null;
  const out=Object.fromEntries(FIELDS.map(key=>[key,clean(cause[key])]));
  out.sourceRevisionRefs=[...new Set((cause.sourceRevisionRefs??cause.revisionFences?.sourceRevisionIds??[]).filter(Boolean).map(String))].sort().slice(0,128);
  return out;
}
