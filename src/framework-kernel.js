import {ArtifactTypeRegistry} from './artifact-registry.js';
import {EventTypeRegistry} from './event-registry.js';
import {ContractVersionRegistry} from './contract-versioning.js';
import {ServiceDependencyGraph} from './dependency-graph.js';
import {GoldenWorldCertificationMatrix} from './certification-matrix.js';
import {CognitiveRepositoryRouter,InMemoryCognitiveRepository} from './cognitive-repository.js';
import {ServiceRegistry} from './service-registry.js';
import {CognitiveServiceConformanceKit} from './conformance-kit.js';

export class FrameworkKernel{
  constructor({isCurrentRevision=()=>true}={}){
    this.versions=new ContractVersionRegistry();this.artifacts=new ArtifactTypeRegistry({versionRegistry:this.versions});this.events=new EventTypeRegistry({versionRegistry:this.versions});this.dependencies=new ServiceDependencyGraph();this.certification=new GoldenWorldCertificationMatrix();
    this.repositories=new CognitiveRepositoryRouter();this.repositories.registerAdapter('memory',new InMemoryCognitiveRepository());for(const domain of ['sources','artifacts','temporal-state','episodes','reflections','graphs','vectors','ledger'])this.repositories.bindDomain(domain,'memory');
    this.services=new ServiceRegistry({artifactRegistry:this.artifacts,eventRegistry:this.events,versionRegistry:this.versions,dependencyGraph:this.dependencies,certificationMatrix:this.certification});
    this.conformance=new CognitiveServiceConformanceKit({framework:this,isCurrentRevision});
  }
  registerSubsystem(spec){return this.services.registerSubsystem(spec);}
}
export * from './framework-contracts.js';
export * from './artifact-registry.js';
export * from './event-registry.js';
export * from './contract-versioning.js';
export * from './cognitive-repository.js';
export * from './certification-matrix.js';
export * from './dependency-graph.js';
export * from './service-registry.js';
export * from './conformance-kit.js';
export * from './browser-host-conformance.js';
export * from './assembly-manifest.js';
