import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
// This experiment remains separate from the active repository producer.
const source=new URL(`../src/.recovery-v3-test-${randomUUID()}.ts`,import.meta.url);
writeFileSync(source,readFileSync(new URL('../proof/recovery-v3/candidate-producer.txt',import.meta.url)),{flag:'wx'});
const {runRepositoryProducer}=await import(source.href) as typeof import('../src/repository-producer.ts');
after(()=>rmSync(source,{force:true}));
async function execute(actions:object[]) {
  let content='original',calls=0,closed=false;
  const result=await runRepositoryProducer({
    task:{instanceId:'v3-test',runId:'v3-test-run',arm:'reparodynamic',problemStatement:'Fix the issue'},
    environment:{schemaVersion:1,repository:'toy/recovery',baseCommit:'a'.repeat(40),image:'sha256:'+'b'.repeat(64),publicTestCommand:['node','test'],timeoutSeconds:10},
    limits:{maximumModelRequests:10,maximumToolSteps:50,maximumPublicTests:6,maximumOutputBytes:100000,maximumWallMilliseconds:10000},beforeAction(){},
    model:{async request(){return {outputText:JSON.stringify(actions[Math.min(calls++,actions.length-1)]),inputTokens:0,outputTokens:0,accountedCostUsd:0};}},
    sandbox:{async execute(a){
      if(a.action==='test')return{exitCode:content==='bad'?1:0,output:'public feedback'};
      if(a.action==='edit')content=content.replace(a.oldText,a.newText);
      return {exitCode:0,output:content};
    },async freezePatch(){return content==='original'?'':`diff --git a/src/file.ts b/src/file.ts\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1 +1 @@\n-original\n+${content}\n`;},
    async restore(){content='original';},async close(){closed=true;}}
  });return {result,calls,closed};
}
const bad={action:'edit',path:'src/file.ts',oldText:'original',newText:'bad'};
test('v3 experiment stops repeated failed-context proposals and preserves rollback/cleanup',async()=>{
  const {result,calls,closed}=await execute([bad,{action:'test'},bad]);
  assert.equal(calls,5);assert.equal(result.reason,'PRODUCER_REPEATED_FAILED_EDIT');
  assert.equal(result.patch,'');assert.equal(result.publicTests,2);assert.equal(closed,true);
  assert.equal(result.accountingComplete,true);
});
test('v3 experiment permits an alternative before its repeated-rejection threshold',async()=>{
  const {result}=await execute([bad,{action:'test'},bad,bad,{action:'edit',path:'src/file.ts',oldText:'original',newText:'good'},{action:'test'},{action:'finish'}]);
  assert.equal(result.status,'finished');assert.match(result.patch,/\+good/);assert.equal(result.publicTests,3);
});
