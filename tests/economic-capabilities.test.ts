import assert from 'node:assert/strict';
import {test} from 'node:test';
import {economicDefinitions} from '../src/digital-capabilities/economic/definitions.ts';
import {BASE_QUALIFICATION_CONTEXT} from '../src/digital-capabilities/foundation.ts';
import {validateSchema} from '../src/digital-capabilities/schema.ts';
test('all economic contracts execute their frozen boundary examples',async()=>{
 for(const d of economicDefinitions)for(const c of d.cases){validateSchema(d.inputSchema,c.input);const r=await d.execute(c.input as any,{...BASE_QUALIFICATION_CONTEXT,...c.context});validateSchema(d.outputSchema,r.output);assert.ok(c.check(r),`${d.id}:${c.name}`);}
});
