import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("judge fixture proxy enforces its offline-tested destination and resource boundary", () => {
  execFileSync("python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "test_swe_judge_fixture_proxy.py"], {
    cwd: new URL("..", import.meta.url),
    timeout: 15_000,
    stdio: "pipe",
  });
});
