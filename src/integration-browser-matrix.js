import {browserHostConformanceReport} from './browser-host-conformance.js';
const clone=(v)=>structuredClone(v);
const req=(v,n)=>{if(typeof v!=='string'||!v.length)throw new TypeError(`${n} must be a non-empty string`);return v;};
export const BrowserMatrixState=Object.freeze({PASS:'PASS',PARTIAL:'PARTIAL',BLOCKED:'BLOCKED',NOT_RUN:'NOT_RUN'});
export function createBrowserRuntimeDeclaration({subsystem,checkpoint,browserRuntimePaths=[],nodeOnlyToolPaths=[],requiredWebApis=[],optionalWebApis=[],hostCapabilities=[]}={}){
  return{kind:'BrowserRuntimeDeclaration',subsystem:req(subsystem,'subsystem'),checkpoint:req(checkpoint,'checkpoint'),browserRuntimePaths:[...new Set(browserRuntimePaths)].sort(),nodeOnlyToolPaths:[...new Set(nodeOnlyToolPaths)].sort(),requiredWebApis:[...new Set(requiredWebApis)].sort(),optionalWebApis:[...new Set(optionalWebApis)].sort(),hostCapabilities:[...new Set(hostCapabilities)].sort()};
}
export function evaluateBrowserDeclaration(declaration,{sources={},availableWebApis=[],availableHostCapabilities=[],executed=false}={}){
  const required=new Set(availableWebApis),host=new Set(availableHostCapabilities),missingRequiredApis=declaration.requiredWebApis.filter(x=>!required.has(x)),missingHostCapabilities=declaration.hostCapabilities.filter(x=>!host.has(x));
  const missingPaths=declaration.browserRuntimePaths.filter(p=>typeof sources[p]!=='string'),rows=declaration.browserRuntimePaths.filter(p=>typeof sources[p]==='string').map(p=>({path:p,source:sources[p]})),scan=browserHostConformanceReport(rows),violations=scan.results.filter(x=>!x.pass);
  const blocked=missingRequiredApis.length||missingHostCapabilities.length||missingPaths.length||violations.length;
  return{kind:'BrowserCompatibilityResult',subsystem:declaration.subsystem,checkpoint:declaration.checkpoint,state:blocked?BrowserMatrixState.BLOCKED:executed?BrowserMatrixState.PASS:BrowserMatrixState.PARTIAL,executed:Boolean(executed),missingRequiredApis,missingHostCapabilities,missingPaths,violations:clone(violations),nodeOnlyToolPaths:[...declaration.nodeOnlyToolPaths],optionalWebApis:declaration.optionalWebApis.map(api=>({api,available:required.has(api)}))};
}
export function buildIntegrationBrowserMatrix(results=[]){return{kind:'IntegrationBrowserMatrix',results:clone(results),counts:Object.fromEntries(Object.values(BrowserMatrixState).map(s=>[s,results.filter(x=>x.state===s).length])),integrationAcceptance:results.length&&results.every(x=>x.state===BrowserMatrixState.PASS)?'PASS':'PARTIAL'};}
