import { SceneRegistry } from './scene-registry.js';
import { SceneStack } from './scene-stack.js';
import { SceneEpisodeCompiler } from './scene-episode.js';
import { SceneGraph } from './scene-graph.js';
import { ScenePrefetchTrigger } from './prefetch-trigger.js';
import { NarrativeFeedAdapter } from './narrative-feed-adapter.js';

const clone=(v)=>structuredClone(v);

export function exportSceneLifecycleState({registry,stack,episodeCompiler,graph,prefetchTrigger=null,narrativeFeed=null,transitionManager=null}){
  return clone({kind:'SceneLifecycleState',version:1,registry:registry.exportState(),stack:stack.exportState(),episodes:episodeCompiler.exportState(),graph:graph.exportState(),prefetch:prefetchTrigger?.exportState()??null,narrativeFeed:narrativeFeed?.exportState()??null,transitions:transitionManager?.exportState()??null});
}

export function importSceneLifecycleState(state){
  if(state?.kind!=='SceneLifecycleState'||state.version!==1)throw new TypeError('unsupported SceneLifecycleState');
  return {registry:SceneRegistry.importState(state.registry),stack:SceneStack.importState(state.stack),episodeCompiler:SceneEpisodeCompiler.importState(state.episodes),graph:SceneGraph.importState(state.graph),prefetchTrigger:state.prefetch?ScenePrefetchTrigger.importState(state.prefetch):new ScenePrefetchTrigger(),narrativeFeed:state.narrativeFeed?NarrativeFeedAdapter.importState(state.narrativeFeed):new NarrativeFeedAdapter(),transitionState:clone(state.transitions)};
}
