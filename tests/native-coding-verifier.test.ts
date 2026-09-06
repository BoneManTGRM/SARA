import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeCodingVerifier } from "../src/native-coding-verifier.ts";
import { verifyGenomeLabProgramCandidate as legacy } from "../src/genome-lab-verifier.ts";
import { createReusableCodingCandidateGenerator } from "../src/reusable-coding-candidate-generator.ts";
import { DurableCodingRepairMemory } from "../src/coding-repair-memory.ts";
import { candidate, context, model, scope, check } from "./helpers/repair-memory-fixture.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const native = (await NativeCodingVerifier.create())!;
assert(native, "Install the pinned compiler: node scripts/build-native-checker.mjs (qualified linux-x64 test host required)");
const verify = (c: ProgramCandidateProposal) => legacy({ candidate: c, ...context });
function fixture(source: string) { const c = candidate(true); c.files[1].content = source; return c; }
const cases: Array<[string, ProgramCandidateProposal, boolean]> = [
  ["correct", candidate(true), true], ["behavior error", candidate(false), false],
  ["wrong type", fixture('export const value: number = "17";'), false],
  ["wrong argument", fixture('function twice(n: number) { return n*2; } export const value = twice("x");'), false],
  ["nullability", fixture('export const value: number = null;'), false],
  ["missing export", fixture('export const other = 17;'), false],
  ["readonly", fixture('const x: readonly number[] = [1]; x.push(2); export const value = 17;'), false],
  ["syntax", fixture('export const value: = 17;'), false],
  ["computed property", fixture('export const value = [17][0];'), false],
  ["prohibited capability", fixture('process.exit(0); export const value=17;'), false],
  ["missing module", fixture('import {x} from "./missing.ts"; export const value=x;'), false],
  ["external module", fixture('import {x} from "fs"; export const value=x;'), false],
];
for (const [name, c, pass] of cases) test(`native loop and legacy agree on ${name}`, async () => {
  const old = await verify(c), next = await native.verify({ candidate: c, ...context });
  assert.equal(old.passed, pass); assert.equal(next.passed, pass);
  assert.equal(next.artifactDigest, old.artifactDigest); assert.deepEqual(next.failures, old.failures);
  assert.deepEqual(next.completedChecks, old.completedChecks);
  assert.equal(next.score, old.score);
});

test("TypeScript version disagreement is blocked before even an already-correct baseline can return", async () => {
  const c = fixture('type Head<S extends string> = S extends `${infer H}${infer T}` ? H : never; const s: Head<"😀abc">="😀"; export const value=17;');
  assert.equal((await native.verify({ candidate: c, ...context })).passed, true);
  assert.equal((await verify(c)).passed, false);
  const root = await mkdtemp(join(tmpdir(), "sara-native-final-"));
  try {
    const count = { calls: 0 }; let finalChecks = 0, receipts = 0;
    const generator = createReusableCodingCandidateGenerator({ base: { id: "native-test", external: false, maximumCostUsd: 0, async generate() { return c; } },
      mode: "canary", model: model(count), memory: new DurableCodingRepairMemory(root), scope: async () => scope,
      verify: c => native.verify({ candidate: c, ...context }), verifyFinal: c => { finalChecks++; return verify(c); }, onReuse: () => { receipts++; } });
    await assert.rejects(() => generator.generate(context), /REPAIR_REUSE_FINAL_VERIFICATION_FAILED/u);
    assert.equal(count.calls, 0); assert.equal(finalChecks, 1); assert.equal(receipts, 0);
    assert(!(await readdir(root)).includes("coding-repair-memory-v1"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed legacy final check prevents learning after a generated native PASS", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-native-final-fail-"));
  try {
    const count = { calls: 0 }; const memory = new DurableCodingRepairMemory(root); let learned = 0;
    const learn = memory.learn.bind(memory); memory.learn = async input => { learned++; return learn(input); };
    const generator = createReusableCodingCandidateGenerator({ base: { id: "native-test", external: false, maximumCostUsd: 0, async generate() { return candidate(); } },
      mode: "canary", model: model(count), memory, scope: async () => scope,
      verify: c => native.verify({ candidate: c, ...context }), verifyFinal: async c => check(c, false), onReuse() {} });
    await assert.rejects(() => generator.generate(context), /REPAIR_REUSE_FINAL_VERIFICATION_FAILED/u);
    assert.equal(count.calls, 1); assert.equal(learned, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native verification owns its input before asynchronous dispatch", async () => {
  const c = candidate(true), original = structuredClone(c);
  const result = await native.verify({ candidate: c, ...context }, () => { c.files[1].content = 'throw new Error("mutation");'; });
  assert(result.passed); assert.equal(result.artifactDigest, (await verify(original)).artifactDigest);
});

test("authority failure releases the native slot and never executes the candidate", async () => {
  const before = (await readdir(tmpdir())).filter(n => n.startsWith("sara-native-canary-"));
  await assert.rejects(() => native.verify({ candidate: candidate(true), ...context }, () => { throw new Error("revoked"); }), /revoked/u);
  assert.equal((await native.verify({ candidate: candidate(true), ...context })).passed, true);
  assert.deepEqual((await readdir(tmpdir())).filter(n => n.startsWith("sara-native-canary-")), before);
});

test("native queue bounds admissions and rechecks authority when a waiting call dispatches", async () => {
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  const first = native.verify({ candidate: candidate(true), ...context }, () => hold);
  const second = native.verify({ candidate: candidate(true), ...context }, () => hold);
  let revoked = false;
  const waiters = Array.from({ length: 16 }, () => native.verify({ candidate: candidate(true), ...context }, () => {
    if (revoked) throw new Error("revoked while queued");
  }).catch(e => e as Error));
  await assert.rejects(() => native.verify({ candidate: candidate(true), ...context }), /QUEUE_FULL/u);
  revoked = true; release(); assert((await first).passed); assert((await second).passed);
  for (const result of await Promise.all(waiters)) assert(result instanceof Error && /revoked while queued/u.test(result.message));
  assert((await native.verify({ candidate: candidate(true), ...context })).passed);
});
