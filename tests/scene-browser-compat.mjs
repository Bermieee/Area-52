import fs from 'node:fs';
import path from 'node:path';

const root='src/scene';
const forbidden=[/\bBuffer\b/,/from ['"]node:/,/\bprocess\./,/\brequire\s*\(/,/from ['"]fs['"]/,/from ['"]path['"]/];
const files=fs.readdirSync(root).filter(x=>x.endsWith('.js'));
const violations=[];
for(const file of files){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  for(const re of forbidden)if(re.test(source))violations.push(`${file}: ${re}`);
}
if(violations.length){
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log(`Browser compatibility source scan PASS (${files.length} modules)`);
