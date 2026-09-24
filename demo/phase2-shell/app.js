import { FrontFaceMode, ProductDetailLevel, UIStateStore, createWave6ProductInterface } from '../../src/ui-core/index.js';
import { createReviewScenarios } from './scenarios/index.js';
import { installPhase2ReviewWorkspaces } from './review-workspaces.js';

export const REVIEW_LAYOUTS=Object.freeze({wide:1600,desktop:1280,compact:980,narrow:680});
export const REVIEW_WIDTHS=Object.freeze({collapsed:76,w420:420,w560:560,w720:720,w900:900});

export function createPhase2ReviewController({document:doc=globalThis.document,storage=globalThis.localStorage}={}){
  if(!doc)throw new Error('Phase-2 review shell requires a document');
  const root=doc.querySelector('#area52-phase2-root'),frame=doc.querySelector('#phase2-review-frame'),host=doc.querySelector('#phase2-host-surface');
  if(!root||!frame||!host)throw new Error('Phase-2 review shell markup is incomplete');
  const scenarios=createReviewScenarios(),stateStore=new UIStateStore({storage,namespace:'area52.ui.wave9.review'});let ui=null,currentScenario='healthy';
  function mountScenario(id=currentScenario){
    const record=scenarios.get(id);if(!record)throw new Error(`Unknown review scenario: ${id}`);currentScenario=id;ui?.destroy?.();root.replaceChildren();
    ui=createWave6ProductInterface({root,stateStore,productName:'Area-52',productTagline:'Cognitive Story System',fixture:record.product,bridges:{cognition:record.cognition?{fixture:record.cognition}:{}},hostMountAdapter:{reserveWidth(width){frame.style.setProperty('--a52-review-dock-width',`${width}px`);},releaseWidth(){frame.style.removeProperty('--a52-review-dock-width');}}});
    installPhase2ReviewWorkspaces(ui);ui.signals.subscribe('UI_INSPECT_SELECTION_CHANGED',()=>ui.presentation.setInspector(true));applyReviewState();
    doc.querySelector('#review-fixture-label').textContent=`DEMO / FIXTURE DATA · ${record.label}`;doc.querySelector('#review-scenario-description').textContent=record.description;return ui;
  }
  function applyReviewState(){const scenarioSelect=doc.querySelector('#review-scenario'),detail=doc.querySelector('#review-detail'),layout=doc.querySelector('#review-layout'),width=doc.querySelector('#review-width'),inspector=doc.querySelector('#review-inspector');if(scenarioSelect)scenarioSelect.value=currentScenario;if(detail)ui.productAdapter.setDetailLevel(detail.value||ProductDetailLevel.NORMAL);if(layout)setLayout(layout.value||'desktop');if(width)setDock(width.value||'w720');if(inspector)ui.presentation.setInspector(inspector.checked,360);}
  function setLayout(name){const px=REVIEW_LAYOUTS[name]??REVIEW_LAYOUTS.desktop;frame.dataset.reviewLayout=name;frame.style.setProperty('--review-frame-width',`${px}px`);host.dataset.reviewLayout=name;return px;}
  function setDock(name){const px=REVIEW_WIDTHS[name]??720;if(name==='collapsed')ui.presentation.patch({frontFaceMode:FrontFaceMode.COLLAPSED});else ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:px});return px;}
  function setDetail(level){ui.productAdapter.setDetailLevel(level);ui.shell.refreshCurrentWorkspace();}function setInspector(visible){ui.presentation.setInspector(Boolean(visible),360);}
  const controls={scenario:doc.querySelector('#review-scenario'),detail:doc.querySelector('#review-detail'),layout:doc.querySelector('#review-layout'),width:doc.querySelector('#review-width'),inspector:doc.querySelector('#review-inspector'),reset:doc.querySelector('#review-reset')};
  const cleanup=[];const listen=(target,type,handler)=>{if(!target?.addEventListener)return;target.addEventListener(type,handler);cleanup.push(()=>target.removeEventListener?.(type,handler));};
  listen(controls.scenario,'change',e=>mountScenario(e.target.value));listen(controls.detail,'change',e=>setDetail(e.target.value));listen(controls.layout,'change',e=>setLayout(e.target.value));listen(controls.width,'change',e=>setDock(e.target.value));listen(controls.inspector,'change',e=>setInspector(e.target.checked));listen(controls.reset,'click',()=>{stateStore.clear();controls.scenario.value='healthy';controls.detail.value='NORMAL';controls.layout.value='desktop';controls.width.value='w720';controls.inspector.checked=false;mountScenario('healthy');});
  const onKeydown=e=>{if(e.key==='Escape'&&ui?.presentation.get().inspectorVisible){ui.presentation.setInspector(false);if(controls.inspector)controls.inspector.checked=false;}};listen(doc,'keydown',onKeydown);mountScenario(currentScenario);
  return{get ui(){return ui;},scenarios,stateStore,mountScenario,setLayout,setDock,setDetail,setInspector,destroy(){while(cleanup.length)cleanup.pop()();ui?.destroy?.();ui=null;}};
}
if(globalThis.document?.querySelector?.('#area52-phase2-root'))globalThis.area52Phase2Review=createPhase2ReviewController();
