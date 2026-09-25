import fs from 'node:fs';
import {createAssemblyLaneEntry,verifyAssemblyLane} from '../src/assembly-manifest.js';
const [entryPath,statePath]=process.argv.slice(2);
if(!entryPath||!statePath){console.error('usage: node scripts/verify-assembly-manifest.mjs <lane-entry.json> <observed-state.json>');process.exit(2);}
const entry=createAssemblyLaneEntry(JSON.parse(fs.readFileSync(entryPath,'utf8')));
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
const report=verifyAssemblyLane(entry,state);
console.log(JSON.stringify(report,null,2));
if(!report.reconstructable)process.exitCode=1;
