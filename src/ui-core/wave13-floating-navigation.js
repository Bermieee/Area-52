import { ResourceScope } from './lifecycle.js';
import { Signals } from './constants.js';
import { FrontFaceMode } from './wave6-presentation.js';
import { createButton, element } from './primitives.js';

export const WAVE13_FLOATING_NAV_VERSION='1.0.0';
const RAIL_WIDTH=64,CARD_GAP=10,EDGE=10,MIN_CARD=320,MAX_CARD=960;

export class VerticalRailPopoutController{
  constructor({frontFaceController,shell,presentation,signals,scheduler,stateStore,workspaceRegistry,productName='Area-52',viewportProvider=null}={}){
    if(!frontFaceController||!shell||!presentation||!signals||!scheduler||!workspaceRegistry)throw new TypeError('Wave 13 floating navigation requires mounted UI.Core services');
    this.frontFaceController=frontFaceController;this.shell=shell;this.presentation=presentation;this.signals=signals;this.scheduler=scheduler;this.stateStore=stateStore;
    this.workspaceRegistry=workspaceRegistry;this.productName=productName;this.viewportProvider=viewportProvider;
    this.scope=new ResourceScope();this.navScope=new ResourceScope();this.nodes={};this.mounted=false;this.drag=null;
    const persisted=this.stateStore?.load?.().wave13FloatingNavigation??{};
    this.state={
      railX:numberOrNull(persisted.railX),railY:numberOrNull(persisted.railY),
      cardX:numberOrNull(persisted.cardX),cardY:numberOrNull(persisted.cardY),
      side:['LEFT','RIGHT'].includes(persisted.side)?persisted.side:'LEFT',
      minimized:Boolean(persisted.minimized),
    };
  }

  mount(){
    if(this.mounted)return this;this.mounted=true;
    const nodes=this.frontFaceController.nodes,d=nodes.root.ownerDocument;
    const rail=element(d,'aside',{className:'a52-wave13-rail',attrs:{'aria-label':this.productName+' navigation'},dataset:{wave13Rail:''}});
    const railHandle=element(d,'button',{className:'a52-wave13-drag-handle',text:'⋮⋮',attrs:{type:'button','aria-label':'Move navigation rail',title:'Drag to move navigation. Arrow keys also move it.'}});
    const nav=element(d,'nav',{className:'a52-wave13-rail__nav',attrs:{'aria-label':'Product sections'}});
    const card=element(d,'section',{className:'a52-wave13-popout',attrs:{role:'region','aria-label':this.productName+' section card'},dataset:{side:this.state.side}});
    const cardHead=element(d,'header',{className:'a52-wave13-popout__head'});
    const cardHandle=element(d,'button',{className:'a52-wave13-popout__drag',text:'⠿',attrs:{type:'button','aria-label':'Move section card',title:'Drag to move this card. Arrow keys also move it.'}});
    const title=element(d,'strong',{className:'a52-wave13-popout__title',text:'Home'});
    const controls=element(d,'div',{className:'a52-wave13-popout__controls'});
    const shrink=createButton(d,{label:'−',ariaLabel:'Shrink section card',className:'a52-wave13-icon-button',scope:this.scope,onPress:()=>this.resize(-120)});
    const expand=createButton(d,{label:'+',ariaLabel:'Expand section card',className:'a52-wave13-icon-button',scope:this.scope,onPress:()=>this.resize(120)});
    const minimize=createButton(d,{label:'▁',ariaLabel:'Minimize section card',className:'a52-wave13-icon-button',scope:this.scope,onPress:()=>this.toggleMinimized()});
    const close=createButton(d,{label:'×',ariaLabel:'Close section card',className:'a52-wave13-icon-button',scope:this.scope,onPress:()=>this.close()});
    controls.append(shrink,expand,minimize,close);cardHead.append(cardHandle,title,controls);
    const cardBody=element(d,'div',{className:'a52-wave13-popout__body'});
    cardBody.append(nodes.expanded);card.append(cardHead,cardBody);
    nodes.root.replaceChildren(rail,card);rail.append(railHandle,nav);
    nodes.root.classList.add('a52-wave13-floating-product');
    this.nodes={rail,railHandle,nav,card,cardHead,cardHandle,title,controls,shrink,expand,minimize,close,cardBody};
    this.shell.root.classList.add('a52-wave13-shell');
    this.#syncNav();
    this.scope.add(this.workspaceRegistry.subscribe(()=>this.#syncNav()));
    this.scope.add(this.presentation.subscribe(()=>this.scheduleLayout()));
    this.scope.subscribe(this.signals,Signals.UI_WORKSPACE_CHANGED,({payload})=>{this.#syncSelected(payload.workspaceId);this.#updateTitle(payload.workspaceId);this.open();});
    this.#bindDrag(railHandle,'rail');
    this.#bindDrag(cardHandle,'card');
    this.#bindMoveKeys(railHandle,'rail');
    this.#bindMoveKeys(cardHandle,'card');
    this.scope.listen(d,'keydown',(event)=>{
      if(event.key==='Escape'&&this.presentation.get().frontFaceMode===FrontFaceMode.EXPANDED){event.preventDefault?.();this.close();}
    });
    this.#ensureInitialPosition();
    this.#applyLayout();
    this.#syncSelected(this.shell.currentWorkspace);
    this.#updateTitle(this.shell.currentWorkspace);
    return this;
  }

  open(workspaceId=null){
    if(workspaceId&&this.workspaceRegistry.has(workspaceId))this.shell.selectWorkspace(workspaceId);
    if(this.presentation.get().frontFaceMode!==FrontFaceMode.EXPANDED)this.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED});
    else this.scheduleLayout();
  }

  close(){
    if(this.presentation.get().frontFaceMode!==FrontFaceMode.COLLAPSED)this.presentation.patch({frontFaceMode:FrontFaceMode.COLLAPSED});
    this.nodes.rail?.focus?.();
  }

  toggleMinimized(){
    this.state.minimized=!this.state.minimized;this.#persist();this.#applyLayout();
  }

  resize(delta){
    const p=this.presentation.get(),vp=this.#viewport();
    const max=Math.max(MIN_CARD,Math.min(MAX_CARD,vp.width-EDGE*2));
    this.presentation.setWidth(Math.max(MIN_CARD,Math.min(max,Number(p.frontFaceWidth)+Number(delta||0))));
  }

  scheduleLayout(){this.scheduler.invalidate('wave13:floating-layout',()=>this.#applyLayout(),{cost:'CHEAP'});}

  diagnostics(){
    const vp=this.#viewport(),p=this.presentation.get();
    return Object.freeze({kind:'Wave13FloatingNavigationDiagnostics',contractVersion:WAVE13_FLOATING_NAV_VERSION,mounted:this.mounted,workspace:this.shell.currentWorkspace,mode:p.frontFaceMode,rail:{x:this.state.railX,y:this.state.railY},card:{x:this.state.cardX,y:this.state.cardY,width:this.#cardSize().width,requestedWidth:p.frontFaceWidth,side:this.state.side,minimized:this.state.minimized},viewport:vp,dragging:Boolean(this.drag)});
  }

  destroy(){
    if(!this.mounted)return;this.mounted=false;this.drag=null;this.navScope.cleanup();this.scope.cleanup();
    this.shell.root?.classList?.toggle?.('a52-wave13-shell',false);
    this.nodes={};
  }

  #syncNav(){
    const nav=this.nodes.nav;if(!nav)return;this.navScope.cleanup();this.navScope=new ResourceScope();nav.replaceChildren();
    const entries=this.workspaceRegistry.list({navigationLevel:'product'}).sort((a,b)=>(a.navigation?.order??0)-(b.navigation?.order??0)||a.registrationSequence-b.registrationSequence);
    for(const entry of entries){
      const button=element(nav.ownerDocument,'button',{className:'a52-wave13-rail__item',attrs:{type:'button','aria-label':entry.title,title:entry.title},dataset:{workspaceId:entry.id},text:entry.icon||entry.title.slice(0,1)});
      this.navScope.listen(button,'click',()=>this.open(entry.id));
      this.navScope.listen(button,'keydown',(event)=>{
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault?.();
        const items=[...(nav.querySelectorAll?.('[data-workspace-id]')??[])],index=items.indexOf(button);
        const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;
        items[next]?.focus?.();
      });
      nav.append(button);
    }
    this.#syncSelected(this.shell.currentWorkspace);
  }

  #syncSelected(id){
    for(const button of this.nodes.nav?.querySelectorAll?.('[data-workspace-id]')??[]){
      const selected=button.dataset.workspaceId===id;button.classList.toggle('is-selected',selected);button.setAttribute('aria-current',selected?'page':'false');
    }
  }

  #updateTitle(id){
    if(!this.nodes.title)return;
    try{this.nodes.title.textContent=this.workspaceRegistry.get(id)?.title??'Area-52';}catch{this.nodes.title.textContent='Area-52';}
  }

  #ensureInitialPosition(){
    const vp=this.#viewport();
    if(this.state.railX==null)this.state.railX=Math.max(EDGE,vp.width-RAIL_WIDTH-EDGE);
    if(this.state.railY==null)this.state.railY=Math.max(EDGE,Math.min(vp.height-300,96));
    this.#clampRail();this.#positionCard({forceAdjacent:this.state.cardX==null||this.state.cardY==null});this.#persist();
  }

  #viewport(){
    const d=this.nodes.rail?.ownerDocument??this.frontFaceController.host?.ownerDocument;
    const win=d?.defaultView??globalThis.window;
    const supplied=this.viewportProvider?.();
    const width=Math.max(280,Number(supplied?.width??win?.innerWidth??d?.documentElement?.clientWidth??d?.body?.clientWidth??1280)||1280);
    const height=Math.max(320,Number(supplied?.height??win?.innerHeight??d?.documentElement?.clientHeight??d?.body?.clientHeight??800)||800);
    return{width,height};
  }

  #railSize(){return{width:RAIL_WIDTH,height:Math.max(260,Math.min(500,74+(this.workspaceRegistry.list({navigationLevel:'product'}).length*52)))};}

  #clampRail(){
    const vp=this.#viewport(),size=this.#railSize();
    this.state.railX=clamp(this.state.railX,EDGE,Math.max(EDGE,vp.width-size.width-EDGE));
    this.state.railY=clamp(this.state.railY,EDGE,Math.max(EDGE,vp.height-size.height-EDGE));
  }

  #cardSize(){
    const vp=this.#viewport(),p=this.presentation.get(),width=Math.min(Number(p.frontFaceWidth)||560,Math.max(240,vp.width-EDGE*2));
    const height=this.state.minimized?52:Math.max(260,Math.min(vp.height-EDGE*2,Math.round(vp.height*.78)));
    return{width,height};
  }

  #positionCard({forceAdjacent=false}={}){
    const vp=this.#viewport(),card=this.#cardSize(),rail=this.#railSize(),right=vp.width-(this.state.railX+rail.width),left=this.state.railX;
    let side=this.state.side;
    if(forceAdjacent||!['LEFT','RIGHT'].includes(side)){
      if(right>=card.width+CARD_GAP)side='RIGHT';else if(left>=card.width+CARD_GAP)side='LEFT';else side=right>=left?'RIGHT':'LEFT';
    }else{
      const room=side==='RIGHT'?right:left;if(room<Math.min(card.width+CARD_GAP,MIN_CARD+CARD_GAP))side=side==='RIGHT'?'LEFT':'RIGHT';
    }
    this.state.side=side;
    if(forceAdjacent||this.state.cardX==null)this.state.cardX=side==='RIGHT'?this.state.railX+rail.width+CARD_GAP:this.state.railX-card.width-CARD_GAP;
    if(forceAdjacent||this.state.cardY==null)this.state.cardY=this.state.railY;
    this.state.cardX=clamp(this.state.cardX,EDGE,Math.max(EDGE,vp.width-card.width-EDGE));
    this.state.cardY=clamp(this.state.cardY,EDGE,Math.max(EDGE,vp.height-card.height-EDGE));
  }

  #applyLayout(){
    if(!this.mounted)return;this.#clampRail();this.#positionCard();
    const p=this.presentation.get(),card=this.#cardSize();
    this.frontFaceController.nodes.root.style.width=RAIL_WIDTH+'px';
    this.nodes.rail.style.left=this.state.railX+'px';this.nodes.rail.style.top=this.state.railY+'px';
    this.nodes.card.style.left=this.state.cardX+'px';this.nodes.card.style.top=this.state.cardY+'px';this.nodes.card.style.width=card.width+'px';this.nodes.card.style.height=card.height+'px';
    this.nodes.card.dataset.side=this.state.side;this.nodes.card.dataset.minimized=String(this.state.minimized);
    this.nodes.card.style.display=p.frontFaceMode===FrontFaceMode.EXPANDED?'':'none';
    this.nodes.cardBody.style.display=this.state.minimized?'none':'';
    this.nodes.minimize.textContent=this.state.minimized?'▣':'▁';this.nodes.minimize.setAttribute('aria-label',this.state.minimized?'Restore section card':'Minimize section card');
    this.frontFaceController.nodes.expanded.style.display=p.frontFaceMode===FrontFaceMode.EXPANDED?'':'none';
    this.#persist();
  }

  #bindDrag(handle,target){
    this.scope.listen(handle,'pointerdown',(event)=>{
      if(event.button!=null&&event.button!==0)return;event.preventDefault?.();handle.setPointerCapture?.(event.pointerId);
      const x=target==='rail'?this.state.railX:this.state.cardX,y=target==='rail'?this.state.railY:this.state.cardY;
      this.drag={target,startX:Number(event.clientX??0),startY:Number(event.clientY??0),originX:x,originY:y,pointerId:event.pointerId??null};
    });
    const doc=handle.ownerDocument;
    this.scope.listen(doc,'pointermove',(event)=>{
      if(!this.drag||this.drag.target!==target)return;
      const x=this.drag.originX+Number(event.clientX??0)-this.drag.startX,y=this.drag.originY+Number(event.clientY??0)-this.drag.startY;
      if(target==='rail'){this.state.railX=x;this.state.railY=y;this.#clampRail();this.#positionCard({forceAdjacent:true});}
      else {this.state.cardX=x;this.state.cardY=y;this.#positionCard();}
      this.#applyLayout();
    });
    this.scope.listen(doc,'pointerup',(event)=>{if(this.drag?.target===target){handle.releasePointerCapture?.(event.pointerId);this.drag=null;this.#persist();}});
    this.scope.listen(doc,'pointercancel',()=>{if(this.drag?.target===target)this.drag=null;});
  }

  #bindMoveKeys(handle,target){
    this.scope.listen(handle,'keydown',(event)=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault?.();
      const step=event.shiftKey?48:16,dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
      if(target==='rail'){this.state.railX+=dx;this.state.railY+=dy;this.#clampRail();this.#positionCard({forceAdjacent:true});}
      else {this.state.cardX+=dx;this.state.cardY+=dy;this.#positionCard();}
      this.#applyLayout();
    });
  }

  #persist(){this.stateStore?.save?.({wave13FloatingNavigation:{...this.state}});}
}

export function createVerticalRailPopoutController(options){return new VerticalRailPopoutController(options);}

function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
function numberOrNull(value){return Number.isFinite(Number(value))?Number(value):null;}
