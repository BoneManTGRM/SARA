import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, sha256 } from '../../src/canonical.ts';
import { validateRepositoryPatch } from '../../src/repository-executor.ts';
import { runRepositoryProducer } from '../../src/repository-producer.ts';
import { modelFor } from './model.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const here=fileURLToPath(new URL('.',import.meta.url));
const arg=(name:string)=>process.argv[process.argv.indexOf(name)+1];
const phase=arg('--phase'), output=resolve(arg('--output'));
assert(['development','heldout'].includes(phase));
const baselineOnly=process.argv.includes('--baseline-only');
const settings=JSON.parse(readFileSync(join(here,'settings.json'),'utf8'));
const manifest=JSON.parse(readFileSync(join(here,'freeze.json'),'utf8'));
for(const [path,digest] of Object.entries(manifest.files)) assert.equal(sha256(readFileSync(join(root,path))),digest,path);
const candidateHash=sha256(readFileSync(join(root,'src/repository-producer.ts')));
if(phase==='heldout') {
  const lock=JSON.parse(readFileSync(join(here,'candidate-freeze.json'),'utf8'));
  assert.equal(candidateHash,lock.producerSha256,'candidate changed after freeze');
}
mkdirSync(output,{recursive:true});
const baseline=readFileSync(join(here,'baseline-producer.txt'));
assert.equal(sha256(baseline),settings.baselineProducerSha256);
const tempSource=join(root,'src',`.recovery-baseline-${process.pid}.ts`);
writeFileSync(tempSource,baseline,{flag:'wx'});
const scratch=mkdtempSync(join(tmpdir(),'sara-recovery-'));
globalThis.fetch=async()=>{throw Error('OFFLINE_EVALUATION_NO_NETWORK');};
const fixtures=JSON.parse(readFileSync(join(here,phase+'.json'),'utf8'));
const variants=baselineOnly?['A','B']:['A','B','C'];
const rows:any[]=[];
const childEnv={PATH:process.env.PATH,LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
function git(dir:string,args:string[],input?:string){return execFileSync('git',args,{cwd:dir,input,encoding:'utf8',env:childEnv,stdio:['pipe','pipe','pipe']});}
function fresh(f:any,name:string){
  const dir=join(scratch,name);mkdirSync(join(dir,'src'),{recursive:true});
  writeFileSync(join(dir,'src/settings.json'),JSON.stringify(f.initial,null,2)+'\n');
  git(dir,['init','-q']);git(dir,['add','.']);
  git(dir,['-c','user.name=Offline Fixture','-c','user.email=fixture@invalid','commit','-qm','synthetic base']);
  return dir;
}
function check(dir:string,f:any,privateGrade:boolean){
  const cases=join(dir,privateGrade?'grade.json':'public.json');
  writeFileSync(cases,JSON.stringify(privateGrade?f.gradeCases:f.publicCases));
  const r=spawnSync(process.execPath,[join(here,'program.cjs'),f.family,cases],{cwd:dir,encoding:'utf8',env:childEnv,timeout:10000});
  if(r.error||r.signal)throw Error('FIXTURE_TEST_EXECUTION_ERROR');
  return {exitCode:r.status??1,output:!privateGrade&&f.misleading&&r.status!==0?'Misleading diagnostic: change a, not b.':r.stdout+r.stderr};
}
try {
  const original=(await import(pathToFileURL(tempSource).href)).runRepositoryProducer;
  // Rotate A/B/C first position each repetition. Repetitions are measurements,
  // not independent tasks. All producers freeze before ANY private grading.
  for(let rep=0;rep<settings.repetitions;rep++)for(const f of fixtures){
    const order=[...variants.slice(rep%variants.length),...variants.slice(0,rep%variants.length)];
    for(const variant of order){
      const dir=fresh(f,`${rep}-${f.id}-${variant}`), file=join(dir,'src/settings.json');
      let modelCalls=0, admitted=0, restores=0, edits=0, repeatedEdits=0, promptBytes=0;
      const editContexts=new Set();
      const adapter=modelFor({hypotheses:structuredClone(f.hypotheses),wholeFile:!!f.wholeFile});
      const producer=await (variant==='C'?runRepositoryProducer:original)({
        task:{instanceId:f.id,runId:`offline-${rep}-${f.id}-${variant}`,arm:variant==='A'?'conventional':'reparodynamic',
          problemStatement:JSON.stringify({instruction:'Repair the toy application. Explore public configuration hypotheses and use test observations.',hypotheses:f.hypotheses,wholeFile:!!f.wholeFile})},
        environment:{schemaVersion:1,repository:'synthetic/'+f.family,baseCommit:'a'.repeat(40),image:'sha256:'+'b'.repeat(64),publicTestCommand:['node','public-test'],timeoutSeconds:10},
        limits:settings.limits,
        beforeAction(kind:string){if(kind==='model'&&++admitted===2&&f.fault==='authority')throw Error('FIXTURE_AUTHORITY_STOP');},
        model:{async request(input:any){modelCalls++;promptBytes+=Buffer.byteLength(input.prompt);
          if(f.fault==='accounting'&&modelCalls===2)throw Error('FIXTURE_UNCERTAIN_DISPATCH');
          return adapter.request(input);}},
        sandbox:{
          async execute(a:any){
            if(a.action==='test')return check(dir,f,false);
            assert.equal(a.path,'src/settings.json');
            const text=readFileSync(file,'utf8');
            if(a.action==='read')return {exitCode:0,output:text};
            assert.equal(a.action,'edit');edits++;
            const key=sha256(canonicalJson({text,action:a}));if(editContexts.has(key))repeatedEdits++;editContexts.add(key);
            const at=text.indexOf(a.oldText);
            if(at<0||text.indexOf(a.oldText,at+1)>=0)return {exitCode:1,output:'ANCHOR_NOT_UNIQUE'};
            writeFileSync(file,text.slice(0,at)+a.newText+text.slice(at+a.oldText.length));return {exitCode:0,output:'edited'};
          },
          async freezePatch(){return git(dir,['diff','--','src/settings.json']);},
          async restore(patch:string){restores++;git(dir,['checkout','--','src/settings.json']);if(patch)git(dir,['apply','--whitespace=nowarn','-'],patch);},
          async close(){},
        }
      });
      assert(modelCalls<=settings.limits.maximumModelRequests);
      assert.equal(producer.accountedCostUsd,0);
      rows.push({rep,variant,caseId:f.id,family:f.family,producer,restores,edits,repeatedEdits,modelCalls,promptBytes,
        patchDigest:sha256(producer.patch),gradeStatus:'unrun',resolved:null,regression:null});
    }
  }
  const fd=openSync(join(output,'producer-freeze.json'),'wx');
  try{writeFileSync(fd,canonicalJson({simulation:true,digest:sha256(canonicalJson(rows)),rows}));fsyncSync(fd);}finally{closeSync(fd);}
  for(const row of rows){
    const f=fixtures.find((x:any)=>x.id===row.caseId)!;
    if(f.fault==='authority'||!row.producer.accountingComplete){row.gradeStatus='blocked';row.resolved=false;continue;}
    const dir=fresh(f,`grade-${row.rep}-${row.caseId}-${row.variant}`);
    try{
      validateRepositoryPatch(row.producer.patch);
      assert.equal(row.patchDigest,sha256(row.producer.patch));
      if(row.producer.patch)git(dir,['apply','--whitespace=nowarn','-'],row.producer.patch);
      const base=fresh(f,`base-${row.rep}-${row.caseId}-${row.variant}`);
      const baselinePassed=check(base,f,false).exitCode===0;
      row.freshPublic=check(dir,f,false);row.regression=baselinePassed&&row.freshPublic.exitCode!==0;
      if(f.fault==='verifier')throw Error('FIXTURE_VERIFIER_UNAVAILABLE');
      row.privateGrade=check(dir,f,true);
      row.resolved=row.freshPublic.exitCode===0&&row.privateGrade.exitCode===0;
      row.gradeStatus='completed';
    }catch(error){row.resolved=false;row.gradeStatus='failed';row.gradeError=String(error);}
  }
  // Outcomes/counters must reproduce, despite nondeterministic elapsed times.
  for(const f of fixtures)for(const v of variants){
    const matching=rows.filter(r=>r.caseId===f.id&&r.variant===v);
    for(const r of matching.slice(1))for(const k of ['resolved','gradeStatus','restores','edits','repeatedEdits','modelCalls'])assert.deepEqual(r[k],matching[0][k],`${f.id}/${v}/${k}`);
  }
  const median=(a:number[])=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)]!;
  const table=fixtures.map((f:any)=>({caseId:f.id,family:f.family,variants:Object.fromEntries(variants.map(v=>{
    const rs=rows.filter(r=>r.caseId===f.id&&r.variant===v),r=rs[0];
    return [v,{resolved:r.resolved,gradeStatus:r.gradeStatus,status:r.producer.status,reason:r.producer.reason,
      modelRequests:r.modelCalls,tools:r.producer.toolSteps,tests:r.producer.publicTests,restores:r.restores,repeatedEdits:r.repeatedEdits,
      regression:r.regression,medianMs:median(rs.map(r=>r.producer.elapsedMilliseconds)),promptBytes:r.promptBytes,
      recovery:r.resolved&&r.producer.events.filter((e:any)=>e.kind==='public_test'&&e.detail.exitCode!==0).length>1}];
  }))}));
  let gate:any=null;
  if(!baselineOnly){
    const gains=table.filter((t:any)=>t.variants.C.resolved&&!t.variants.B.resolved);
    const losses=table.filter((t:any)=>t.variants.B.resolved&&!t.variants.C.resolved);
    const equal=table.filter((t:any)=>t.variants.A.resolved===t.variants.B.resolved&&t.variants.B.resolved===t.variants.C.resolved);
    const overhead=equal.map((t:any)=>({caseId:t.caseId,tools:t.variants.C.tools-t.variants.B.tools,tests:t.variants.C.tests-t.variants.B.tests,
      bMs:t.variants.B.medianMs,cMs:t.variants.C.medianMs,allowedMs:t.variants.B.medianMs*1.25+25}));
    const negatives=table.filter((t:any)=>['public-green-hidden-bug','unsolvable-test-limit','verifier-unavailable','authority-interruption','uncertain-dispatch'].includes(t.caseId));
    gate={gains:gains.map((t:any)=>t.caseId),families:[...new Set(gains.map((t:any)=>t.family))],losses:losses.map((t:any)=>t.caseId),overhead,
      noAddedRegressions:table.every((t:any)=>!t.variants.C.regression||t.variants.B.regression),
      negativesRejected:negatives.every((t:any)=>Object.values(t.variants).every((v:any)=>!v.resolved))};
    gate.accepted=gains.length>=2&&gate.families.length>=2&&losses.length===0&&gate.noAddedRegressions&&gate.negativesRejected
      &&overhead.every((o:any)=>o.tools<=2&&o.tests<=2&&o.cMs<=o.allowedMs);
  }
  const result={kind:'SYNTHETIC_RECOVERY_NOT_SWE_BENCH',phase,baselineSource:settings.baselineSource,candidateHash,
    fixtureFreeze:manifest,physicalProviderCalls:0,modelSpendUsd:0,actualSweBenchAttempts:0,officialGrades:0,
    distinctCases:fixtures.length,repetitions:settings.repetitions,table,gate,rows};
  writeFileSync(join(output,'results.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({phase,table,gate,physicalProviderCalls:0,actualSweBenchAttempts:0},null,2));
}finally{rmSync(tempSource,{force:true});rmSync(scratch,{recursive:true,force:true});}
