import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selfManagementDefinitions} from '../src/digital-capabilities/self-management/definitions.ts';
import {BASE_QUALIFICATION_CONTEXT} from '../src/digital-capabilities/foundation.ts';
import {validateSchema} from '../src/digital-capabilities/schema.ts';
test('self-management frozen decisions preserve authority and obligations',async()=>{for(const d of selfManagementDefinitions)for(const c of d.cases){validateSchema(d.inputSchema,c.input);const r=await d.execute(c.input as any,{...BASE_QUALIFICATION_CONTEXT,...c.context});validateSchema(d.outputSchema,r.output);assert.ok(c.check(r),d.id+':'+c.name);}});
test('goal compiler identifies software work from a high-level goal while preserving missing exact inputs and authority',async()=>{
 const d=selfManagementDefinitions.find(d=>d.id==='goal-to-work-queue-compiler')!;
 const r=await d.execute({goalId:'fix-login',goal:'Fix the software login regression',tasks:[]},BASE_QUALIFICATION_CONTEXT);
 const out=r.output as any;assert.equal(out.tasks.length,9);assert.equal(out.tasks[0].capabilityId,'bug-reproduction-planner');assert.equal(out.tasks.at(-1).capabilityId,'production-proof-validator');assert.ok(out.tasks.every((t:any)=>t.input===null&&t.permission==='UNKNOWN'));assert.equal(out.status,'INCOMPLETE_EVIDENCE');assert.equal(out.executionAuthorized,false);
});
