import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("Cloudflare self-build workflow authority", () => {
  it("is manual, free-plan, draft-approved, and does not expose production authority", async () => {
    const workflow = await readFile(".github/workflows/cloudflare-self-build.yml", "utf8");
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /public_draft_approved:/);
    assert.match(workflow, /inputs\.public_draft_approved == true/);
    assert.match(workflow, /SARA_WORKERS_PLAN: free/);
    assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
    assert.doesNotMatch(workflow, /\bschedule:/);
    assert.doesNotMatch(workflow, /\bdeploy\b|\bmerge\b|payments?: write/iu);
    assert.match(workflow, /paths:\n\s+- \.github\/sara\/one-shot-opportunity-to-offer-v1/);
    assert.match(workflow, /github\.event_name == 'push'/);
  });
});
