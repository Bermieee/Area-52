export const DependencyReadiness=Object.freeze({READY:'READY',DEGRADED:'DEGRADED',BLOCKED:'BLOCKED'});
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean))].sort();
export function projectDependencyReadiness(serviceInfo){
  if(!serviceInfo)return{kind:'DependencyReadiness',state:DependencyReadiness.BLOCKED,missingRequiredDependencies:['SERVICE_MISSING'],missingOptionalDependencies:[],missingRequiredCapabilities:[],missingOptionalCapabilities:[],reasons:['SERVICE_MISSING']};
  const d=serviceInfo.dependencies??{},c=serviceInfo.capabilities??{},missingRequiredDependencies=uniq(d.missingRequired),missingOptionalDependencies=uniq(d.missingOptional),missingRequiredCapabilities=uniq(c.missingRequired),missingOptionalCapabilities=uniq(c.missingOptional);
  const blocked=missingRequiredDependencies.length||missingRequiredCapabilities.length||d.canActivate===false;
  const degraded=!blocked&&(missingOptionalDependencies.length||missingOptionalCapabilities.length||d.degraded===true||c.degraded===true);
  return{kind:'DependencyReadiness',state:blocked?DependencyReadiness.BLOCKED:degraded?DependencyReadiness.DEGRADED:DependencyReadiness.READY,
    missingRequiredDependencies,missingOptionalDependencies,missingRequiredCapabilities,missingOptionalCapabilities,
    reasons:[...(blocked?['REQUIRED_DEPENDENCY_OR_CAPABILITY_MISSING']:[]),...(degraded?['OPTIONAL_DEPENDENCY_OR_CAPABILITY_MISSING']:[])]};
}
export function inspectServiceReadiness(framework,serviceId){return projectDependencyReadiness(framework?.services?.inspect?.(serviceId)??null);}
