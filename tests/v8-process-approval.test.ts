import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateV8Approval,type Identity} from '../proof/v8-process-approval.ts';
const identity:Identity={contractDigest:'a'.repeat(64),implementationCommit:'b'.repeat(40),deploymentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',serviceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',nonce:'c'.repeat(64)};
const grant=()=>({schemaVersion:1,caseId:'bounded-inventory-basket-v8-live-01',mode:'live',...identity,maximumPhysicalSpendUsd:0.15,issuedAt:1000,expiresAt:61000});
test('permits only the owner-issued exact-process grant',()=>assert.doesNotThrow(()=>validateV8Approval(grant(),identity,2000)));
for(const field of ['contractDigest','implementationCommit','deploymentId','serviceId','nonce'] as const)test(`rejects a different ${field}, including a restarted process`,()=>{const g=grant();g[field]='d'.repeat(g[field].length);assert.throws(()=>validateV8Approval(g,identity,2000));});
for(const [label,change] of [
 ['expired',(g:any)=>{g.expiresAt=1999;}],['future issued',(g:any)=>{g.issuedAt=2001;}],['budget raised',(g:any)=>{g.maximumPhysicalSpendUsd=0.16;}],['budget missing',(g:any)=>{delete g.maximumPhysicalSpendUsd;}],['wrong case',(g:any)=>{g.caseId='old-v7';}],['not live',(g:any)=>{g.mode='offline';}],['too long',(g:any)=>{g.expiresAt=4000000;}],['schema',(g:any)=>{g.schemaVersion=2;}],['extra executable data',(g:any)=>{g.command='anything';}],
] as const)test(`rejects ${label} before model access`,()=>{const g=grant();change(g);assert.throws(()=>validateV8Approval(g,identity,2000));});
for(const value of [null,[],true,'ok',{},NaN])test(`rejects non-grant ${String(value)}`,()=>assert.throws(()=>validateV8Approval(value,identity,2000)));
