import { runWave3PublicationGoldenWorld } from '../tests/wave3-golden-harness.js';
import { EMBER_TAVERN_WAVE3 } from '../tests/fixtures/ember-tavern-wave3.js';
import { benchmarkContextCompression,buildContextOrderVariants } from '../src/context-benchmarks.js';

const scored=runWave3PublicationGoldenWorld();
if(!scored.pass)throw new Error(`Wave 3 golden world failed: ${JSON.stringify(scored.metrics)}`);

const packet=scored.published.packet;
const facts=[...packet.current,...packet.historical,...packet.unresolved].filter(f=>f.v!=='unknown');
const rawRepresentation={
  exactEvidence:EMBER_TAVERN_WAVE3.sources.concat(EMBER_TAVERN_WAVE3.experiences)
    .map(x=>({source:x,verbatim:x.content.repeat(6)})),
  duplicatedFacts:facts.flatMap(f=>[f,f,f]),
};
const temporal=packet.historical.filter(f=>Array.isArray(f.t))
  .map(f=>({e:f.e,p:f.p,v:f.v,status:f.t[2],validFrom:f.t[0],validUntil:f.t[1]}));
const provenance=Object.entries(packet.provenanceIndex)
  .map(([factId,sourceRevisionIds])=>({factId,sourceRevisionIds}));
const compression=benchmarkContextCompression({
  rawRepresentation,compiledPacket:packet,
  requirements:{
    facts,temporal,unresolved:packet.unresolved.filter(f=>f.v!=='unknown'),
    provenance,relationships:[],
  },
});
if(!compression.pass)throw new Error(`Compression benchmark lost cognition: ${JSON.stringify(compression)}`);

const orderVariants=buildContextOrderVariants({
  current:packet.current,character:[],unresolved:packet.unresolved,
  supportingLore:[],historical:packet.historical,
});

console.log(JSON.stringify({
  golden:scored.metrics,
  compiler:scored.published.compilerReceipt,
  seal:{
    packetId:scored.published.sealReceipt.packetId,
    packetHash:scored.published.sealReceipt.packetHash,
    fallbackState:scored.published.sealReceipt.fallbackState,
    sourceRevisionIds:scored.published.sealReceipt.sourceRevisionIds,
    worldRevision:scored.published.sealReceipt.worldRevision,
    sceneRevision:scored.published.sealReceipt.sceneRevision,
  },
  compression,
  ordering:{
    variantCount:orderVariants.length,
    currentPositions:[...new Set(orderVariants.map(v=>v.positionIndex.current))].sort(),
    unresolvedPositions:[...new Set(orderVariants.map(v=>v.positionIndex.unresolved))].sort(),
    providerSpecificWinner:null,
  },
},null,2));
