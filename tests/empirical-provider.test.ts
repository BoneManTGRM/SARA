import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PhysicalBudget} from '../proof/empirical-provider.ts';
test('six physical requests are the absolute run limit',()=>{const b=new PhysicalBudget();for(let i=0;i<6;i++)b.reserve();assert.throws(()=>b.reserve(),/PHYSICAL_LIMIT/);assert.equal(b.calls,6);});
test('unknown spending preserves the full reservation',()=>{const b=new PhysicalBudget();const r=b.reserve();b.settle(r,null);assert.equal(b.reserved,0.025);});
test('known spending replaces only its own reservation',()=>{const b=new PhysicalBudget();const r=b.reserve();b.reserve();b.settle(r,0.003);assert(Math.abs(b.reserved-0.028)<1e-12);});
test('malformed or excessive reported cost fails closed',()=>{for(const cost of [-1,NaN,Infinity,0.026]){const b=new PhysicalBudget();const r=b.reserve();assert.throws(()=>b.settle(r,cost),/COST/);assert.equal(b.reserved,0.025);}});
test('one reservation cannot be refunded twice',()=>{const b=new PhysicalBudget();const r=b.reserve();b.settle(r,0.001);assert.throws(()=>b.settle(r,0.001),/RESERVATION/);});
