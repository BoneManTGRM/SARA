import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
const source=new URL(`../src/.recovery-v5-test-${randomUUID()}.ts`,import.meta.url);
const snapshot=process.env.SARA_V5_PARENT==='1'?'../recovery-v4/candidate-producer.txt':'candidate-producer.txt';
writeFileSync(source,readFileSync(new URL('../proof/recovery-v5/'+snapshot,import.meta.url)),{flag:'wx'});
const {runRepositoryProducer}=await import(source.href) as typeof import('../src/repository-producer.ts');
after(()=>rmSync(source,{force:true}));
async function execute(actions:object[], maximumModelRequests=20) {
  let content='a=0,b=0',calls=0,closed=false;
  const result=await runRepositoryProducer({
    task:{instanceId:'v4-batch',runId:'v4-batch-run',arm:'reparodynamic',problemStatement:'Return twice the input with zero intercept'},
    environment:{schemaVersion:1,repository:'toy/batch',baseCommit:'a'.repeat(40),image:'sha256:'+'b'.repeat(64),publicTestCommand:['node','test'],timeoutSeconds:10},
    limits:{maximumModelRequests,maximumToolSteps:80,maximumPublicTests:6,maximumOutputBytes:100000,maximumWallMilliseconds:10000},beforeAction(){},
    model:{async request(){return {outputText:JSON.stringify(actions[calls++]??{action:'finish'}),inputTokens:0,outputTokens:0,accountedCostUsd:0};}},
    sandbox:{async execute(a){
      if(a.action==='test')return{exitCode:content.endsWith('b=0')?0:1,output:'zero input must return zero'};
      if(a.action==='edit'){
        if(!content.includes(a.oldText))return {exitCode:1,output:'missing anchor'};
        content=content.replace(a.oldText,a.newText);
      }
      return {exitCode:0,output:content};
    },async freezePatch(){return content==='a=0,b=0'?'':`diff --git a/src/file.ts b/src/file.ts\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1 +1 @@\n-a=0,b=0\n+${content}\n`;},
    async restore(patch){content=patch?patch.split('\n').find(x=>x.startsWith('+a='))!.slice(1):'a=0,b=0';},async close(){closed=true;}}
  });return {result,calls,closed,content};
}
const prerequisite={action:'edit',path:'src/file.ts',oldText:'a=0',newText:'a=2'};
const bad={action:'edit',path:'src/file.ts',oldText:'b=0',newText:'b=1'};
const check={action:'test'};
test('v5 rejects untested regression export on reservation exhaustion without extra actions',async()=>{
 const {result,content,closed}=await execute([bad],1);
 assert.equal(content,'a=0,b=1'); // no claim of physical restoration
 assert.equal(result.patch,'');
 assert.equal(result.status,'exhausted');assert.equal(result.modelRequests,1);
 assert.equal(result.publicTests,1);assert.equal(closed,true);
 assert.equal(result.events.filter(e=>e.kind==='decision'&&(e.detail as any).action==='retain_verified_champion').length,1);
});
test('v5 exports a nonempty passing champion when a later edit is untested',async()=>{
 const {result}=await execute([prerequisite,check,bad],3);
 assert.match(result.patch,/\+a=2,b=0/);
 assert.equal(result.status,'exhausted');assert.equal(result.modelRequests,3);assert.equal(result.publicTests,2);
});
test('v5 preserves verified alternative recovery after batch rollback',async()=>{
 const {result,content}=await execute([prerequisite,bad,check,prerequisite,check]);
 assert.equal(content,'a=2,b=0');assert.match(result.patch,/\+a=2,b=0/);
 assert.equal(result.events.some(e=>e.kind==='decision'&&(e.detail as any).action==='retain_verified_champion'),false);
});
