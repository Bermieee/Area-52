const clone=(value)=>value==null?value:structuredClone(value);
export class SceneLoadQualificationMonitor{
  constructor({performanceApi=globalThis.performance??null,maxSamples=64}={}){
    this.performanceApi=performanceApi;this.maxSamples=Math.max(4,Math.min(256,Number(maxSamples)||64));this.samples=[];
  }
  measure(label,fn){
    if(typeof fn!=='function')throw new TypeError('Scene load measurement requires function');
    const now=()=>Number(this.performanceApi?.now?.()??Date.now()),heap=()=>Number(this.performanceApi?.memory?.usedJSHeapSize);
    const heapSupported=Number.isFinite(heap()),beforeHeap=heapSupported?heap():null,start=now();
    const result=fn();const end=now(),afterHeap=heapSupported?heap():null;
    const sample=Object.freeze({kind:'SceneLoadSample',label:String(label??'sample'),elapsedMs:Math.max(0,end-start),heapBeforeBytes:beforeHeap,heapAfterBytes:afterHeap,heapDeltaBytes:heapSupported?afterHeap-beforeHeap:null,measurementClass:heapSupported?'MEASURED_BROWSER_API':'TIMING_ONLY',at:Date.now()});
    this.samples.push(sample);while(this.samples.length>this.maxSamples)this.samples.shift();return sample;
  }
  report(){
    const elapsed=this.samples.map(x=>x.elapsedMs),heap=this.samples.filter(x=>x.heapDeltaBytes!=null).map(x=>x.heapDeltaBytes);
    return Object.freeze({kind:'SceneLoadQualificationReport',contractVersion:'1.0.0',samples:clone(this.samples),browserHeapSupported:heap.length>0,maxElapsedMs:elapsed.length?Math.max(...elapsed):0,totalHeapDeltaBytes:heap.length?heap.reduce((a,b)=>a+b,0):null,readOnly:true,authorityGranted:false});
  }
}
