import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveSoftwareTarget} from '../src/owner-software-work.ts';
import {SaraKernel} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';

test('negated inspection or execution cannot grant a software adapter action',()=>{
 for(const text of [
  'Inspect the source on Nico’s World; do not test the movement-to-scanner journey.',
  'Check the movement-to-scanner flow on Nico’s World but never execute it.',
  'Do not inspect the source of the Nico’s World repository.',
  'Check Nico’s World movement-to-scanner, but don’t run the journey.',
 ]) {
  const resolved=resolveSoftwareTarget(text);
  assert.equal(resolved.target,null,text);
  assert.match(resolved.missing.join(' '),/negat|prohibit|scope/i);
 }
});

test('a reversed journey is not silently replaced with the supported forward profile',()=>{
 for(const text of [
  'Test the scanner-to-movement journey on Nico’s World.',
  'Test scanner before movement on the Nico’s World path.',
  'Test movement after scanner on the Nico’s World path.',
 ]) assert.equal(resolveSoftwareTarget(text).target,null,text);
 for(const text of [
  'Test the movement-to-scanner journey on Nico’s World.',
  'Check movement then scanner on Nico’s World.',
  'Verify scanner after movement on Nico’s World.',
 ]) assert.equal(resolveSoftwareTarget(text).target?.journey,'movement-to-scanner',text);
});

test('an explicit blocked project switch invalidates older conversation selection across restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-software-context-boundary-'));
 const token='synthetic-context-boundary-owner';
 try {
  const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
  const owner=kernel.authenticateOwnerToken(token),conversationId='synthetic-context-boundary';
  const first=await kernel.executeOwnerMessage(owner,{requestId:'synthetic-selected-nico',conversationId,text:'Test the movement-to-scanner journey on Nico’s World.'});
  assert.equal(first.softwareTarget?.repository,'BoneManTGRM/Nicos-Adventures');
  const changed=await kernel.executeOwnerMessage(owner,{requestId:'synthetic-project-change',conversationId,text:'Test the movement and scanner journey on the OtherOrg/OtherProject website.'});
  assert.equal(changed.status,'BLOCKED');assert.equal(changed.softwareTarget,undefined);
  const resumed=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
  const follow=await resumed.executeOwnerMessage(resumed.authenticateOwnerToken(token),{requestId:'synthetic-after-project-change',conversationId,text:'Check the same project movement-to-scanner flow.'});
  assert.equal(follow.status,'BLOCKED');assert.equal(follow.softwareTarget,undefined);
  assert.equal(follow.receipts.length,0);
  assert.match(follow.blockers.map(b=>b.reason).join(' '),/repository|project/i);
 } finally {await rm(directory,{recursive:true,force:true});}
});
