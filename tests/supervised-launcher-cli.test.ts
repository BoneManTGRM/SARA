import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {loadSupervisedContract} from '../proof/supervised-benchmark-contract.ts';
const run=promisify(execFile),uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('actual launcher CLI connects its admission to the Railway command and verified worker, without forwarding keys',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-launcher-cli-'));
 try{
  const bin=join(directory,'bin'),ledger=join(directory,'ledger');await mkdir(bin,{mode:0o700});await mkdir(ledger,{mode:0o700});
  await writeFile(join(bin,'railway'),'#!/bin/sh\nexec node tests/fixtures/fake-railway-cli.mjs "$@"\n',{mode:0o700});
  const contract=await loadSupervisedContract(),grantFile=join(directory,'grant.json'),output=join(directory,'result.json');
  await writeFile(grantFile,JSON.stringify({grant:{experimentId:contract.caseId,contractDigest:contract.digest,implementationCommit:'b'.repeat(40),deploymentId:uuid,expiresAt:Date.now()+120_000,maximumPhysicalSpendUsd:0.15},railway:{projectId:uuid,environmentId:uuid,serviceId:uuid,instanceId:uuid}}),{mode:0o600});
  const args=['--import','tsx','scripts/launch-supervised-benchmark.ts','--mode','offline','--grant',grantFile,'--ledger',ledger,'--output',output];
  const options={env:{PATH:bin+':'+process.env.PATH,HOME:directory,OPENAI_API_KEY:'PRIVATE_NEVER_FORWARD'},timeout:60_000};
  const first=await run(process.execPath,args,options);assert.equal(first.stdout.trim(),'SUPERVISED_RESULT_SAVED');
  const text=await readFile(output,'utf8'),result=JSON.parse(text);assert(!text.includes('PRIVATE_NEVER_FORWARD'));
  assert(result.result.arms.every((arm:{verifiedComplete:boolean})=>arm.verifiedComplete));assert.equal(result.generations,2);
  assert.equal(result.result.target300PercentMet,false);assert.equal(result.result.speedRatio,null);
  assert.equal(result.result.supervisionContractDigest,contract.digest);
  await assert.rejects(()=>run(process.execPath,args,options));
  const paidArgs=[...args];paidArgs[paidArgs.indexOf('offline')]='live';await assert.rejects(()=>run(process.execPath,paidArgs,options));
 }finally{await rm(directory,{recursive:true,force:true});}
});
