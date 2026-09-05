import assert from 'node:assert/strict';
import * as m from './inventory.mjs';
const cases=[
 ()=>m.total(null),()=>m.total({}),()=>m.add([],null),()=>m.remove([],null),
 ()=>m.add([],{sku:new String('A'),quantity:1,unitCents:1}),
 ()=>m.add([],{sku:{toString(){return 'A'}},quantity:1,unitCents:1}),
 ()=>m.remove([],[new String('A')]),()=>m.add(null,{sku:'A',quantity:1,unitCents:1}),
 ()=>m.total([{sku:'A',quantity:NaN,unitCents:1}]),
 ()=>m.total([{sku:'A',quantity:1,unitCents:1.5}])];
for(const run of cases)assert.throws(run,RangeError);
console.log('RUNTIME_BOUNDARY_10_PASS');
