const rules=Object.freeze([
  ['NODE_BUILTIN',/\bfrom\s+['"]node:|\bimport\s*\(\s*['"]node:/],
  ['BUFFER_GLOBAL',/\bBuffer\b/],
  ['PROCESS_GLOBAL',/\bprocess\s*\./],
  ['COMMONJS_REQUIRE',/\brequire\s*\(/],
  ['FILESYSTEM_API',/\b(?:readFileSync|writeFileSync|createReadStream|createWriteStream)\b/],
]);
export function inspectBrowserHostSource({path='unknown',source=''}){const violations=rules.filter(([,rx])=>rx.test(source)).map(([code])=>({code,path}));return{path,pass:violations.length===0,violations};}
export function browserHostConformanceReport(files=[]){const results=files.map(inspectBrowserHostSource);return{pass:results.every(x=>x.pass),results,violationCount:results.reduce((n,x)=>n+x.violations.length,0)};}
