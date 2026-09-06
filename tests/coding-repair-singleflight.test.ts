import assert from "node:assert/strict";
import { test } from "node:test";
import { RepairLearningCoordinator, type RepairLearningLeader } from "../src/coding-repair-singleflight.ts";
import { sha256 } from "../src/canonical.ts";
const key = sha256("singleflight-fixture");
function leader(c: RepairLearningCoordinator, k = key): RepairLearningLeader {
  const result = c.claim(k); assert.equal(result.role, "leader"); return result as RepairLearningLeader;
}

test("one leader broadcasts only committed status, not source or authority", async () => {
  const c = new RepairLearningCoordinator(), l = leader(c);
  const first = c.claim(key), second = c.follow(key)!;
  assert.equal(first.role, "follower");
  const promises = [(first as typeof second).wait(), second.wait()];
  l.finish(true); await Promise.all(promises); assert.equal(c.follow(key), null);
  const next = leader(c); l.finish(false); assert(c.follow(key)); next.finish(false);
});
test("failed leader denies all followers and releases its identity", async () => {
  const c = new RepairLearningCoordinator(), l = leader(c), f = c.follow(key)!;
  const result = assert.rejects(f.wait(), /LEADER_NOT_COMMITTED/); l.finish(false); await result;
  const next = leader(c); next.finish(true);
});
test("settled follower tickets cannot be replayed or revived", async () => {
  for (const success of [true, false]) {
    const c = new RepairLearningCoordinator(), l = leader(c), f = c.follow(key)!; l.finish(success);
    if (success) await f.wait(); else await assert.rejects(f.wait(), /LEADER_NOT_COMMITTED/);
    await assert.rejects(f.wait(), /WAIT_REPLAY/);
  }
});
test("timeout detaches followers without stealing an unresolved leader", async () => {
  const c = new RepairLearningCoordinator(1), l = leader(c);
  for (let i = 0; i < 4; i++) await assert.rejects(c.follow(key)!.wait(), /WAIT_TIMEOUT/);
  assert.equal(c.claim(key).role, "follower"); l.finish(true); assert.equal(c.follow(key), null);
});
test("leader capacity is bounded and only an actual completion releases a slot", () => {
  const c = new RepairLearningCoordinator(), leases = Array.from({ length: 32 }, (_, i) => leader(c, sha256(String(i))));
  assert.throws(() => c.claim(key), /CAPACITY/); leases[0].finish(false);
  leader(c).finish(false); leases.forEach(l => l.finish(false));
});
test("per-identity follower saturation fails closed and releases on completion", async () => {
  const c = new RepairLearningCoordinator(), l = leader(c);
  const waits = Array.from({ length: 32 }, () => c.follow(key)!.wait());
  await assert.rejects(c.follow(key)!.wait(), /WAITER_CAPACITY/);
  l.finish(true); await Promise.all(waits);
  const next = leader(c); const wait = c.follow(key)!.wait(); next.finish(true); await wait;
});
test("global follower saturation is bounded across different identities", async () => {
  const c = new RepairLearningCoordinator(); const leases: RepairLearningLeader[] = [], waits: Promise<void>[] = [];
  for (let i = 0; i < 4; i++) {
    const k = sha256(String(i)); leases.push(leader(c, k));
    for (let j = 0; j < 32; j++) waits.push(c.follow(k)!.wait());
  }
  const extra = leader(c); await assert.rejects(c.follow(key)!.wait(), /WAITER_CAPACITY/);
  leases.forEach(l => l.finish(true)); extra.finish(false); await Promise.all(waits);
});
test("invalid identity and timeout parameters do not create coordination state", () => {
  const c = new RepairLearningCoordinator();
  for (const value of ["", "../x", "a".repeat(63), "A".repeat(64)]) assert.throws(() => c.claim(value), /INVALID_KEY/);
  for (const value of [0, -1, 30_001, 1.5, NaN, Infinity]) assert.throws(() => new RepairLearningCoordinator(value), /INVALID_TIMEOUT/);
  assert.equal(c.follow(key), null);
});
