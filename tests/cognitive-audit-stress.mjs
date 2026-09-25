import test from 'node:test';
import assert from 'node:assert/strict';
import {runCognitiveAuditStress} from './cognitive-audit-stress-harness.js';
test('diagnostic stress remains deterministic, bounded and reconstructible',()=>{const r=runCognitiveAuditStress();assert.equal(r.pass,true,JSON.stringify(r.metrics,null,2));});
