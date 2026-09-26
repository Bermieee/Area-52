import {runFrameworkWave1GoldenWorld} from '../tests/framework-wave1-harness.js';
import {InMemoryCognitiveRepository,ObjectFixtureCognitiveRepository,runRepositoryContractSuite} from '../src/cognitive-repository.js';
const golden=runFrameworkWave1GoldenWorld();const memory=runRepositoryContractSuite(new InMemoryCognitiveRepository());const alternate=runRepositoryContractSuite(new ObjectFixtureCognitiveRepository());
const rows=[['golden-world',golden.pass],['repository-memory',memory.pass],['repository-alternate',alternate.pass]];for(const [name,pass] of rows)console.log(`${pass?'PASS':'FAIL'} ${name}`);console.log(`Framework Wave 1 acceptance: ${rows.filter(([,p])=>p).length}/${rows.length}`);if(rows.some(([,p])=>!p))process.exitCode=1;
