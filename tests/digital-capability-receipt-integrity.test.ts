import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SaraKernel } from "../src/kernel.ts";
import { sha256 } from "../src/canonical.ts";

test("unpersisted malformed invocation never claims an audit mutation",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"sara-invalid-receipt-")),token="receipt-fixture-owner";
 try{const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});const owner=kernel.authenticateOwnerToken(token);const count=(await kernel.inspectAudit()).length;
 const result=await kernel.invokeCapability(owner,{requestId:"bad-input",capabilityId:"autonomy-boundary-checker",input:{value:NaN}});
 assert.equal(result.status,"INVALID_INPUT");assert.deepEqual(result.persistentChanges,[]);assert.equal((await kernel.inspectAudit()).length,count);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test("frozen qualification cache reports actual reused evidence without changing its digest",async()=>{
 const module=await import("../src/digital-capabilities/registry.ts");
 const first=await module.runFrozenCapabilityCases("autonomy-boundary-checker");
 const second=await module.runFrozenCapabilityCases("autonomy-boundary-checker");
 const reused=second as typeof second&{evidenceDisposition?:string;implementationDigest?:string};
 assert.equal(reused.evidenceDisposition,"REUSED");assert.match(reused.implementationDigest??"",/^[a-f0-9]{64}$/u);
 assert.equal(second.caseDigest,first.caseDigest);assert.equal(second.passed,first.passed);
 const original=await module.capabilityContract("autonomy-boundary-checker");assert.equal((await module.capabilityContract("autonomy-boundary-checker"))?.contractDigest,original?.contractDigest);
});
