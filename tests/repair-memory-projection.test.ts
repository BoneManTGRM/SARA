import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExactByteSnapshotCache } from "../src/repair-memory-snapshot.ts";
import { DurableCodingRepairMemory } from "../src/coding-repair-memory.ts";
import { candidate, check, scope, training } from "./helpers/repair-memory-fixture.ts";

for (const invalid of [Buffer.from([0xff]), Buffer.from([0xc0,0xaf]), Buffer.from([0xed,0xa0,0x80]), Buffer.from([0xe2,0x82])]) {
  test(`reject invalid UTF8 ${invalid.toString('hex')} before decoding any record`, () => {
    let decodes = 0;
    const cache = new ExactByteSnapshotCache(text => { decodes++; return JSON.parse(text); });
    const bytes = Buffer.concat([Buffer.from('{"x":"'), invalid, Buffer.from('"}')]);
    assert.throws(() => cache.decode("a", bytes), /REPAIR_MEMORY_INVALID_UTF8/);
    assert.equal(decodes, 0);
  });
}
test("legitimate replacement characters and multibyte text remain valid", () => {
  const cache = new ExactByteSnapshotCache(JSON.parse);
  const value = { text: "\ufffd café 😀" };
  assert.deepEqual(cache.decode("a", Buffer.from(JSON.stringify(value))), value);
});
test("invalid bytes invalidate a previous snapshot rather than making it reusable", () => {
  let calls=0; const cache=new ExactByteSnapshotCache(text=>{calls++;return JSON.parse(text);});
  const good=Buffer.from('{"x":"ok"}');cache.decode("a",good);
  assert.throws(()=>cache.decode("a",Buffer.from([0xff])),/INVALID_UTF8/);
  cache.decode("a",good);assert.equal(calls,2);
});
test("projection returns isolated selected data and never exposes mutable cached records", () => {
  let calls=0; const cache=new ExactByteSnapshotCache(text=>{calls++;return JSON.parse(text);});
  const bytes=Buffer.from('{"records":[{"id":1,"nested":{"x":2}},{"id":2,"nested":{"x":3}}]}');
  const first=cache.project("a",bytes,value=>value.records[0]);first.nested.x=99;
  assert.equal(cache.project("a",bytes,value=>value.records[0].nested.x),2);
  assert.throws(()=>cache.project("a",bytes,value=>{value.records[0].nested.x=7;return 0;}),TypeError);
  assert.throws(()=>cache.project("a",bytes,value=>{value.records.push({id:3});return 0;}),TypeError);
  assert.equal(calls,1);assert.equal(cache.decode("a",bytes).records.length,2);
});
test("projected snapshot owns its decoder output and input bytes", () => {
  let owned:any;const cache=new ExactByteSnapshotCache(text=>{owned=JSON.parse(text);return owned;});
  const bytes=Buffer.from('{"a":{"value":2}}');
  cache.project("a",bytes,v=>v.a);owned.a.value=9;bytes.fill(0);
  assert.equal(cache.project("a",Buffer.from('{"a":{"value":2}}'),v=>v.a.value),2);
});
test("projector failures do not corrupt snapshots and changed data revalidates", () => {
  let calls=0;const cache=new ExactByteSnapshotCache(text=>{calls++;return JSON.parse(text);});
  assert.throws(()=>cache.project("a",Buffer.from('{"x":1}'),()=>{throw Error("reader failure");}),/reader failure/);
  assert.equal(cache.project("a",Buffer.from('{"x":1}'),v=>v.x),1);
  assert.equal(cache.project("a",Buffer.from('{"x":2}'),v=>v.x),2);assert.equal(calls,2);
});
test("unsupported mutable decoder types are rejected, not presented as frozen", () => {
  for(const decode of [()=>new Map([["x",1]]),()=>new Date(),()=>new Uint8Array([1])]) {
    const cache=new ExactByteSnapshotCache<unknown>(decode);
    assert.throws(()=>cache.project("a",Buffer.from('1'),value=>value),/SNAPSHOT_NOT_PLAIN_DATA/);
  }
});
test("invalid UTF8 cannot enter durable recipe memory with a hash of replacement text", async()=>{
  const root=await mkdtemp(join(tmpdir(),"sara-memory-utf8-"));
  try{
    const memory=new DurableCodingRepairMemory(root), data=training();
    data.after.files[1].content += '\n// \ufffd\n';
    data.verification=check(data.after,true);
    await memory.learn(data);
    const path=join(memory.directory,'memory.json'),valid=await readFile(path);
    const marker=Buffer.from('\ufffd'),index=valid.indexOf(marker);assert(index>=0);
    const malformed=Buffer.concat([valid.subarray(0,index),Buffer.from([0xff]),valid.subarray(index+marker.length)]);
    await writeFile(path,malformed);
    await assert.rejects(memory.lookup(data.before,data.beforeVerification,data.scope,'surgical'),/INVALID_UTF8/);
    await writeFile(path,valid);
    const hit=await memory.lookup(data.before,data.beforeVerification,data.scope,'surgical');assert(hit);
    hit.proposal.changes[0].replacementText='mutated returned data';
    assert.notEqual((await memory.lookup(data.before,data.beforeVerification,data.scope,'surgical'))!.proposal.changes[0].replacementText,'mutated returned data');
  }finally{await rm(root,{recursive:true,force:true});}
});
