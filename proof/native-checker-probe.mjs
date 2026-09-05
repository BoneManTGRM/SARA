import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {researchSourceIdentity} from './research-source-identity.ts';
import {baseline,objective,acceptanceCriteria} from './v8-live-fixture.ts';
import {verifyGenomeLabProgramCandidate} from '../src/genome-lab-verifier.ts';
import {loadConstitution} from '../src/constitution.ts';

// This is a type-checker subprocess experiment, not a replacement repair verifier.
assert(!process.env.OPENAI_API_KEY&&!process.env.CLOUDFLARE_API_TOKEN,'No provider credentials permitted');
globalThis.fetch=async()=>{throw Error('PROBE_NETWORK_FORBIDDEN');};
const out=resolve('native-checker-evidence');await mkdir(out,{recursive:true});
const sourceCommit=researchSourceIdentity(process.cwd(),process.env.SARA_RESEARCH_SOURCE_SHA);
const captured=JSON.parse(await readFile('proof/captured/v8-full.json','utf8'));
const candidate=structuredClone(baseline);
for(const f of captured.files)candidate.files.find(x=>x.path===f.path).content=f.content;
const {digest:constitutionDigest}=await loadConstitution();
const originalVerification=await verifyGenomeLabProgramCandidate({candidate,objective,acceptanceCriteria,constitutionDigest});
assert(originalVerification.passed);assert.equal(originalVerification.artifactDigest,captured.artifactDigest);
const original=candidate.files.find(f=>f.path==='src/inventory.ts').content;
function replace(text,from,to){assert(text.includes(from),'fixture edit must match');return text.replace(from,to);}
const cases=[
 {id:'valid',expectedTypePass:true},
 {id:'wrong-behavior-type-safe',expectedTypePass:true,source:replace(original,'return lines.reduce((sum, line) => sum + line.quantity * line.unitCents, 0);','return 0;')},
 {id:'wrong-return-type',expectedTypePass:false,source:replace(original,'return lines.reduce((sum, line) => sum + line.quantity * line.unitCents, 0);','return "invalid";')},
 {id:'syntax-error',expectedTypePass:false,source:original+'\nexport const bad: = ;\n'},
 {id:'missing-module',expectedTypePass:false,index:'export {add,discount,remove,total} from "./missing.ts";\n'},
 {id:'readonly-mutation',expectedTypePass:false,source:replace(original,'validate(lines);','lines.push(line); validate(lines);')},
 {id:'wrong-argument',expectedTypePass:false,source:replace(original,'Math.floor(line.unitCents * (100 - percent) / 100)','Math.floor("not-a-number")')},
 {id:'missing-export',expectedTypePass:false,index:'export {missing} from "./inventory.ts";\n'},
];
const wrong=structuredClone(candidate);wrong.files.find(f=>f.path==='src/inventory.ts').content=cases[1].source;
const wrongBehaviorVerification=await verifyGenomeLabProgramCandidate({candidate:wrong,objective,acceptanceCriteria,constitutionDigest});
assert(!wrongBehaviorVerification.passed,'the real verifier must catch what type-checking alone misses');
const roots={current:resolve('node_modules/typescript'),native:resolve(process.env.SARA_NATIVE_ROOT??'/tmp/sara-native-probe/node_modules/typescript')};
const compilers={};
for(const [name,root] of Object.entries(roots)){
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 assert.equal(pkg.name,'typescript');assert.equal(pkg.version,name==='current'?'5.9.3':'7.0.2');
 const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.tsc;assert.equal(typeof bin,'string');
 const executable=resolve(root,bin);assert(executable.startsWith(root+'/'));
 const version=await promisify(execFile)(executable,['--version'],{timeout:15000,maxBuffer:65536});
 compilers[name]={version:pkg.version,reportedVersion:version.stdout.trim(),executable,packageJsonSha256:sha256(await readFile(join(root,'package.json'))),entrypointSha256:sha256(await readFile(executable))};
}
const rows=[];
for(const entry of cases){
 const dir=join(out,'cases',entry.id);await mkdir(join(dir,'src'),{recursive:true});await mkdir(join(dir,'tests'),{recursive:true});
 for(const file of candidate.files){let text=file.content;if(file.path==='src/inventory.ts'&&entry.source)text=entry.source;if(file.path==='src/index.ts'&&entry.index)text=entry.index;await writeFile(join(dir,file.path),text);}
 await writeFile(join(dir,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',strict:true,skipLibCheck:true,noEmit:true,allowImportingTsExtensions:true,types:['node'],rootDir:'.'},files:candidate.files.map(f=>f.path)},null,2));
 for(let repetition=0;repetition<2;repetition++){
  const row={case:entry.id,expectedTypePass:entry.expectedTypePass,repetition,order:(rows.length%2)?['native','current']:['current','native']};
  for(const mode of row.order){
   const started=performance.now();let stdout='',stderr='',exitCode=0;
   try{const r=await promisify(execFile)(compilers[mode].executable,['--project',join(dir,'tsconfig.json'),'--pretty','false'],{timeout:30000,maxBuffer:1048576});stdout=r.stdout;stderr=r.stderr;}
   catch(error){stdout=typeof error.stdout==='string'?error.stdout:'';stderr=typeof error.stderr==='string'?error.stderr:'';exitCode=Number.isInteger(error.code)?error.code:-1;}
   row[mode]={elapsedMs:performance.now()-started,exitCode,passed:exitCode===0,diagnosticCodes:[...stdout.matchAll(/error TS(\d+):/g)].map(m=>Number(m[1])).sort((a,b)=>a-b),stdout:stdout.replaceAll(process.cwd(),'<workspace>'),stderr:stderr.replaceAll(process.cwd(),'<workspace>')};
  }
  row.outcomeParity=row.current.passed===row.native.passed&&row.current.passed===entry.expectedTypePass;
  row.diagnosticCodeParity=JSON.stringify(row.current.diagnosticCodes)===JSON.stringify(row.native.diagnosticCodes);
  rows.push(row);await writeFile(join(out,'events.ndjson'),JSON.stringify(row)+'\n',{flag:'a'});
 }
}
const currentTotalMs=rows.reduce((s,r)=>s+r.current.elapsedMs,0),nativeTotalMs=rows.reduce((s,r)=>s+r.native.elapsedMs,0);
const evidence={schemaVersion:1,evidenceLevel:'EXECUTED_CHECKER_CLI_COMPARISON_NOT_SARA_CODING_SPEED',sourceCommit,workflowEventCommit:process.env.GITHUB_SHA??null,node:process.version,compilers,rows,originalVerification,wrongBehaviorVerification,summary:{pairs:rows.length,allOutcomesMatch:rows.every(r=>r.outcomeParity),allDiagnosticCodesMatch:rows.every(r=>r.diagnosticCodeParity),currentTotalMs,nativeTotalMs,pooledCheckerSpeedup:currentTotalMs/nativeTotalMs},providerCalls:0,newProviderCostUsd:0,infrastructureCostUsd:null,generalClaimSupported:false,limitations:['Two repetitions of eight authored cases, not a representative task corpus.','Subprocess startup is included; installation and preflight verification are reported outside checker timings.','The native compiler is installed only in an isolated temporary directory. Existing package files and SARA verifier stay unchanged.','Native TypeScript7 lacks the existing compiler API; this is not a drop-in replacement.','Both type-checkers accept the type-safe wrong program, while the original full SARA verifier rejects it. Type checks cannot replace behavioral verification.','SARA total coding acceleration, production readiness and diagnostic equivalence beyond these cases are not established.']};
await writeFile(join(out,'results.json'),JSON.stringify({...evidence,evidenceDigest:sha256(canonicalJson(evidence))},null,2));
console.log(JSON.stringify(evidence.summary));
if(!evidence.summary.allOutcomesMatch||!evidence.summary.allDiagnosticCodesMatch)process.exitCode=1;
