import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { KernelBuildQueue } from "../src/kernel-build-queue.ts";
test("cooperative kernel queue bounds active work at two and preserves FIFO admission", async () => {
  const q = new KernelBuildQueue(); let active = 0, max = 0; const started: number[] = [];
  const tasks = Array.from({ length: 8 }, (_, i) => q.run(async () => { active++; max = Math.max(max, active); started.push(i); await delay(3); active--; return i; }));
  assert.deepEqual(await Promise.all(tasks), [0,1,2,3,4,5,6,7]); assert.deepEqual(started,[0,1,2,3,4,5,6,7]); assert.equal(max,2); await q.close();
});
test("cooperative queue rejects excess work before its operation starts", async () => {
  const q=new KernelBuildQueue();let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});let calls=0;
  const tasks=Array.from({length:34},()=>q.run(async()=>{calls++;await wait;}));
  await assert.rejects(q.run(async()=>{calls++;}),/CAPACITY/);release();await Promise.all(tasks);assert.equal(calls,34);await q.close();
});
test("queued deadline prevents delayed dispatch while active work drains normally", async () => {
  const q=new KernelBuildQueue(2);let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});
  const a=q.run(async()=>{await wait;}),b=q.run(async()=>{await wait;});let called=false;
  await assert.rejects(q.run(async()=>{called=true;}),/DEADLINE/);assert.equal(called,false);release();await Promise.all([a,b]);await q.close();
});
test("closing queue rejects waiting/new work but does not abandon active cleanup", async () => {
  const q=new KernelBuildQueue();let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});let cleaned=0;
  const a=q.run(async()=>{await wait;cleaned++;}),b=q.run(async()=>{await wait;cleaned++;});
  const c=q.run(async()=>{});const rejected=assert.rejects(c,/CLOSED/);const closing=q.close();
  await rejected;await assert.rejects(q.run(async()=>{}),/CLOSED/);release();await Promise.all([a,b,closing]);assert.equal(cleaned,2);
});
test("failed operation releases its slot without replay or poisoning later work", async () => {
  const q=new KernelBuildQueue();let calls=0;
  await assert.rejects(q.run(async()=>{calls++;throw Error("failure");}));assert.equal(await q.run(async()=>7),7);assert.equal(calls,1);await q.close();
});
