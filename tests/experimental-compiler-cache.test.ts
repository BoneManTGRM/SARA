import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as ts from 'typescript';
import {ExperimentalCompilerCache} from '../src/experimental-compiler-cache.ts';
import {verifyProgramCandidate,verifyGenomeLabProgramCandidate} from '../src/genome-lab-verifier.ts';
import type {ProgramCandidateProposal} from '../src/types.ts';

function candidate(value = '42'): ProgramCandidateProposal {
 return {schemaVersion:1,candidateKind:'typescript_program',programName:'Compiler cache fixture',summary:'Independent behavioral acceptance',limitations:[],files:[
 {path:'src/index.ts',content:'export {value} from "./value.ts";\n'},
 {path:'src/value.ts',content:`export const value: number = ${value};\n`},
 {path:'tests/value.test.ts',content:'import {value} from "../src/index.ts";\nif(value !== 42) throw new Error("expected 42");\n'}]};
}
const context={objective:'Return 42',acceptanceCriteria:['The exported value is the number 42.'],constitutionDigest:'a'.repeat(64)};
test('deduplicates immutable declaration text, but parses and checks each candidate afresh',async()=>{
 const cache=new ExperimentalCompilerCache();let calls=0;
 const input={candidate:candidate(),experimentalCompilerCache:cache,behaviorCheck:async()=>{calls++;return [];}};
 assert((await verifyProgramCandidate(input)).passed);
 assert((await verifyProgramCandidate(input)).passed);
 assert.equal(calls,2);
 assert(cache.snapshot().hits>0,'unchanged external declaration text must be deduplicated');
 assert.equal(cache.snapshot().reuseKind,'immutable_declaration_text');
 assert(cache.snapshot().freshParses>=cache.snapshot().hits);
});
test('full cached verifier still rejects wrong behavior and changed types between passing candidates',async()=>{
 const cache=new ExperimentalCompilerCache();
 for(const value of ['42','1',"'wrong'",'42']){
  const input={...context,candidate:candidate(value)};
  const ordinary=await verifyGenomeLabProgramCandidate(input);
  const cached=await verifyGenomeLabProgramCandidate({...input,experimentalCompilerCache:cache});
  assert.deepEqual(cached,ordinary);
  assert.equal(cached.passed,value==='42');
 }
});

import {mkdtemp,mkdir,writeFile,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('same-length dependency changes, missing files, fresh requests and options retain fresh parsing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sara-declaration-cache-'));
 const dir=join(root,'node_modules','fixture');await mkdir(dir,{recursive:true});const p=join(dir,'index.d.ts');
 const cache=new ExperimentalCompilerCache();const host=cache.createHost({target:ts.ScriptTarget.ES2022});
 try{
  await writeFile(p,'export const value: number;\n');const a=host.getSourceFile(p,ts.ScriptTarget.ES2022)!;
  assert.notEqual(host.getSourceFile(p,ts.ScriptTarget.ES2022),a);
  await writeFile(p,'export const value: string;\n');const b=host.getSourceFile(p,ts.ScriptTarget.ES2022)!;
  assert.notEqual(a,b);assert(b.text.includes('string'));
  assert.notEqual(host.getSourceFile(p,ts.ScriptTarget.ES2022,undefined,true),b);
  assert.notEqual(cache.createHost({target:ts.ScriptTarget.ES2020}).getSourceFile(p,ts.ScriptTarget.ES2020),b);
  await unlink(p);assert.equal(host.getSourceFile(p,ts.ScriptTarget.ES2022),undefined);
  cache.clear();assert.equal(cache.snapshot().entries,0);assert.equal(cache.snapshot().retainedBytes,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('candidate sources are never retained and declaration capacity is bounded',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sara-cache-limits-'));const dir=join(root,'node_modules','fixture');await mkdir(dir,{recursive:true});
 const cache=new ExperimentalCompilerCache();const host=cache.createHost({target:ts.ScriptTarget.ES2022});
 try{
  const source=join(root,'candidate.ts');await writeFile(source,'export const value = 1;');
  assert.notEqual(host.getSourceFile(source,ts.ScriptTarget.ES2022),host.getSourceFile(source,ts.ScriptTarget.ES2022));assert.equal(cache.snapshot().entries,0);
  for(let i=0;i<260;i++){const p=join(dir,`v${i}.d.ts`);await writeFile(p,`export const value${i}: number;`);host.getSourceFile(p,ts.ScriptTarget.ES2022);}
  assert.equal(cache.snapshot().entries,256);assert(cache.snapshot().retainedBytes<=8*1024*1024);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('syntax, security, deleted modules, changed tests and policy violations remain failures after warm-up',async()=>{
 const cache=new ExperimentalCompilerCache();assert((await verifyGenomeLabProgramCandidate({...context,candidate:candidate(),experimentalCompilerCache:cache})).passed);
 const variants=[
  (c:ProgramCandidateProposal)=>{c.files[1].content='export const value: = ;';},
  (c:ProgramCandidateProposal)=>{c.files[1].content='export const value = process.env.SECRET;';},
  (c:ProgramCandidateProposal)=>{c.files.pop();},
  (c:ProgramCandidateProposal)=>{c.files[2].content='throw new Error("changed test must run");\n';},
  (c:ProgramCandidateProposal)=>{c.files[1].content='export const value: number = Date.now();\n';},
  (c:ProgramCandidateProposal)=>{c.files[1].content='import {value} from "../tests/value.test.ts"; export {value};\n';},
 ];
 for(const change of variants){const c=candidate();change(c);const normal=await verifyGenomeLabProgramCandidate({...context,candidate:c});const cached=await verifyGenomeLabProgramCandidate({...context,candidate:c,experimentalCompilerCache:cache});assert.deepEqual(cached,normal);assert.equal(cached.passed,false);}
});
test('fresh semantic diagnostics follow changed ambient declarations after a prior successful binding',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sara-cache-semantic-'));const dir=join(root,'node_modules','fixture');await mkdir(dir,{recursive:true});
 const declaration=join(dir,'index.d.ts'),source=join(root,'main.ts');
 const options:ts.CompilerOptions={strict:true,noEmit:true,noLib:true,types:[],target:ts.ScriptTarget.ES2022};
 const cache=new ExperimentalCompilerCache();
 function diagnostics(useCache:boolean){const p=ts.createProgram([source,declaration],options,useCache?cache.createHost(options):ts.createCompilerHost(options));return p.getSemanticDiagnostics().map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')}));}
 try{
  await writeFile(source,'const actual: Ambient = 42;\n');
  for(const type of ['number','string','number']){
   await writeFile(declaration,`type Ambient = ${type};\n`);
   const ordinary=diagnostics(false),cached=diagnostics(true);assert.deepEqual(cached,ordinary);assert.equal(cached.length===0,type==='number');
  }
  await writeFile(source,'const actual: Ambient = "not a number";\n');
  assert.deepEqual(diagnostics(true),diagnostics(false));assert(diagnostics(true).some(d=>d.code===2322));
 }finally{await rm(root,{recursive:true,force:true});}
});
