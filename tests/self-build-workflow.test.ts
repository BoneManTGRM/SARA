import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("self-build workflow authority", () => {
  it("passes the short-lived repository token only to the bounded executor step", async () => {
    const workflow = await readFile(".github/workflows/self-build.yml", "utf8");
    const executorStep = workflow.match(
      /- name: Claim and verify at most one directive\n(?<body>(?: {8,}.*\n)*)/u,
    )?.groups?.body ?? "";

    assert.match(executorStep, /GH_TOKEN: \$\{\{ github\.token \}\}/u);
    assert.match(executorStep, /run: npm run executor:site/u);
    assert.equal((workflow.match(/GH_TOKEN:/gu) ?? []).length, 1);
    assert.match(workflow, /pull-requests: write/u);
    assert.doesNotMatch(workflow, /secrets\.[A-Za-z0-9_]*TOKEN/u);
  });
});
