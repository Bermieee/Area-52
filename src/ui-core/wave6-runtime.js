import { SignalHub } from './signals.js';
import { RenderScheduler } from './render-scheduler.js';
import { WidgetRegistry, WorkspaceRegistry, InspectorRegistry } from './registry.js';
import { WidgetRuntime, ResourceScope } from './lifecycle.js';
import { ActionRouter } from './action-router.js';
import { UIStateStore } from './persistence.js';
import { OverlayManager } from './overlay.js';
import { NotificationCenter, ToastViewport } from './notifications.js';
import { registerPrimitiveWidgets, createKeyValue, element, makeCard } from './primitives.js';
import { registerCognitiveWidgets } from './cognitive-widgets.js';
import { InspectorController } from './inspector.js';
import { ApplicationShell } from './shell.js';
import { UIExtensionRegistry } from './wave4-extension-registry.js';
import { renderGenericArtifactInspector } from './wave4-generic-inspection.js';
import { ProductPresentationState } from './wave5-product-model.js';
import { registerKnowledgeInspectionActions } from './provenance-ui.js';
import { BrainPulseModel } from './wave6-brain-pulse.js';
import { CoprocessorProductionUIAdapter, ForensicsProductionUIAdapter, PromptPlanProductionUIAdapter, RuntimeProductionUIAdapter, SceneProductionUIAdapter, Wave6ProductAdapter } from './wave6-production-adapters.js';
import { FrontFacePresentationState, HostAdjacentMountAdapter } from './wave6-presentation.js';
import { HostAdjacentFrontFaceController, registerWave6FrontFaceWorkspaces } from './wave6-front-face.js';
import { ExplainabilityPresentationState } from './wave7-explainability.js';
import { registerWave7Actions, registerWave7Inspectors, registerWave7Workspaces } from './wave7-workspaces.js';
import { Wave8CognitionProductionAdapter } from './wave8-production-adapters.js';
import { registerWave8Actions, registerWave8Inspectors } from './wave8-workspace.js';
import { createWave11LiveReceiptBinding, mergeWave11Bridges } from './wave11-live-bindings.js';
import { Wave13CoprocessorStateUIAdapter, Wave13DiagnosticsCenterAdapter, Wave13LoreAuthoringUIAdapter, Wave13LoreStudyUIAdapter, Wave13MemoryUIAdapter, Wave13OperationalStatusAdapter, Wave13ResourceControlAdapter, Wave13RuntimeReceiptUIAdapter } from './wave13-operator-adapters.js';
import { installWave13OperatorSurfaces, registerWave13OperatorActions } from './wave13-operator-surfaces.js';
import { VerticalRailPopoutController } from './wave13-floating-navigation.js';

export function createWave6ProductInterface({
  root,
  stateStore=new UIStateStore(),
  bridges={},
  productName='Area-52',
  productTagline='Cognitive Story System',
  hostMountAdapter=null,
  fixture=null,
  hostBindings=null,
  floatingNavigation=false,
  viewportProvider=null,
}={}){
  if(!root)throw new Error('Wave 6 product interface requires a host-adjacent root element');
  if(fixture&&hostBindings)throw new TypeError('Fixture review mode and Wave 11 live host bindings are mutually exclusive');
  const liveReceiptBinding=hostBindings?createWave11LiveReceiptBinding(hostBindings):null;
  const effectiveBridges=liveReceiptBinding?mergeWave11Bridges(bridges,liveReceiptBinding.bridges):bridges;
  const signals=new SignalHub(),scheduler=new RenderScheduler(),widgetRegistry=new WidgetRegistry(),workspaceRegistry=new WorkspaceRegistry(),inspectorRegistry=new InspectorRegistry(),actionRouter=new ActionRouter();
  const extensionRegistry=new UIExtensionRegistry({workspaceRegistry,inspectorRegistry,actionRouter,scheduler});
  const overlays=new OverlayManager({document:root.ownerDocument,root:root.ownerDocument.body});
  const notifications=new NotificationCenter({signals});
  const productPresentation=new ProductPresentationState({stateStore});
  const frontFacePresentation=new FrontFacePresentationState({stateStore});
  const explainabilityPresentation=new ExplainabilityPresentationState({stateStore});
  const selectionProvider=()=>liveReceiptBinding?.selection?.()??{};
  const scene=effectiveBridges.scene?.readModel?new SceneProductionUIAdapter({...effectiveBridges.scene,selectionProvider}):null;
  const runtime=effectiveBridges.runtimeAdapter?new RuntimeProductionUIAdapter(effectiveBridges.runtimeAdapter):
    (effectiveBridges.cognition?.readScatterReceipt||typeof hostBindings?.readRuntimeStatus==='function')?new Wave13RuntimeReceiptUIAdapter({
      readScatter:effectiveBridges.cognition?.readScatterReceipt??(typeof hostBindings?.readScatter==='function'?hostBindings.readScatter.bind(hostBindings):null),
      readStatus:typeof hostBindings?.readRuntimeStatus==='function'?hostBindings.readRuntimeStatus.bind(hostBindings):null,
      selectionProvider,
    }):new RuntimeProductionUIAdapter(null);
  const coprocessor=(effectiveBridges.coprocessorTelemetry??effectiveBridges.coprocessorAdapter)?new CoprocessorProductionUIAdapter(effectiveBridges.coprocessorTelemetry??effectiveBridges.coprocessorAdapter):
    typeof hostBindings?.readCognitionUiState==='function'?new Wave13CoprocessorStateUIAdapter({readState:(selection)=>hostBindings.readCognitionUiState(selection),selectionProvider}):new CoprocessorProductionUIAdapter(null);
  const promptPlan=new PromptPlanProductionUIAdapter({...effectiveBridges.promptPlan,selectionProvider});
  const forensics=new ForensicsProductionUIAdapter(effectiveBridges.forensics??{});
  const cognition=new Wave8CognitionProductionAdapter({scene,promptPlan,...(effectiveBridges.cognition??{})});
  const loreStudy=hostBindings?new Wave13LoreStudyUIAdapter({bindings:hostBindings,selectionProvider}):null;
  const loreAuthoring=hostBindings?new Wave13LoreAuthoringUIAdapter({bindings:hostBindings}):null;
  const memoryOwner=hostBindings?new Wave13MemoryUIAdapter({bindings:hostBindings,selectionProvider}):null;
  const resources=hostBindings?new Wave13ResourceControlAdapter({bindings:hostBindings}):null;
  const productAdapter=new Wave6ProductAdapter({
    scene,runtime,coprocessor,promptPlan,forensics,
    story:effectiveBridges.story??null,characters:effectiveBridges.characters??null,lore:loreStudy??effectiveBridges.lore??null,memory:memoryOwner??effectiveBridges.memory??null,world:effectiveBridges.world??null,
    presentationState:productPresentation,fixture,
  });
  let shell=null,controller=null,floatingController=null,workspaceScope=new ResourceScope();
  const brainPulse=new BrainPulseModel({runtime,coprocessor,scheduler,onUpdate(){if(shell&&['home','brain'].includes(shell.currentWorkspace))shell.refreshCurrentWorkspace();controller?.scheduleQuickDash();}});
  const mounted=new Set();

  registerPrimitiveWidgets(widgetRegistry);registerCognitiveWidgets(widgetRegistry);
  const widgetRuntime=new WidgetRuntime({registry:widgetRegistry,services:{signals,scheduler,actionRouter,overlays,notifications,productAdapter}});
  if(effectiveBridges.knowledgeAdapter)registerKnowledgeInspectionActions(actionRouter,{adapter:effectiveBridges.knowledgeAdapter,signals});
  const releaseWave7Actions=registerWave7Actions(actionRouter,{presentation:explainabilityPresentation});
  const releaseWave8Actions=registerWave8Actions(actionRouter);
  const releaseWave13Actions=registerWave13OperatorActions(actionRouter,{resources,loreStudy,loreAuthoring});

  inspectorRegistry.register('*',(object,{document:doc})=>renderReadOnlyInspector(doc,object));
  inspectorRegistry.register('framework-artifact',renderGenericArtifactInspector);
  const releaseWave7Inspectors=registerWave7Inspectors(inspectorRegistry,{forensics,promptPlan});
  const releaseWave8Inspectors=registerWave8Inspectors(inspectorRegistry,{cognition,forensics});

  const inspector=new InspectorController({host:root,registry:inspectorRegistry,signals,scheduler,services:{signals,actionRouter,productAdapter,extensionRegistry}});
  const renderWorkspace=(entry,host)=>{
    for(const instance of mounted)widgetRuntime.destroy(instance);mounted.clear();workspaceScope.cleanup();workspaceScope=new ResourceScope();host.replaceChildren();
    entry.render?.(host,{
      scope:workspaceScope,signals,scheduler,actionRouter,notifications,productAdapter,brainPulse,workspaceRegistry,
      promptPlan,forensics,cognition,presentation:explainabilityPresentation,frontFacePresentation,liveReceiptBinding,operations,resources,loreStudy,loreAuthoring,diagnostics,floatingController,
      mount(widgetId,node,props){const instance=widgetRuntime.mount(widgetId,node,props);mounted.add(instance);return instance;},
      inspect(object){signals.publish('UI_INSPECT_SELECTION_CHANGED',{object},{source:'wave6-product'});},
      navigate(id){shell?.selectWorkspace(id);},
      refresh(){shell?.refreshCurrentWorkspace();},
    });
  };

  registerWave6FrontFaceWorkspaces(workspaceRegistry,{adapter:productAdapter,brainPulse});
  const productionAdapters={scene,runtime,coprocessor,promptPlan,forensics,cognition};
  const operations=hostBindings?new Wave13OperationalStatusAdapter({hostBindings,liveReceiptBinding,productionAdapters,loreStudy,resources}):null;
  const diagnostics=hostBindings?new Wave13DiagnosticsCenterAdapter({operations,resources,loreStudy,cognition,liveReceiptBinding,productionAdapters}):null;
  const releaseWave13Surfaces=installWave13OperatorSurfaces(workspaceRegistry,{operations,resources,loreStudy,loreAuthoring,memory:memoryOwner,diagnostics,actionRouter,cognition,frontFacePresentation});
  registerProductionEngineeringWorkspaces(workspaceRegistry,{runtime,coprocessor,promptPlan,forensics});
  registerWave7Workspaces(workspaceRegistry,{promptPlan,forensics,presentation:explainabilityPresentation,scheduler});

  shell=new ApplicationShell({root,workspaceRegistry,inspector,signals,stateStore,renderWorkspace,productName,productTagline});
  const mountAdapter=hostMountAdapter instanceof HostAdjacentMountAdapter?hostMountAdapter:new HostAdjacentMountAdapter(hostMountAdapter??{});
  controller=new HostAdjacentFrontFaceController({host:root,shell,adapter:productAdapter,presentation:frontFacePresentation,scheduler,signals,brainPulse,hostMountAdapter:mountAdapter,productName});
  controller.mount();
  floatingController=floatingNavigation?new VerticalRailPopoutController({frontFaceController:controller,shell,presentation:frontFacePresentation,signals,scheduler,stateStore,workspaceRegistry,productName,viewportProvider}).mount():null;
  const cognitionScope=new ResourceScope();
  let liveSelectionKey=null;
  const applyLiveSelection=(update=null,{initial=false}={})=>{
    const selection=liveReceiptBinding?.selection?.(update?.selection??{})??null;
    if(!selection)return;
    const key=JSON.stringify([selection.chatId,selection.turnId,selection.generationId,selection.correlationId,selection.worldRevision,selection.sceneRevision,selection.sourceRevisionRefs]);
    const switched=liveSelectionKey!==null&&key!==liveSelectionKey;liveSelectionKey=key;
    if(initial||switched){
      explainabilityPresentation.selectGeneration({generationId:selection.generationId??null,turnId:selection.turnId??null});
      inspector.clear();scheduler.cancelPrefix('inspector');
      signals.publish('UI_HOST_CONTEXT_CHANGED',{selection,switched},{source:'wave11-live-binding'});
    }else if(inspector.selection)scheduler.invalidate('wave11:inspector-refresh',()=>inspector.render(),{cost:'NORMAL'});
    scheduler.invalidate('wave11:host-refresh',()=>{if(shell?.currentWorkspace)shell.refreshCurrentWorkspace();controller?.scheduleQuickDash?.();},{cost:'NORMAL'});
  };
  if(liveReceiptBinding)applyLiveSelection(null,{initial:true});
  const cognitionRelease=cognition.subscribe((update)=>{
    if(liveReceiptBinding)applyLiveSelection(update);
    else scheduler.invalidate('wave8:cognition-refresh',()=>{if(shell?.currentWorkspace==='brain')shell.refreshCurrentWorkspace();controller?.scheduleQuickDash?.();},{cost:'NORMAL'});
  });if(typeof cognitionRelease==='function')cognitionScope.add(cognitionRelease);
  const operatorRefresh=(scopeKey)=>scheduler.invalidate('wave13:'+scopeKey+'-refresh',()=>{
    if(shell?.currentWorkspace==='brain'||shell?.currentWorkspace==='connections'||shell?.currentWorkspace==='settings'||(scopeKey==='lore'&&shell?.currentWorkspace==='lore')||(scopeKey==='memory'&&shell?.currentWorkspace==='memory')||shell?.currentWorkspace==='home')shell.refreshCurrentWorkspace();
    controller?.scheduleQuickDash?.();
  },{cost:'NORMAL'});
  const resourceRelease=resources?.subscribe?.(()=>operatorRefresh('resources'));if(typeof resourceRelease==='function')cognitionScope.add(resourceRelease);
  const loreRelease=loreStudy?.subscribe?.(()=>operatorRefresh('lore'));if(typeof loreRelease==='function')cognitionScope.add(loreRelease);
  const memoryRelease=memoryOwner?.subscribe?.(()=>operatorRefresh('memory'));if(typeof memoryRelease==='function')cognitionScope.add(memoryRelease);

  const toastScope=new ResourceScope(),toastViewport=new ToastViewport({host:shell.nodes.toastHost,signals,scope:toastScope});toastViewport.mount();

  return{
    controller,shell,signals,scheduler,widgetRegistry,workspaceRegistry,inspectorRegistry,actionRouter,extensionRegistry,overlays,notifications,
    productAdapter,brainPulse,presentation:frontFacePresentation,productPresentation,explainabilityPresentation,liveReceiptBinding,
    floatingController,operator:{operations,resources,loreStudy,loreAuthoring,memory:memoryOwner,diagnostics},
    productionAdapters:{scene,runtime,coprocessor,promptPlan,forensics,cognition},
    registerUIExtension(descriptor,binding){return extensionRegistry.register(descriptor,binding);},
    destroy(){for(const instance of mounted)widgetRuntime.destroy(instance);mounted.clear();workspaceScope.cleanup();toastScope.cleanup();cognitionScope.cleanup();floatingController?.destroy?.();liveReceiptBinding?.destroy?.();cognition.destroy?.();forensics.destroy?.();releaseWave13Surfaces?.();releaseWave13Actions?.();releaseWave8Inspectors?.();releaseWave8Actions?.();releaseWave7Inspectors?.();releaseWave7Actions?.();overlays.destroy();controller.destroy();extensionRegistry.destroy();scheduler.destroy();signals.clear();},
  };
}

function registerProductionEngineeringWorkspaces(registry,{runtime,coprocessor,promptPlan,forensics}){
  if(!registry.has('runtime-live'))registry.register({id:'runtime-live',title:'Runtime',icon:'≋',category:'Engineering',navigation:{level:'advanced',order:130},views:['advanced'],supportedActions:['inspect'],render(host){const d=host.ownerDocument,r=runtime.read();host.append(element(d,'h1',{text:'Runtime Detail'}));if(!r.data){host.append(state(d,'Runtime unavailable',r.source.reason||r.source.impact));return;}const x=r.data,counts=x.lifecycleCounts??{};host.append(makeCard(d,{title:'Runtime summary',body:createKeyValue(d,[{key:'Mode',value:x.mode},{key:'HOT active',value:x.hotActivity},{key:'DEEP active',value:x.deepActivity},{key:'Queued obligations',value:x.queuedObligations},{key:'Blocked / recovering',value:x.blockedRecoveringWork},{key:'Active / yielding',value:x.activeBatches}])}));host.append(makeCard(d,{title:'Lifecycle signals',body:createKeyValue(d,[{key:'Queued',value:counts.QUEUED??0},{key:'Active',value:counts.ACTIVE??0},{key:'Yielding',value:counts.YIELDING??0},{key:'Parked',value:counts.PARKED??0},{key:'Recovering',value:counts.RECOVERING??0},{key:'Complete',value:counts.COMPLETE??0},{key:'Failed',value:counts.FAILED??0}])}));host.append(makeCard(d,{title:'Scheduler / capacity',body:createKeyValue(d,[{key:'Queue by layer',value:Object.entries(x.queueDepth??{}).map(([k,v])=>k+': '+v).join(' · ')||'none'},{key:'Borrowed background leases',value:x.resources?.borrowedBackgroundLeases??'not published'},{key:'Retained telemetry signals',value:x.telemetry?.retainedSignals??'not published'},{key:'Telemetry sink failures',value:x.telemetry?.sinkFailures??'not published'},{key:'Batch progress history',value:x.batchProgressAvailable?'Published':'Owner snapshot does not publish batch history'},{key:'Late-result history',value:x.lateResultHistoryAvailable?'Published':'Owner snapshot does not publish late-result history'}])}));}});
  if(!registry.has('coprocessor-live'))registry.register({id:'coprocessor-live',title:'Coprocessor',icon:'✣',category:'Engineering',navigation:{level:'advanced',order:140},views:['advanced'],supportedActions:['inspect'],render(host){const d=host.ownerDocument,r=coprocessor.read();host.append(element(d,'h1',{text:'Coprocessor Detail'}));if(!r.data){host.append(state(d,'Coprocessor unavailable',r.source.reason||r.source.impact));return;}host.append(makeCard(d,{title:'Telemetry summary',body:createKeyValue(d,[{key:'Events',value:r.data.totalEvents??'—'},{key:'Warm hit / miss',value:`${r.data.warm?.hit??0} / ${r.data.warm?.miss??0}`},{key:'Fallback',value:r.data.fallback??0},{key:'Stale dropped',value:r.data.staleDrop??0},{key:'Retries',value:r.data.retry??0}])}));}});
  if(!registry.has('context-delivery'))registry.register({id:'context-delivery',title:'Context Delivery',icon:'▥',category:'Engineering',navigation:{level:'advanced',order:150},views:['advanced'],supportedActions:['inspect'],render(host){const d=host.ownerDocument,r=promptPlan.read();host.append(element(d,'h1',{text:'PromptPlan / Context Delivery'}));if(!r.data){host.append(state(d,'Context delivery unavailable',r.source.reason||r.source.impact));return;}host.append(makeCard(d,{title:r.data.promptPlanId,body:createKeyValue(d,[{key:'Tokens',value:`${r.data.totalTokens} / ${r.data.budgetTotal}`},{key:'Segments',value:r.data.segments.length},{key:'Reused',value:r.data.reusedSegments},{key:'Updated',value:r.data.updatedSegments},{key:'Dropped / deferred',value:`${r.data.dropped.length} / ${r.data.deferred.length}`},{key:'Seal',value:r.data.seal?.sealedState===true?'SEALED':'UNAVAILABLE'}])}));}});
}

function renderReadOnlyInspector(doc,object={}){
  const root=element(doc,'div',{className:'a52-stack'});root.append(element(doc,'h2',{text:object.title??object.name??object.id??object.kind??'Inspector'}));
  const summary=[];for(const [key,value] of Object.entries(object).slice(0,20)){if(key==='payload'||key==='scene'||key==='source'||key==='diagnosticRefs'||key==='provenanceRefs')continue;if(value==null||typeof value==='function')continue;summary.push({key,value:typeof value==='object'?Array.isArray(value)?`${value.length} items`:value.status??value.state??value.kind??'available':String(value)});}
  if(summary.length)root.append(createKeyValue(doc,summary));
  const deep=object.payload??object.scene??object.source??object.diagnosticRefs??null;if(deep){const pre=element(doc,'pre',{className:'a52-context-packet',text:JSON.stringify(deep,null,2)});pre.setAttribute('aria-label','Advanced read-only payload');root.append(pre);}
  return root;
}
function state(d,title,message){const r=element(d,'section',{className:'a52-state-message',attrs:{role:'status'}});r.append(element(d,'strong',{text:title}),element(d,'span',{text:message||'Not connected.'}));return r;}
