import assert from "node:assert/strict";
import { test } from "node:test";
import { Script } from "node:vm";
import { DASHBOARD_HTML } from "../src/dashboard.ts";
import {
  applyOwnerJobActivityPanel,
  OWNER_JOB_ACTIVITY_MARKER,
} from "../src/owner-job-activity-runtime.ts";

test("owner dashboard groups retry records into useful jobs and exposes live activity", () => {
  const transformed = applyOwnerJobActivityPanel(DASHBOARD_HTML);
  assert.notEqual(transformed, DASHBOARD_HTML);
  assert.match(transformed, new RegExp(OWNER_JOB_ACTIVITY_MARKER));
  assert.match(transformed, /01A \/\/ LIVE ACTIVITY/);
  assert.match(transformed, /What SARA<br>is doing\./);
  assert.match(transformed, /Useful jobs/);
  assert.match(transformed, /renderOwnerJobActivity\(state\)/);
  assert.match(transformed, /learningCampaignId, job\.learningCapabilityId, job\.learningSourceJobId/);
  assert.match(transformed, /learning run records/);
  assert.doesNotMatch(transformed, /document\.querySelector\('#jobs'\)\.textContent = String\(state\.jobs\.length\)/);

  const scripts = [...transformed.matchAll(/<script>([\s\S]*?)<\/script>/gu)];
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new Script(script[1]!, { filename: "owner-job-activity.js" }));
});

test("owner live activity transformation is idempotent and owner-page only", () => {
  const transformed = applyOwnerJobActivityPanel(DASHBOARD_HTML);
  assert.equal(applyOwnerJobActivityPanel(transformed), transformed);
  const publicPage = "<html><head><title>SARA public</title></head><body></body></html>";
  assert.equal(applyOwnerJobActivityPanel(publicPage), publicPage);
});
