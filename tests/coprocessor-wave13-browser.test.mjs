import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Wave 13 cognitive choice production modules stay browser-safe, network-free and owner-authority free',async()=>{
  for(const file of ['../src/coprocessor/cognitive-choice-proposal.js','../src/coprocessor/cognitive-choice-execution.js']){
    const src=await fs.readFile(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(src,/from\s+['"]node:|require\s*\(|process\.env|Buffer\./);
    assert.doesNotMatch(src,/fetch\s*\(|WebSocket\s*\(|EventSource\s*\(/);
    assert.doesNotMatch(src,/createCognitiveChoiceReceipt\s*\(/);
  }
  const mod=await import('../src/coprocessor/index.js');
  assert.equal(typeof mod.DynamicFanOutPlanner.prototype.planChoice,'function');
  assert.equal(typeof mod.toCoreCognitiveChoiceContribution,'function');
  const contribution=mod.toCoreCognitiveChoiceContribution({proposal:mod.createCoprocessorChoiceProposal({
    turnId:'browser',correlationId:'browser:corr',policyVersion:'browser:1',
    revisionFence:{sourceRevisionSet:['s1'],worldRevision:1,sceneRevision:1,characterStateRevision:1,intentFingerprint:'browser:intent',policyRevision:'browser:1'},
    options:[],resourceCount:1,
  })});
  assert.equal(contribution.cognitiveChoiceReceipt,null);
  assert.equal(contribution.finalChoiceAuthority,false);
  assert.equal(contribution.contextSealAuthority,false);
});
