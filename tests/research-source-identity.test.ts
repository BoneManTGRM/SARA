import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {researchSourceIdentity} from '../proof/research-source-identity.ts';

test('research records the checked-out commit, not the workflow merge ref',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sara-identity-'));const old=process.env.GITHUB_SHA;
 try{
  execFileSync('git',['init','-q',dir]);writeFileSync(join(dir,'x.txt'),'source\n');
  execFileSync('git',['-C',dir,'add','x.txt']);execFileSync('git',['-C',dir,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture']);
  const head=execFileSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8'}).trim();process.env.GITHUB_SHA='a'.repeat(40);
  assert.equal(researchSourceIdentity(dir,head),head);
  assert.throws(()=>researchSourceIdentity(dir,'b'.repeat(40)),/SOURCE_IDENTITY_MISMATCH/);
  assert.throws(()=>researchSourceIdentity(dir,'not-a-sha'),/SOURCE_IDENTITY_MISMATCH/);
 }finally{if(old===undefined)delete process.env.GITHUB_SHA;else process.env.GITHUB_SHA=old;rmSync(dir,{recursive:true,force:true});}
});
test('missing git provenance cannot be replaced with a workflow environment value',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sara-no-git-'));
 try{assert.throws(()=>researchSourceIdentity(dir),/SOURCE_IDENTITY_UNAVAILABLE/);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
