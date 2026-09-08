import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("public recipe repairs preserve pinned runtime and dependency boundaries", () => {
  execFileSync("python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "test_public_recipe_repairs.py"], {
    cwd: new URL("..", import.meta.url), timeout: 15_000, stdio: "pipe",
  });
});
