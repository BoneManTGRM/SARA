import assert from "node:assert/strict";
import test from "node:test";
import { browserObserverAuthorized, browserRequestAllowed } from "../src/browser-observer.ts";

test("browser observer cannot submit forms, leave SARA, or access private task APIs", () => {
  for (const path of ["/", "/pilot", "/assets/app.js", "/api/public/signal", "/api/owner/session"]) assert.equal(browserRequestAllowed(`https://saraseed.app${path}`, "GET"), true);
  for (const url of ["http://saraseed.app/", "https://saraseed.app.evil.test/", "https://user:password@saraseed.app/", "http://169.254.169.254/", "file:///etc/passwd", "https://saraseed.app/api/owner/live", "https://saraseed.app/%61pi/owner/live", "https://saraseed.app/api/owner/browser", "https://saraseed.app/api/executor/browser/start"]) assert.equal(browserRequestAllowed(url, "GET"), false, url);
  assert.equal(browserRequestAllowed("https://saraseed.app/", "POST"), false);
});

test("browser observer requires fresh manual or rollout execution on public main", () => {
  const env = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "BoneManTGRM/SARA", GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_RUN_ATTEMPT: "1", SARA_REPOSITORY_VISIBILITY: "public" };
  assert.equal(browserObserverAuthorized(env), true);
  assert.equal(browserObserverAuthorized({ ...env, GITHUB_EVENT_NAME: "push" }), true);
  for (const key of Object.keys(env)) assert.equal(browserObserverAuthorized({ ...env, [key]: "other" }), false, key);
});
