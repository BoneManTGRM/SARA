import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel} from '../src/kernel.ts';
import {runSafeExpansionRuntimeProof} from '../src/digital-capabilities/expansion-runtime-proof.ts';
test('serving-kernel synthetic probes produce receipts and preserve controls/state',async()=>{const dir=await mkdtemp(join(tmpdir(),'sara-expansion-runtime-'));try{const kernel=await SaraKernel.boot({stateDirectory:dir});const p=await runSafeExpansionRuntimeProof({kernel,sourceRevision:'a'.repeat(40),deploymentId:'isolated-runtime',environment:'ISOLATED'});assert.equal(p.status,'VERIFIED',JSON.stringify(p.behaviors));assert.ok(p.capabilityCount>=14);assert.equal(p.authorityDelta,0);}finally{await rm(dir,{recursive:true,force:true});}});
