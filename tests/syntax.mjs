import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function walk(dir, extension) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full, extension));
    else if (entry.isFile() && full.endsWith(extension)) out.push(full);
  }
  return out;
}
const srcFiles = (await walk(path.resolve('src'), '.js')).sort();
for (const file of srcFiles) await import(pathToFileURL(file).href);
const testFiles = (await walk(path.resolve('tests'), '.mjs')).sort();
for (const file of testFiles) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
console.log(`Syntax/module-load sweep: src ${srcFiles.length}/${srcFiles.length} PASS; test syntax ${testFiles.length}/${testFiles.length} PASS`);
