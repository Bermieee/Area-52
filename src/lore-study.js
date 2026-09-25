import { stableHash as browserStableHash } from './browser-runtime-utils.js';
import {
  AuthorityClass, KnowledgeStatus, MutationType,
  createAliasCandidate, createCapability, createClaim, createEntity, createEvent,
  createMutationProposal, createProperty, createRelationship, createRestriction, createRule,
  createProvenance,
} from './contracts.js';

const slug=(name)=>String(name).toLowerCase().replace(/^the\s+/i,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const clean=(value)=>String(value).replace(/[.,!?]$/,'').trim();
const stableHash=(value)=>browserStableHash(String(value),{length:16,alreadyString:true});
const stableId=(prefix,sourceId,signature)=>`${prefix}:${sourceId}:${stableHash(signature)}`;
const semanticKey=(subjectId,predicate,value)=>`${subjectId}|${predicate}|${JSON.stringify(value)}`;
const sentenceList=(content)=>String(content).split(/(?<=[.!?])\s+|\n+/).map(x=>x.trim()).filter(Boolean);

function entityDraft(name,entityType){const c=clean(name).replace(/^the\s+/i,'');return{id:slug(c),canonicalName:c,entityType,aliases:[clean(name)]};}

export class RuleBasedStudyAdapter {
  extract({exactContent,sourceType,at=0,source}){
    const defaultAuthority=sourceType==='EXPERIENCE'?AuthorityClass.OBSERVED:AuthorityClass.SOURCE_CANON;
    const entities=new Map(), aliases=[], claims=[], relationships=[], properties=[], rules=[], capabilities=[], restrictions=[], events=[], closures=[];
    const addEntity=(name,type)=>{const e=entityDraft(name,type);const prior=entities.get(e.id);entities.set(e.id,prior?{...prior,aliases:[...new Set([...prior.aliases,...e.aliases])]}:e);return e.id;};
    const addAlias=(entityId,alias,confidence=1)=>aliases.push({entityId,alias:clean(alias),confidence});
    const addEvent=(key,eventType,eventAt,entityIds,summary,metadata={})=>{events.push({key,eventType,at:eventAt,entityIds:[...new Set(entityIds)],summary,authorityClass:defaultAuthority,confidence:1,metadata});return key;};
    const addClaim=(subjectId,predicate,value,{temporalKind='CURRENT',claimAt=at,authorityClass=defaultAuthority,confidence=1,claimType='FACT',slotPolicy='SINGLE',explicitness='EXPLICIT',eventKey=null,evidenceTime=at}={})=>claims.push({subjectId,predicate,value,temporalKind,at:claimAt,authorityClass,confidence,claimType,slotPolicy,explicitness,eventKey,evidenceTime,semanticKey:semanticKey(subjectId,predicate,value)});
    const addRelationship=(subjectId,predicate,objectId,{temporalKind='TIMELESS',claimAt=at,authorityClass=defaultAuthority,confidence=1,eventKey=null,causal=false}={})=>relationships.push({subjectId,predicate,objectId,temporal:{kind:temporalKind,validFrom:claimAt,validUntil:null},authorityClass,confidence,eventKey,metadata:{causal}});
    const addProperty=(subjectId,predicate,value)=>properties.push({subjectId,predicate,value,temporal:{kind:'TIMELESS',validFrom:at,validUntil:null},authorityClass:defaultAuthority,confidence:1});
    const addRule=(subjectId,predicate,value,objectId=null)=>rules.push({subjectId,predicate,value,objectId,temporal:{kind:'TIMELESS',validFrom:at,validUntil:null},authorityClass:defaultAuthority,confidence:1});
    const addCapability=(subjectId,predicate,objectId)=>capabilities.push({subjectId,predicate,objectId,temporal:{kind:'TIMELESS',validFrom:at,validUntil:null},authorityClass:defaultAuthority,confidence:1});
    const addRestriction=(subjectId,predicate,value,objectId=null)=>restrictions.push({subjectId,predicate,value,objectId,temporal:{kind:'TIMELESS',validFrom:at,validUntil:null},authorityClass:defaultAuthority,confidence:1});

    for(const sentence of sentenceList(exactContent)){
      let m;
      if((m=sentence.match(/^(.+?), also called (.+?), owns the (.+?)\.$/i))){
        const owner=addEntity(m[1],'PERSON'),alias=m[2],place=addEntity(m[3],'PLACE');addAlias(owner,alias);addClaim(place,'owner',owner,{claimType:'OWNERSHIP'});addRelationship(owner,'owns',place);
      } else if((m=sentence.match(/^(.+?) owns the (.+?)\.$/i))){
        const owner=addEntity(m[1],'PERSON'),place=addEntity(m[2],'PLACE');addClaim(place,'owner',owner,{claimType:'OWNERSHIP'});addRelationship(owner,'owns',place);
      } else if((m=sentence.match(/^The (.+?) has belonged to (.+?) for (\d+) years\.$/i))){
        const place=addEntity(m[1],'PLACE'),owner=addEntity(m[2],'PERSON'),years=Number(m[3]);addClaim(place,'owner',owner,{claimAt:at-years,claimType:'OWNERSHIP'});addRelationship(owner,'owns',place,{claimAt:at-years});
      } else if((m=sentence.match(/^The (.+?) is intact and owned by (.+?)\.$/i))){
        const place=addEntity(m[1],'PLACE'),owner=addEntity(m[2],'PERSON');addClaim(place,'state','intact',{claimType:'STATE'});addClaim(place,'owner',owner,{claimType:'OWNERSHIP'});addRelationship(owner,'owns',place);
      } else if((m=sentence.match(/^The (.+?) is carried by (.+?)(?: and forged by (.+?))?\.$/i))){
        const object=addEntity(m[1],'OBJECT'),carrier=addEntity(m[2],'PERSON');addClaim(object,'location',carrier,{claimType:'LOCATION'});addRelationship(carrier,'carries',object,{temporalKind:'CURRENT'});
        if(m[3]){const maker=addEntity(m[3],'PERSON');addClaim(object,'forgedBy',maker,{temporalKind:'TIMELESS',claimType:'PROPERTY',slotPolicy:'MULTI'});addRelationship(maker,'forged',object);}
      } else if((m=sentence.match(/^(.+?) knows (.+?)\.$/i))){
        const a=addEntity(m[1],'PERSON'),b=addEntity(m[2],'PERSON');addClaim(a,'knows',b,{temporalKind:'TIMELESS',claimType:'RELATIONSHIP',slotPolicy:'MULTI'});addRelationship(a,'knows',b);
      } else if((m=sentence.match(/^(.+?) trusts (.+?)\.$/i))){
        const a=addEntity(m[1],'PERSON'),b=addEntity(m[2],'PERSON');addClaim(a,'trusts',b,{claimType:'RELATIONSHIP',slotPolicy:'MULTI'});addRelationship(a,'trusts',b,{temporalKind:'CURRENT'});
      } else if((m=sentence.match(/^The (.+?) is (silver|golden|black|white|ancient|enchanted)\.$/i))){
        const object=addEntity(m[1],'OBJECT');addProperty(object,'appearance',m[2].toLowerCase());
      } else if((m=sentence.match(/^Only members of the (.+?) may enter the (.+?)\.$/i))){
        const group=addEntity(m[1],'GROUP'),place=addEntity(m[2],'PLACE');addRule(place,'entryRequiresMembership',group,group);
      } else if((m=sentence.match(/^(.+?) can wield the (.+?)\.$/i))){
        const person=addEntity(m[1],'PERSON'),object=addEntity(m[2],'OBJECT');addCapability(person,'canWield',object);
      } else if((m=sentence.match(/^The (.+?) cannot be drawn inside the (.+?)\.$/i))){
        const object=addEntity(m[1],'OBJECT'),place=addEntity(m[2],'PLACE');addRestriction(object,'cannotBeDrawnInside',place,place);
      } else if((m=sentence.match(/^(.+?) leaves the (.+?) at the (.+?)\.$/i))){
        const actor=addEntity(m[1],'PERSON'),object=addEntity(m[2],'OBJECT'),place=addEntity(m[3],'PLACE');const key=`leave:${actor}:${object}:${place}:${at}`;addEvent(key,'DEPOSIT',at,[actor,object,place],sentence);addClaim(object,'location',place,{claimType:'LOCATION',eventKey:key});addRelationship(actor,'left',object,{temporalKind:'HISTORICAL',eventKey:key});addRelationship(object,'locatedAt',place,{temporalKind:'CURRENT',eventKey:key});
      } else if((m=sentence.match(/^(.+?) departs the (.+?)\.$/i))){
        const actor=addEntity(m[1],'PERSON'),place=addEntity(m[2],'PLACE');const key=`depart:${actor}:${place}:${at}`;addEvent(key,'DEPARTURE',at,[actor,place],sentence);closures.push({subjectId:actor,predicate:'presentAt',at,reason:'departed-location',eventKey:key});
      } else if((m=sentence.match(/^(.+?) joins the (.+?)\.$/i))){
        const actor=addEntity(m[1],'PERSON'),group=addEntity(m[2],'GROUP');const key=`join:${actor}:${group}:${at}`;addEvent(key,'JOIN',at,[actor,group],sentence);addClaim(actor,'memberOf',group,{claimType:'TEMPORAL_RELATIONSHIP',eventKey:key});addRelationship(actor,'memberOf',group,{temporalKind:'CURRENT',eventKey:key});
      } else if((m=sentence.match(/^(.+?) leaves the (.+?)\.$/i))){
        const actor=addEntity(m[1],'PERSON'),group=addEntity(m[2],'GROUP');const key=`leave-group:${actor}:${group}:${at}`;addEvent(key,'LEAVE_GROUP',at,[actor,group],sentence);closures.push({subjectId:actor,predicate:'memberOf',at,reason:'left-group',eventKey:key});
      } else if((m=sentence.match(/^The (.+?) burns down\.$/i))){
        const place=addEntity(m[1],'PLACE');const key=`fire:${place}:${at}`;addEvent(key,'FIRE',at,[place],sentence,{explicitEffect:'destroyed'});addClaim(place,'state','destroyed',{claimType:'STATE',eventKey:key});
      } else if((m=sentence.match(/^The (.+?) is destroyed in the fire\.$/i))){
        const object=addEntity(m[1],'OBJECT');const key=`fire-destroyed:${object}:${at}`;addEvent(key,'FIRE_DESTRUCTION',at,[object],sentence,{explicitCause:'fire'});addClaim(object,'state','destroyed',{claimType:'STATE',eventKey:key});closures.push({subjectId:object,predicate:'location',at,reason:'destroyed-object-has-no-current-location',eventKey:key});addRelationship('fire', 'causedDestructionOf', object,{temporalKind:'HISTORICAL',claimAt:at,eventKey:key,causal:true});
      } else if((m=sentence.match(/^The (.+?) is (intact|damaged|repaired|destroyed)\.$/i))){
        const object=addEntity(m[1],'OBJECT');const state=m[2].toLowerCase();const key=`state:${object}:${state}:${at}`;addEvent(key,'STATE_CHANGE',at,[object],sentence,{state});addClaim(object,'state',state,{claimType:'STATE',eventKey:key});if(state==='destroyed')closures.push({subjectId:object,predicate:'location',at,reason:'destroyed-object-has-no-current-location',eventKey:key});
      } else if((m=sentence.match(/^The (.+?) was left inside the (.+?)\.$/i))){
        const object=addEntity(m[1],'OBJECT'),place=addEntity(m[2],'PLACE');addClaim(object,'location',place,{temporalKind:'HISTORICAL',claimType:'LOCATION'});addRelationship(object,'locatedAt',place,{temporalKind:'HISTORICAL'});
      } else if((m=sentence.match(/^A later recovered journal claims the (.+?) survived the fire\.$/i))){
        const object=addEntity(m[1],'OBJECT'),claimAt=Number.isFinite(source.metadata?.claimAt)?source.metadata.claimAt:at;const key=`report-survival:${object}:${at}`;addEvent(key,'RECOVERED_REPORT',at,[object],sentence,{reportedAt:at,claimAt});addClaim(object,'state','survived',{temporalKind:'UNRESOLVED',claimAt,authorityClass:AuthorityClass.UNRESOLVED,confidence:.45,claimType:'STATE',explicitness:'REPORTED',eventKey:key,evidenceTime:at});
      } else if((m=sentence.match(/^A recovered journal claims someone removed the (.+?) shortly before the fire\.$/i))){
        const object=addEntity(m[1],'OBJECT'),claimAt=Number.isFinite(source.metadata?.claimAt)?source.metadata.claimAt:Math.max(0,at-1);const key=`report-removed:${object}:${at}`;addEvent(key,'RECOVERED_REPORT',at,[object],sentence,{reportedAt:at,claimAt});addClaim(object,'state','survived',{temporalKind:'UNRESOLVED',claimAt,authorityClass:AuthorityClass.UNRESOLVED,confidence:.4,claimType:'STATE',explicitness:'INFERRED_FROM_REPORT',eventKey:key,evidenceTime:at});addRelationship('unknown-remover','removed',object,{temporalKind:'UNRESOLVED',claimAt,authorityClass:AuthorityClass.UNRESOLVED,confidence:.4,eventKey:key});
      } else if((m=sentence.match(/^(.+?) opens the (.+?) at (.+?)\.$/i))){
        const actor=addEntity(m[1],'PERSON'),place=addEntity(m[2],'PLACE'),location=addEntity(m[3],'PLACE');const key=`open:${actor}:${place}:${location}:${at}`;addEvent(key,'OPENING',at,[actor,place,location],sentence);addClaim(place,'owner',actor,{claimType:'OWNERSHIP',eventKey:key});addClaim(place,'location',location,{claimType:'LOCATION',eventKey:key});
      } else if((m=sentence.match(/^(.+?) (protects|shields|evacuates) civilians(?: during .+?| before .+?)?\.$/i))){
        const actor=addEntity(m[1],'PERSON');const key=`civilian-protection:${actor}:${at}`;addEvent(key,'BEHAVIOR_OBSERVATION',at,[actor],sentence);addClaim(actor,'behavior','prioritizes-civilian-safety',{temporalKind:'HISTORICAL',claimType:'OBSERVATION',slotPolicy:'MULTI',eventKey:key});
      } else if((m=sentence.match(/^(.+?) abandons civilians to pursue the attacker\.$/i))){
        const actor=addEntity(m[1],'PERSON');const key=`civilian-abandonment:${actor}:${at}`;addEvent(key,'BEHAVIOR_OBSERVATION',at,[actor],sentence);addClaim(actor,'behavior','prioritizes-pursuit-over-civilian-safety',{temporalKind:'HISTORICAL',claimType:'OBSERVATION',slotPolicy:'MULTI',eventKey:key});
      } else {
        throw new Error(`RuleBasedStudyAdapter has no deterministic extractor for: ${sentence}`);
      }
    }
    return{entities:[...entities.values()],aliases,claims,relationships,properties,rules,capabilities,restrictions,events,closures};
  }
}

export class LoreStudyEngine {
  constructor({registry,adapter=new RuleBasedStudyAdapter(),agent='lore-study:rule-reference'}){this.registry=registry;this.adapter=adapter;this.agent=agent;}
  prepareSource(sourceId){
    const source=this.registry.getSource(sourceId);if(!source)throw new Error(`Unknown source: ${sourceId}`);
    const revision=this.registry.getActiveRevision(sourceId);const at=Number.isFinite(source.metadata?.at)?source.metadata.at:0;
    const extracted=this.adapter.extract({exactContent:revision.exactContent,sourceType:source.sourceType,at,source,revision});
    return{kind:'PreparedStudy',source,revision,at,extracted};
  }
  prepareBatch(sourceIds,{batchSize=8}={}){
    if(!Array.isArray(sourceIds)||batchSize<1)throw new TypeError('prepareBatch requires sourceIds and positive batchSize');
    const batches=[];for(let i=0;i<sourceIds.length;i+=batchSize){const ids=sourceIds.slice(i,i+batchSize);batches.push({kind:'StudyBatch',id:`study-batch:${i/batchSize+1}`,sourceIds:ids,sourceRevisionIds:ids.map(id=>this.registry.getActiveRevision(id).id)});}return batches;
  }
  executeBatch(batch){return{kind:'StudyBatchExecution',batchId:batch.id,prepared:batch.sourceIds.map(id=>this.prepareSource(id))};}
  validateBatch(execution){
    const errors=[],seen=new Set();
    for(const prepared of execution.prepared){if(!this.registry.isActiveRevision(prepared.revision.id))errors.push(`stale:${prepared.revision.id}`);for(const item of prepared.extracted.claims){const key=`${prepared.source.id}:${item.semanticKey}`;if(seen.has(key))errors.push(`duplicate:${key}`);seen.add(key);}}
    return{kind:'StudyBatchValidation',batchId:execution.batchId,valid:errors.length===0,errors,execution};
  }
  commitBatch(validation){if(!validation.valid)throw new Error(`Cannot commit invalid study batch: ${validation.errors.join(',')}`);return validation.execution.prepared.map(p=>this.commitPrepared(p));}
  studySource(sourceId){return this.commitPrepared(this.prepareSource(sourceId));}

  commitPrepared(prepared){
    const{source,revision,at,extracted}=prepared;if(!this.registry.isActiveRevision(revision.id))throw new Error(`Prepared study is stale: ${revision.id}`);
    const contextualId=`context:${source.id}`;
    const contextual=this.registry.registerDerivedArtifact({artifactId:contextualId,artifact:{kind:'ContextualSource',sourceRevisionId:revision.id,context:{sourceType:source.sourceType,logicalKey:source.logicalKey,at,evidenceType:source.metadata?.evidenceType??null},exactTextHash:revision.contentHash},sourceRevisionIds:[revision.id],activity:'CONTEXTUALIZE',agent:this.agent});
    const pending=(id,activity)=>createProvenance({id:`pending:${id}`,sourceRevisionIds:[revision.id],activity,agent:this.agent});
    const eventIds=new Map();
    const events=extracted.events.map(item=>{const id=stableId('event',source.id,`${item.key}|${item.eventType}|${item.at}`);eventIds.set(item.key,id);const built=createEvent({id,eventType:item.eventType,at:item.at,entityIds:item.entityIds,summary:item.summary,authorityClass:item.authorityClass,confidence:item.confidence,provenance:pending(id,'EVENT_EXTRACT'),metadata:item.metadata});return this.registry.registerDerivedArtifact({artifactId:id,artifact:built,sourceRevisionIds:[revision.id],dependsOnArtifactIds:[contextualId],activity:'EVENT_EXTRACT',agent:this.agent});});
    const entities=extracted.entities.map(item=>{const id=`entity-mention:${source.id}:${item.id}`;const built=createEntity({...item,provenance:pending(id,'ENTITY_EXTRACT')});return this.registry.registerDerivedArtifact({artifactId:id,artifact:built,sourceRevisionIds:[revision.id],dependsOnArtifactIds:[contextualId],activity:'ENTITY_EXTRACT',agent:this.agent});});
    const aliases=extracted.aliases.map(item=>{const id=stableId('alias',source.id,`${item.entityId}|${item.alias}`);const built=createAliasCandidate({id,alias:item.alias,entityId:item.entityId,confidence:item.confidence,provenance:pending(id,'ALIAS_EXTRACT')});return this.registry.registerDerivedArtifact({artifactId:id,artifact:built,sourceRevisionIds:[revision.id],dependsOnArtifactIds:[contextualId],activity:'ALIAS_EXTRACT',agent:this.agent});});
    const typed=(items,prefix,ctor,activity)=>items.map(item=>{const signature=`${item.subjectId}|${item.predicate}|${item.objectId??''}|${JSON.stringify(item.value)}|${JSON.stringify(item.temporal)}`;const id=stableId(prefix,source.id,signature);const deps=[contextualId,item.eventKey?eventIds.get(item.eventKey):null].filter(Boolean);const built=ctor({id,...item,provenance:pending(id,activity)});return this.registry.registerDerivedArtifact({artifactId:id,artifact:built,sourceRevisionIds:[revision.id],dependsOnArtifactIds:deps,activity,agent:this.agent});});
    const properties=typed(extracted.properties,'property',createProperty,'PROPERTY_EXTRACT');
    const rules=typed(extracted.rules,'rule',createRule,'RULE_EXTRACT');
    const capabilities=typed(extracted.capabilities,'capability',createCapability,'CAPABILITY_EXTRACT');
    const restrictions=typed(extracted.restrictions,'restriction',createRestriction,'RESTRICTION_EXTRACT');
    const relationships=typed(extracted.relationships,'relationship',createRelationship,'RELATIONSHIP_EXTRACT');
    const claims=extracted.claims.map(item=>{const stableIdentity=stableId('claim-stable',source.id,item.semanticKey);const id=`claim:${revision.id}:${stableHash(item.semanticKey)}`;const deps=[contextualId,item.eventKey?eventIds.get(item.eventKey):null].filter(Boolean);const claim=createClaim({id,subjectId:item.subjectId,predicate:item.predicate,value:item.value,temporal:{kind:item.temporalKind,validFrom:item.at,validUntil:null},authorityClass:item.authorityClass,confidence:item.confidence,status:item.temporalKind==='HISTORICAL'?KnowledgeStatus.HISTORICAL:item.temporalKind==='UNRESOLVED'?KnowledgeStatus.UNRESOLVED:item.temporalKind==='UNCERTAIN'?KnowledgeStatus.UNCERTAIN:KnowledgeStatus.CURRENT,provenance:pending(id,'CLAIM_EXTRACT'),semanticKey:item.semanticKey,stableIdentity,claimType:item.claimType,slotPolicy:item.slotPolicy,explicitness:item.explicitness,evidenceTime:item.evidenceTime});return this.registry.registerDerivedArtifact({artifactId:id,artifact:claim,sourceRevisionIds:[revision.id],dependsOnArtifactIds:deps,activity:'CLAIM_EXTRACT',agent:this.agent});});
    const closures=extracted.closures.map(item=>{const id=stableId('closure',source.id,`${item.subjectId}|${item.predicate}|${item.at}|${item.reason}`);const deps=[contextualId,item.eventKey?eventIds.get(item.eventKey):null].filter(Boolean);return this.registry.registerDerivedArtifact({artifactId:id,artifact:{kind:'SlotClosure',id,...item},sourceRevisionIds:[revision.id],dependsOnArtifactIds:deps,activity:'TEMPORAL_CLASSIFY',agent:this.agent});});
    const proposals=claims.map(claim=>createMutationProposal({id:`proposal:set:${claim.id}:${revision.id}`,mutationType:MutationType.SET_CLAIM,owner:'WORLD_STATE',sourceRevisionIds:[revision.id],evidenceIds:[claim.id],payload:{claim}}));
    for(const closure of closures)proposals.push(createMutationProposal({id:`proposal:close:${closure.id}:${revision.id}`,mutationType:MutationType.CLOSE_SLOT,owner:'WORLD_STATE',sourceRevisionIds:[revision.id],evidenceIds:[closure.id],payload:closure}));
    return{source,revision,contextual,entities,aliases,claims,relationships,properties,rules,capabilities,restrictions,events,closures,proposals};
  }
}
