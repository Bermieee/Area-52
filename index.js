import { runPhase1FunctionTest001 } from './src/integration/function-test-001.js';

const EXTENSION_ID='area52-phase1-function-test';
let mounted=false;

function host(){
  return document.querySelector('#extensions_settings2')
    ??document.querySelector('#extensions_settings')
    ??document.body;
}

function render(report,root){
  const status=root.querySelector('[data-area52-status]');
  const output=root.querySelector('[data-area52-output]');
  status.textContent=report.pass?'PASS — Phase 1 Function Test 001':'FAIL — inspect checks below';
  status.dataset.state=report.pass?'pass':'fail';
  const lines=[
    report.title,
    '',
    ...report.checks.map(x=>(x.pass?'✓ ':'✗ ')+x.name+': '+(typeof x.detail==='string'?x.detail:JSON.stringify(x.detail))),
    '',
    'Packet hash: '+report.summary.packetHash,
    'PromptPlan: '+report.summary.promptPlanId,
  ];
  output.textContent=lines.join('\n');
}

export async function runFunctionTest001(){
  const root=document.getElementById(EXTENSION_ID);
  const status=root?.querySelector('[data-area52-status]');
  if(status){status.textContent='RUNNING…';status.dataset.state='running';}
  try{
    const report=await runPhase1FunctionTest001();
    if(root)render(report,root);
    console.info('[Area-52] Function Test 001',report);
    return report;
  }catch(error){
    if(status){status.textContent='ERROR — Function Test 001 threw';status.dataset.state='fail';}
    const output=root?.querySelector('[data-area52-output]');
    if(output)output.textContent=error?.stack??String(error);
    console.error('[Area-52] Function Test 001 failed',error);
    throw error;
  }
}

export function init(){
  if(mounted||document.getElementById(EXTENSION_ID))return;
  mounted=true;
  const root=document.createElement('section');
  root.id=EXTENSION_ID;
  root.className='area52-ft-panel';
  root.innerHTML=[
    '<div class="area52-ft-head">',
    '<div><strong>Area-52 — Phase 1</strong><div class="area52-ft-sub">Function Test 001 integration bootstrap</div></div>',
    '<button type="button" class="menu_button" data-area52-run>Run Test</button>',
    '</div>',
    '<div class="area52-ft-status" data-area52-status data-state="idle">READY</div>',
    '<pre class="area52-ft-output" data-area52-output>Install verified. Run Function Test 001 to exercise the assembled lanes.</pre>',
  ].join('');
  root.querySelector('[data-area52-run]').addEventListener('click',()=>void runFunctionTest001());
  host().appendChild(root);
  globalThis.Area52=Object.freeze({runFunctionTest001,runPhase1FunctionTest001});
  console.info('[Area-52] Phase 1 Function Test extension loaded');
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else queueMicrotask(init);
