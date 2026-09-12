import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {capabilityContracts} from '../src/digital-capabilities/registry.ts';
test('all 93 owner-requested capabilities have reviewed qualified contracts and execution boundaries',async()=>{
 const inventory=JSON.parse(await readFile(new URL('../docs/digital-worker-mission-inventory.json',import.meta.url),'utf8'));
 const expected=inventory.requiredCapabilities.map((r:{id:string})=>r.id).sort();assert.equal(expected.length,93);assert.equal(new Set(expected).size,93);
 const contracts=await capabilityContracts();assert.deepEqual(contracts.map(c=>c.id).sort(),expected);
 for(const c of contracts){assert.equal(c.qualification.status,'PASSED',c.id);assert.equal(c.status,'ENABLED',c.id);assert.ok(c.qualification.passed>0,c.id);assert.ok(c.description.length>20);assert.ok(c.requiredAuthorities.length);assert.ok(c.invalidationRules.length);assert.equal(c.budget.maximumCashMicroUsd,0);assert.equal(c.inputSchema.additionalProperties,false,c.id);assert.equal(c.outputSchema.additionalProperties,false,c.id);}
});
