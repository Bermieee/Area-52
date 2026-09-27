import { benchmarkSceneEpisodeRetrieval } from '../src/scene/index.js';

const corpus=[
  {id:'turn:1',text:'At the Ember Tavern, Mara asks Eris about the Sun Blade.'},
  {id:'turn:2',text:'They agree to search the old vault beneath the city.'},
  {id:'turn:3',text:'Hours later they enter the Moonlit Vault and find the sealed door.'},
  {id:'turn:4',text:'Inside the vault, Eris gives Mara the brass key.'},
  {id:'turn:5',text:'A flashback recalls Mara meeting Eris at the harbor years earlier.'},
  {id:'turn:6',text:'Back in the Moonlit Vault, Mara uses the brass key on the sealed door.'},
];
const semanticEpisodes=[
  {episodeId:'tavern',sourceIds:['turn:1','turn:2'],summary:'Ember Tavern: Mara and Eris plan to search the old vault for the Sun Blade.',temporalKind:'CURRENT',neighborEpisodeIds:['vault']},
  {episodeId:'vault',sourceIds:['turn:3','turn:4','turn:6'],summary:'Moonlit Vault: Eris gives Mara the brass key; Mara later uses it on the sealed door.',temporalKind:'CURRENT',neighborEpisodeIds:['tavern','harbor-flashback']},
  {episodeId:'harbor-flashback',sourceIds:['turn:5'],summary:'Historical flashback: Mara met Eris at the harbor years earlier.',temporalKind:'FLASHBACK',neighborEpisodeIds:['vault']},
];
const queries=[
  {query:'Who gave Mara the brass key and where?',expectedSourceIds:['turn:4']},
  {query:'Where did Mara meet Eris years earlier?',expectedSourceIds:['turn:5']},
  {query:'What did Mara use on the sealed vault door?',expectedSourceIds:['turn:4','turn:6'],callback:true,expectedNeighborEpisodeIds:['tavern']},
];
const report=benchmarkSceneEpisodeRetrieval({corpus,semanticEpisodes,queries,fixedChunkSize:2});
console.log('SCENE_RESEARCH_BENCHMARK='+JSON.stringify(report));
if(report.semantic.eventCompleteness<report.fixed.eventCompleteness||
   report.semantic.temporalCorrectness<report.fixed.temporalCorrectness||
   report.semantic.sourceTraceability<report.fixed.sourceTraceability||
   report.semantic.boundaryCoherence<report.fixed.boundaryCoherence||
   report.semantic.retrievalPrecision<report.fixed.retrievalPrecision||
   report.semantic.retrievalRecall<report.fixed.retrievalRecall||
   report.semantic.callbackRecovery<report.fixed.callbackRecovery||
   report.semantic.graphMultiHopUsefulness<=report.fixed.graphMultiHopUsefulness||
   report.semantic.rebuildScopeAfterSingleEdit>report.fixed.rebuildScopeAfterSingleEdit){
  process.exitCode=1;
}
