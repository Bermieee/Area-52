import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function walk(dir) {
  const out=[];
  for (const entry of await fs.readdir(dir,{withFileTypes:true})) {
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) out.push(...await walk(full));
    else if(entry.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}
const root=path.resolve('src');
const files=(await walk(root)).sort();
for(const file of files) await import(pathToFileURL(file).href);
console.log(`Syntax/module-load sweep: ${files.length}/${files.length} PASS`);
