import assert from "node:assert/strict";
import { test } from "node:test";
import { repositoryResourceLimitsRespected } from "../src/repository-resource-evidence.ts";

const counters = (oom = 0, killed = 0, pids = 0) => `memory.events\nlow 0\nhigh 0\nmax 116\noom ${oom}\noom_kill ${killed}\noom_group_kill 0\npids.current\n12\npids.max\n256\npids.events\nmax ${pids}\n`;
test("qualification rejects resource exhaustion even when the test command exits zero", () => {
  assert.equal(repositoryResourceLimitsRespected(counters(), counters()), true);
  // Observed in successful workflow 34178360150; it is not a qualified pass.
  assert.equal(repositoryResourceLimitsRespected(counters(), counters(3, 1)), false);
  assert.equal(repositoryResourceLimitsRespected(counters(), counters(1)), false);
  assert.equal(repositoryResourceLimitsRespected(counters(), counters(0, 0, 1)), false);
});
test("qualification rejects missing, malformed, duplicate, unsafe and reset counters", () => {
  for (const value of [null, "", counters().replace("oom 0", "oom NaN"), counters() + "oom 0\n",
    counters().replace("oom 0", "oom 9007199254740992")]) {
    assert.equal(repositoryResourceLimitsRespected(counters(), value), false);
    assert.equal(repositoryResourceLimitsRespected(value, counters()), false);
  }
  assert.equal(repositoryResourceLimitsRespected(counters(1, 1), counters()), false);
});
