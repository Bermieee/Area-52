import test from 'node:test';
import assert from 'node:assert/strict';
import {
FrameworkKernel,ArtifactTypeRegistry,ContractVersionRegistry,
InMemoryCognitiveRepository,ObjectFixtureCognitiveRepository,runRepositoryContractSuite,
SubsystemLifecycle,AuthorityPermission,CompatibilityStatus,FrameworkFailureCode,
createArtifactEnvelope,createCognitiveEventEnvelope,createAssemblyLaneEntry,verifyAssemblyLane,
inspectBrowserHostSource,
} from '../src/framework-kernel.js';
import {createEconomyFramework,economyArtifact,economyEvent,runFrameworkWave1GoldenWorld} from './framework-wave1-harness.js';
const manifest=(id,extra={})=>({subsystemId:id,version:'1.0.0',owner:'TEST',lifecycleState:SubsystemLifecycle.EXPERIMENTAL,failureBehavior:{recovery:'REBUILD',diagnostics:true},diagnostics:{snapshot:true},...extra});
const certify=(f,failed=null)=>{for(const id of ['truth','history','provenance','stale-revision','authority','recovery','latency-resource'])f.certification.record('test-world-economy',{testId:id,pass:id!==failed});};
test('unknown subsystem registers through public framework surfaces',()=>{
const f=createEconomyFramework(),i=f.services.inspect('test-world-economy');
assert.ok(i);assert.equal(f.artifacts.has('EconomySignal'),true);assert.equal(f.events.has('ECONOMY_SIGNAL_READY'),true);
assert.deepEqual(i.manifest.producedArtifactTypes.map(x=>x.id),['EconomySignal']);assert.equal(i.dependencies.missingOptional.includes('optional-market-oracle'),true);
});
test('manifest registration fails safely for malformed, duplicate, incompatible and hidden authority declarations',()=>{
const f=new FrameworkKernel();assert.throws(()=>f.services.register({version:'1',owner:'X'}),e=>e.code===FrameworkFailureCode.MALFORMED_MANIFEST);
f.services.register(manifest('dup'));assert.throws(()=>f.services.register(manifest('dup')),e=>e.code===FrameworkFailureCode.DUPLICATE_SERVICE);
assert.throws(()=>f.services.register(manifest('future',{contractVersion:'9.0.0'})),e=>e.code===FrameworkFailureCode.INCOMPATIBLE_CONTRACT);
assert.throws(()=>f.services.register(manifest('hidden',{authorityPermissions:['INVENTED_DIRECT_WRITE']})),e=>e.code===FrameworkFailureCode.MALFORMED_MANIFEST);
assert.throws(()=>f.registerSubsystem({manifest:manifest('missing',{producedArtifactTypes:['NeverRegistered']})}),e=>e.code==='DECLARED_TYPE_UNREGISTERED');
});
test('artifact registry is extensible without granting canonical authority',()=>{
const r=new ArtifactTypeRegistry();assert.equal(r.has('Claim'),true);r.registerType({artifactType:'FutureArtifact',owner:'future',validatePayload:p=>p?.ok===true,allowedAuthorities:['INFERRED']});
const good=r.validateEnvelope(createArtifactEnvelope({artifactId:'f1',artifactType:'FutureArtifact',owner:'future',authority:'INFERRED',provenance:{sourceRevisionIds:['s@1']},payload:{ok:true}}));
assert.equal(good.ok,true);assert.equal(good.authorityGranted,false);assert.equal(r.inspect('FutureArtifact').settlementAuthority,false);
assert.equal(r.validateEnvelope({...good.envelope,artifactId:'u',artifactType:'Unknown'}).code,FrameworkFailureCode.UNKNOWN_ARTIFACT_TYPE);
assert.equal(r.validateEnvelope({...good.envelope,artifactId:'a',authority:'SOURCE_CANON'}).code,FrameworkFailureCode.UNDECLARED_AUTHORITY);
assert.equal(r.validateEnvelope({...good.envelope,artifactId:'v',schemaVersion:'9.0.0'}).code,FrameworkFailureCode.ARTIFACT_VERSION_INCOMPATIBLE);
});
test('artifact envelope retains provenance, revision, dependencies and payload',()=>{
const f=createEconomyFramework(),input=economyArtifact(),out=f.artifacts.validateEnvelope(input);assert.equal(out.ok,true);
assert.deepEqual(out.envelope.provenance,input.provenance);assert.equal(out.envelope.revision,1);assert.deepEqual(out.envelope.dependencies,['world@1']);assert.deepEqual(out.envelope.payload,{index:42});
});
test('contract versioning reports deprecated, additive, future and invalid versions',()=>{
const v=new ContractVersionRegistry();v.registerContract({contractId:'demo',currentVersion:'1.2.0',supportedVersions:['1.0.0'],deprecatedVersions:['1.0.0'],validate:()=>true});
assert.equal(v.compatibility('demo','1.0.0').status,CompatibilityStatus.DEPRECATED);assert.equal(v.compatibility('demo','1.1.0').status,CompatibilityStatus.COMPATIBLE);
assert.equal(v.compatibility('demo','2.0.0').status,CompatibilityStatus.UNSUPPORTED_FUTURE);assert.equal(v.compatibility('demo','bogus').status,CompatibilityStatus.INVALID_VERSION);
});
test('migrations are deterministic and cannot escalate authority',()=>{
const v=new ContractVersionRegistry();v.registerContract({contractId:'legacy',currentVersion:'1.0.0',validate:x=>x?.payload?.newField===true});v.registerMigration('legacy',{fromVersion:'0.9.0',toVersion:'1.0.0',migrate:x=>({...x,payload:{...x.payload,newField:true}})});
const old={artifactId:'a',owner:'o',authority:'INFERRED',provenance:{s:1},revision:1,schemaVersion:'0.9.0',payload:{}};assert.equal(v.migrate('legacy',old,{fromVersion:'0.9.0'}).payload.newField,true);
assert.throws(()=>v.migrate('legacy',old,{fromVersion:'0.8.0'}),e=>e.code===FrameworkFailureCode.MIGRATION_MISSING);
const bad=new ContractVersionRegistry();bad.registerContract({contractId:'bad',currentVersion:'1.0.0',validate:()=>true});bad.registerMigration('bad',{fromVersion:'0.9.0',toVersion:'1.0.0',migrate:()=>null});assert.throws(()=>bad.migrate('bad',old,{fromVersion:'0.9.0'}),e=>e.code===FrameworkFailureCode.MIGRATION_OUTPUT_INVALID);
const attack=new ContractVersionRegistry();attack.registerContract({contractId:'attack',currentVersion:'1.0.0',validate:()=>true});attack.registerMigration('attack',{fromVersion:'0.9.0',toVersion:'1.0.0',migrate:x=>({...x,authority:'SOURCE_CANON'})});assert.throws(()=>attack.migrate('attack',old,{fromVersion:'0.9.0'}),e=>e.code===FrameworkFailureCode.MIGRATION_PROTECTED_FIELD_CHANGED);
});
test('required/optional dependencies degrade, recover and cycles reject',()=>{
const f=new FrameworkKernel();f.services.register(manifest('consumer',{requiredDependencies:['required'],optionalDependencies:['optional']}));let s=f.services.inspect('consumer').dependencies;assert.equal(s.canActivate,false);
f.services.register(manifest('required'));s=f.services.inspect('consumer').dependencies;assert.equal(s.canActivate,true);assert.equal(s.degraded,true);f.services.register(manifest('optional'));assert.equal(f.services.inspect('consumer').dependencies.degraded,false);
f.services.unregister('optional');assert.equal(f.services.inspect('consumer').dependencies.degraded,true);f.services.register(manifest('optional'));assert.equal(f.services.inspect('consumer').dependencies.degraded,false);
f.services.register(manifest('A',{requiredDependencies:['B']}));f.services.register(manifest('B',{requiredDependencies:['C']}));assert.throws(()=>f.services.register(manifest('C',{requiredDependencies:['A']})),e=>e.code===FrameworkFailureCode.DEPENDENCY_CYCLE);assert.equal(f.services.has('C'),false);
});
test('capability discovery is declarative and provider-neutral',()=>{
const f=new FrameworkKernel();f.services.register(manifest('provider',{providedCapabilities:['truth.verify']}));f.services.register(manifest('consumer',{requiredCapabilities:['truth.verify'],optionalCapabilities:['future.predict']}));const c=f.services.inspect('consumer').capabilities;
assert.equal(c.required['truth.verify'][0].subsystemId,'provider');assert.deepEqual(c.missingRequired,[]);assert.deepEqual(c.missingOptional,['future.predict']);
});
test('two repository adapters share deterministic revision semantics without owning truth',()=>{
assert.equal(runRepositoryContractSuite(new InMemoryCognitiveRepository()).pass,true);assert.equal(runRepositoryContractSuite(new ObjectFixtureCognitiveRepository()).pass,true);
const r=new InMemoryCognitiveRepository();r.put('artifacts','x',{status:'CURRENT',authority:'SOURCE_CANON'});assert.deepEqual(r.get('artifacts','x').value,{status:'CURRENT',authority:'SOURCE_CANON'});assert.equal('settle' in r,false);
});
test('lifecycle fences SHADOW, gates ACTIVE explicitly, supports rollback and rejects invalid transitions',()=>{
const f=createEconomyFramework();f.services.transition('test-world-economy',SubsystemLifecycle.SHADOW);const route=f.services.routeResult('test-world-economy',{destination:'FOREGROUND'});assert.equal(route.destination,'EVALUATION');assert.equal(route.canonicalMutationAllowed,false);
assert.throws(()=>f.services.transition('test-world-economy',SubsystemLifecycle.ACTIVE,{operatorApproved:true}),e=>e.code===FrameworkFailureCode.CERTIFICATION_REQUIRED);certify(f);assert.throws(()=>f.services.transition('test-world-economy',SubsystemLifecycle.ACTIVE),e=>e.code===FrameworkFailureCode.CERTIFICATION_REQUIRED);
f.services.transition('test-world-economy',SubsystemLifecycle.ACTIVE,{operatorApproved:true});f.services.transition('test-world-economy',SubsystemLifecycle.SHADOW);assert.throws(()=>f.services.transition('test-world-economy',SubsystemLifecycle.SHADOW),e=>e.code===FrameworkFailureCode.LIFECYCLE_TRANSITION_INVALID);
});
test('ACTIVE never bypasses Settlement or Context Seal',()=>{
const f=createEconomyFramework();f.services.transition('test-world-economy',SubsystemLifecycle.SHADOW);certify(f);f.services.transition('test-world-economy',SubsystemLifecycle.ACTIVE,{operatorApproved:true});
assert.equal(f.services.authorize('test-world-economy','DIRECT_CANONICAL_MUTATION').code,FrameworkFailureCode.SETTLEMENT_REQUIRED);assert.equal(f.services.authorize('test-world-economy','DIRECT_PROMPT_INJECTION').code,FrameworkFailureCode.CONTEXT_SEAL_REQUIRED);assert.equal(f.services.authorize('test-world-economy',AuthorityPermission.PROPOSE_CANONICAL_MUTATION).allowed,false);
});
test('DEPRECATED remains inspectable but receives no new work',()=>{const f=createEconomyFramework();f.services.transition('test-world-economy',SubsystemLifecycle.DEPRECATED);assert.ok(f.services.inspect('test-world-economy'));assert.equal(f.services.routeResult('test-world-economy',{destination:'BACKGROUND'}).accepted,false);});
test('event registry accepts registered types, versions and dedupes while rejecting unsupported events',()=>{
const f=createEconomyFramework(),e=economyEvent(),first=f.events.accept(e),second=f.events.accept(e);assert.equal(first.ok,true);assert.equal(second.duplicate,true);assert.equal(second.event.correlationId,e.correlationId);
assert.equal(f.events.validate({...e,eventId:'u',eventType:'UNKNOWN'}).code,FrameworkFailureCode.EVENT_TYPE_UNKNOWN);assert.equal(f.events.validate({...e,eventId:'future',dedupeIdentity:'future',eventVersion:'9.0.0'}).code,FrameworkFailureCode.EVENT_VERSION_INCOMPATIBLE);
const compatible=f.events.validate({...e,eventId:'c',dedupeIdentity:'c',eventVersion:'1'});assert.equal(compatible.ok,true);assert.equal(compatible.compatibility.status,CompatibilityStatus.COMPATIBLE);
});
test('event envelope preserves causation, correlation and revision fences',()=>{const e=createCognitiveEventEnvelope({eventId:'e',eventType:'X',producer:'P',correlationId:'corr',causationId:'cause',turnId:'t',taskId:'task',sourceRevisionSet:['s@1'],worldRevision:4,sceneRevision:2,dedupeIdentity:'d',payload:{x:1}});assert.equal(e.causationId,'cause');assert.equal(e.correlationId,'corr');assert.deepEqual(e.sourceRevisionSet,['s@1']);assert.equal(e.worldRevision,4);});
test('conformance kit passes valid service and returns precise negative codes',()=>{
const f=createEconomyFramework({isCurrentRevision:id=>id!=='stale@1'});f.services.transition('test-world-economy',SubsystemLifecycle.SHADOW);const valid=f.conformance.run({serviceId:'test-world-economy',artifactSamples:[economyArtifact()],eventSamples:[economyEvent()],resultSamples:[{semantic:true,provenance:{sourceRevisionIds:['world@1']},sourceRevisionIds:['world@1'],destination:'EVALUATION'}]});assert.equal(valid.pass,true,JSON.stringify(valid));
const probes=[
[{semantic:true,sourceRevisionIds:['world@1'],destination:'EVALUATION'},FrameworkFailureCode.MISSING_PROVENANCE],
[{semantic:true,provenance:{sourceRevisionIds:['stale@1']},sourceRevisionIds:['stale@1'],destination:'EVALUATION'},FrameworkFailureCode.STALE_RESULT],
[{semantic:true,provenance:{},requestedAuthority:AuthorityPermission.PROPOSE_CANONICAL_MUTATION,destination:'EVALUATION'},FrameworkFailureCode.LIFECYCLE_AUTHORITY_BLOCKED],
[{semantic:true,provenance:{},directPromptInjection:true,destination:'EVALUATION'},FrameworkFailureCode.CONTEXT_SEAL_REQUIRED],
[{semantic:true,provenance:{},directCanonicalMutation:true,destination:'EVALUATION'},FrameworkFailureCode.SETTLEMENT_REQUIRED],
[{semantic:true,provenance:{},destination:'FOREGROUND'},FrameworkFailureCode.LIFECYCLE_AUTHORITY_BLOCKED],
];for(const [probe,code] of probes)assert.ok(f.conformance.checkResult('test-world-economy',probe).failures.some(x=>x.code===code));
});
test('conformance distinguishes unknown schema, incompatible event and missing dependency',()=>{
const f=new FrameworkKernel();f.services.register(manifest('broken',{requiredDependencies:['missing']}));const out=f.conformance.run({serviceId:'broken',artifactSamples:[{artifactId:'x',artifactType:'NOPE',owner:'broken',authority:'INFERRED',provenance:{},payload:{}}],eventSamples:[{eventId:'e',eventType:'NOPE',producer:'broken',correlationId:'c',dedupeIdentity:'e',payload:{}}]});
assert.ok(out.checks.some(x=>x.code===FrameworkFailureCode.UNKNOWN_ARTIFACT_TYPE));assert.ok(out.checks.some(x=>x.code===FrameworkFailureCode.EVENT_TYPE_UNKNOWN));assert.ok(out.checks.some(x=>x.code===FrameworkFailureCode.DEPENDENCY_REQUIRED_MISSING));
const e=createEconomyFramework();e.services.transition('test-world-economy',SubsystemLifecycle.SHADOW);const bad=e.conformance.run({serviceId:'test-world-economy',eventSamples:[economyEvent({id:'future',eventVersion:'9.0.0'})],requireDiagnostics:false});assert.ok(bad.checks.some(x=>x.code===FrameworkFailureCode.EVENT_VERSION_INCOMPATIBLE));
});
test('one failed mandatory golden-world certification blocks ACTIVE',()=>{const f=createEconomyFramework();f.services.transition('test-world-economy',SubsystemLifecycle.SHADOW);certify(f,'provenance');const s=f.certification.status('test-world-economy',f.services.manifest('test-world-economy'));assert.equal(s.eligible,false);assert.deepEqual(s.failed,['provenance']);assert.throws(()=>f.services.transition('test-world-economy',SubsystemLifecycle.ACTIVE,{operatorApproved:true}),e=>e.code===FrameworkFailureCode.CERTIFICATION_REQUIRED);});
test('browser-host conformance rejects Node-only assumptions',()=>{assert.equal(inspectBrowserHostSource({path:'safe.js',source:'export const x=structuredClone({a:1});'}).pass,true);for(const source of ["import crypto from 'node:crypto'","Buffer.from('x')","process.cwd()","require('fs')","readFileSync('x')"])assert.equal(inspectBrowserHostSource({path:'unsafe.js',source}).pass,false);});
test('assembly verifier distinguishes exact, patched, stale, missing and drift',()=>{
const entry=createAssemblyLaneEntry({sourceBranch:'Development-Nexus',sourceSha:'accepted',copiedPaths:[{path:'a',sourceDigest:'A'},{path:'b',sourceDigest:'B'},{path:'c',sourceDigest:'C'}],integrationOnlyPatches:[{path:'b',expectedDigest:'BP'}],acceptanceEvidence:['CI'],integrationSha:'main1'});
let r=verifyAssemblyLane(entry,{sourceHeadSha:'accepted',observedFiles:{a:{digest:'A'},b:{digest:'BP'},c:{digest:'X'}}});assert.deepEqual(r.rows.map(x=>x.state),['EXACT','INTEGRATION_PATCHED','UNEXPECTED_DRIFT']);r=verifyAssemblyLane(entry,{sourceHeadSha:'newer',observedFiles:{a:{digest:'A'},b:{digest:'BP'}}});assert.equal(r.rows[0].state,'STALE_COPY');assert.equal(r.rows[2].state,'MISSING');
});
test('synthetic lifecycle golden world passes',()=>{const r=runFrameworkWave1GoldenWorld();assert.equal(r.pass,true,JSON.stringify(r.metrics));});
test('framework stress: 550 services, 1100 artifacts/events, duplicate attempts and repository churn stay bounded',()=>{
const f=new FrameworkKernel();f.artifacts.registerType({artifactType:'StressArtifact',owner:'stress',validatePayload:p=>Number.isInteger(p?.n)});f.events.registerType({eventType:'STRESS_EVENT',owner:'stress',validatePayload:p=>Number.isInteger(p?.n)});
for(let i=0;i<550;i++)f.services.register(manifest(`stress-${i}`));for(let i=0;i<1100;i++){assert.equal(f.artifacts.validateEnvelope({artifactId:`a-${i}`,artifactType:'StressArtifact',owner:'stress',authority:'INFERRED',provenance:{sourceRevisionIds:[`s@${i}`]},payload:{n:i}}).ok,true);assert.equal(f.events.accept({eventId:`e-${i}`,eventType:'STRESS_EVENT',producer:'stress',correlationId:`c-${i}`,dedupeIdentity:`d-${i}`,payload:{n:i}}).duplicate,false);}
for(let i=0;i<100;i++)f.services.transition(`stress-${i}`,SubsystemLifecycle.SHADOW);const before=f.services.list().length;for(let i=0;i<100;i++)assert.throws(()=>f.services.register(manifest(`stress-${i}`)),e=>e.code===FrameworkFailureCode.DUPLICATE_SERVICE);assert.equal(f.services.list().length,before);
const alt=new ObjectFixtureCognitiveRepository();for(let i=0;i<500;i++){f.repositories.put('artifacts',`repo-${i}`,{n:i});alt.put('artifacts',`repo-${i}`,{n:i});}assert.equal(alt.list('artifacts').length,500);assert.equal(f.dependencies.findRequiredCycle(),null);assert.equal(new Set(f.services.list().map(x=>x.manifest.subsystemId)).size,550);
});
