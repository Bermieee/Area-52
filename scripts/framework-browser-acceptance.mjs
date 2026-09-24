import {readdir,readFile} from 'node:fs/promises';
import {browserHostConformanceReport} from '../src/browser-host-conformance.js';
const srcUrl=new URL('../src/',import.meta.url),files=(await readdir(srcUrl)).filter(name=>name.endsWith('.js')).sort(),rows=[];
for(const name of files)rows.push({path:`src/${name}`,source:await readFile(new URL(name,srcUrl),'utf8')});
const report=browserHostConformanceReport(rows);for(const row of report.results)console.log(`${row.pass?'PASS':'FAIL'} ${row.path}${row.violations.length?` ${row.violations.map(x=>x.code).join(',')}`:''}`);
console.log(`Core browser-host source acceptance: ${report.results.filter(x=>x.pass).length}/${report.results.length}`);if(!report.pass)process.exitCode=1;
