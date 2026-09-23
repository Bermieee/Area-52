import { Area52CognitiveCore } from '../src/cognitive-core.js';
import { EMBER_TAVERN_WORLD } from './fixtures/ember-tavern.js';

const tripleKey = ([s,p,v]) => JSON.stringify([s,p,v]);
const claimTriple = (claim) => [claim.subjectId, claim.predicate, claim.value];
const accuracy = (expected, actualClaims) => {
  const actual = new Set(actualClaims.map((claim) => tripleKey(claimTriple(claim))));
  const hits = expected.filter((row) => actual.has(tripleKey(row))).length;
  return expected.length ? hits / expected.length : 1;
};

export function runEmberTavernGoldenWorld({ core = new Area52CognitiveCore(), world = EMBER_TAVERN_WORLD } = {}) {
  for (const source of world.sources) core.importAndLearn({...source, at:0});
  for (const source of world.narrative) core.importAndLearn(source);

  const currentClaims = core.graph.currentClaims();
  const historicalClaims = core.graph.historicalClaims();
  const present = core.query(world.expected.presentQuery, {intent:'CURRENT',anchorEntityIds:['sun-blade','eris']});
  const historical = core.query(world.expected.historicalQuery, {intent:'HISTORICAL',anchorEntityIds:['eris','sun-blade']});
  const staleCurrentEscapes = present.packet.current.filter((fact) => fact.e === 'sun-blade' && fact.p === 'location' && fact.v === 'eris').length;
  const historicalCarryRecovered = historical.packet.historical.some((fact) => fact.e === 'sun-blade' && fact.p === 'location' && fact.v === 'eris');
  const packetFacts = [...historical.packet.current, ...historical.packet.historical, ...historical.packet.unresolved];
  const withProvenance = packetFacts.filter((fact) => (historical.packet.provenanceIndex[fact.id] ?? []).length > 0).length;
  const channels = new Set(historical.candidates.flatMap((candidate) => candidate.retrievalIntents));

  const ownerBefore = core.graph.currentClaims({subjectId:'ember-tavern',predicate:'owner'})[0]?.id ?? null;
  const edit = core.editAndRelearn('lore:sun-blade', 'The Sun Blade is carried by Eris and forged by Sol.');
  const ownerAfter = core.graph.currentClaims({subjectId:'ember-tavern',predicate:'owner'})[0]?.id ?? null;
  const postEdit = core.query(world.expected.historicalQuery, {intent:'HISTORICAL',anchorEntityIds:['sun-blade']});
  const relearnedCarry = postEdit.packet.historical.find((fact) => fact.e === 'sun-blade' && fact.p === 'location' && fact.v === 'eris');

  const metrics = {
    currentStateAccuracy: accuracy(world.expected.current, currentClaims),
    historicalStateAccuracy: accuracy(world.expected.historical, historicalClaims),
    staleCurrentEscapes,
    historicalCarryRecovered,
    provenanceCompleteness: packetFacts.length ? withProvenance / packetFacts.length : 1,
    retrievalChannelsCovered: ['exact','semantic','graph'].every((channel) => channels.has(channel)),
    dependencyConeInvalidated: edit.replacement.invalidatedArtifactIds.some((id) => id.startsWith('claim:lore:sun-blade@1')),
    unrelatedKnowledgeSurvived: Boolean(ownerBefore && ownerBefore === ownerAfter),
    oldRevisionRecoverable: core.registry.getRevision('lore:sun-blade@1')?.exactContent === 'The Sun Blade is carried by Eris.',
    activeRevisionAdvanced: core.registry.getActiveRevision('lore:sun-blade')?.id === 'lore:sun-blade@2',
    relearnedHistoricalProvenance: Boolean(relearnedCarry && postEdit.packet.provenanceIndex[relearnedCarry.id]?.includes('lore:sun-blade@2')),
    currentDestructionSurvivedRelearn: core.graph.currentClaims({subjectId:'sun-blade',predicate:'state'}).some((claim) => claim.value === 'destroyed'),
    compiledPacketBytes: Buffer.byteLength(JSON.stringify(postEdit.packet), 'utf8'),
    sourceProseLeakedIntoPacket: JSON.stringify(postEdit.packet).includes('The Sun Blade is carried by Eris'),
  };

  const pass = metrics.currentStateAccuracy === 1
    && metrics.historicalStateAccuracy === 1
    && metrics.staleCurrentEscapes === 0
    && metrics.historicalCarryRecovered
    && metrics.provenanceCompleteness === 1
    && metrics.retrievalChannelsCovered
    && metrics.dependencyConeInvalidated
    && metrics.unrelatedKnowledgeSurvived
    && metrics.oldRevisionRecoverable
    && metrics.activeRevisionAdvanced
    && metrics.relearnedHistoricalProvenance
    && metrics.currentDestructionSurvivedRelearn
    && metrics.compiledPacketBytes < 2500
    && !metrics.sourceProseLeakedIntoPacket;

  return { pass, metrics, core, present, historical, postEdit, edit };
}
