import { normalizeLiveSelection } from './wave11-live-bindings.js';

const TURN_SCOPED=/^(wave7-|wave8-|wave13-(producer-inspection|scatter-trace|gather-trace)|wave14-activity-evidence)/;
const text=(v)=>v==null||v===''?null:String(v);
const refs=(v)=>[...new Set((v??[]).map(String))].sort();

export function prepareSelectedTurnInspection(object,currentSelection={}){
  const source=object&&typeof object==='object'?object:{kind:'selected-turn-inspection',title:'Inspection'};
  if(!TURN_SCOPED.test(String(source.kind??'')))return source;
  const current=normalizeLiveSelection(currentSelection??{}),hasExplicit=Boolean(source.selection),explicit=hasExplicit?normalizeLiveSelection(source.selection):current;
  const currentComplete=Boolean(current.chatId&&current.turnId&&current.generationId);
  const mismatch=hasExplicit&&selectionMismatch(explicit,current);
  if(!currentComplete)return unavailable(source,current,'NO_SELECTED_TURN_EVIDENCE','No exact chat / turn / generation is currently selected.',hasExplicit?explicit:null);
  if(mismatch)return unavailable(source,current,'STALE_SELECTED_TURN_EVIDENCE','The Inspect target belongs to a different chat, turn, generation, or revision fence.',explicit);
  if(source.available===false)return {...source,selection:current,available:false,availabilityState:source.availabilityState??'NO_EVIDENCE',selectionEvidence:evidence(source,current,hasExplicit?'OWNER_OBJECT':'UI_RENDER_SELECTION')};
  return {...source,selection:current,available:true,availabilityState:source.availabilityState??'CURRENT_SELECTED_TURN',selectionEvidence:evidence(source,current,hasExplicit?'OWNER_OBJECT':'UI_RENDER_SELECTION')};
}

function unavailable(source,current,state,reason,staleSelection){
  return{
    kind:source.kind??'selected-turn-inspection',id:source.id??null,title:source.title??'Selected-turn evidence',available:false,availabilityState:state,
    reason,selection:current,staleSelection:staleSelection??null,receiptRef:null,
    selectionEvidence:{state:'NO_EVIDENCE',identity:'CURRENT_SELECTION_ONLY',receipt:'NO_EVIDENCE',parentLink:'NO_EVIDENCE',duration:'NO_EVIDENCE',ownerAcceptance:'NO_EVIDENCE'},
    payload:{kind:'SelectedTurnInspectionUnavailable',status:'NO_EVIDENCE',reason,requestedKind:source.kind??null},
  };
}
function evidence(source,selection,selectionSource){
  const receiptRef=source.receiptRef??source.payload?.receiptId??source.payload?.id??source.item?.receiptId??source.item?.id??null;
  const parent=source.parentReceiptId??source.payload?.parentReceiptId??source.item?.parentReceiptId??null;
  const duration=source.durationMs??source.payload?.durationMs??source.item?.durationMs??null;
  const accepted=source.ownerAccepted??source.payload?.ownerAccepted??source.item?.ownerAccepted??null;
  return{
    state:'CURRENT_SELECTED_TURN',selectionSource,chatId:selection.chatId,turnId:selection.turnId,generationId:selection.generationId,correlationId:selection.correlationId??null,
    worldRevision:selection.worldRevision??null,sceneRevision:selection.sceneRevision??null,sourceRevisionRefs:[...(selection.sourceRevisionRefs??[])],
    receipt:receiptRef?String(receiptRef):'NO_EVIDENCE',parentLink:parent?String(parent):'NO_EVIDENCE',
    duration:Number.isFinite(Number(duration))?Number(duration):'NO_EVIDENCE',ownerAcceptance:typeof accepted==='boolean'?accepted:'NO_EVIDENCE',
  };
}
function selectionMismatch(a,b){
  for(const key of ['chatId','turnId','generationId','correlationId'])if(a?.[key]!=null&&b?.[key]!=null&&text(a[key])!==text(b[key]))return true;
  for(const key of ['worldRevision','sceneRevision'])if(a?.[key]!=null&&b?.[key]!=null&&Number(a[key])!==Number(b[key]))return true;
  const aRefs=refs(a?.sourceRevisionRefs),bRefs=new Set(refs(b?.sourceRevisionRefs));if(aRefs.length&&aRefs.some(ref=>!bRefs.has(ref)))return true;
  return false;
}
