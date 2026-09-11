import assert from "node:assert/strict";
import { test } from "node:test";
import { createCloudflareFreeCandidateGenerator } from "../src/cloudflare-free-generator.ts";

const ACCOUNT_ID = "a".repeat(32);
const API_TOKEN = "qualification-token-that-must-stay-private";

const input = {
  objective: "Return the supplied value unchanged.",
  acceptanceCriteria: ["Return the supplied value unchanged."],
  missingCapabilities: ["server-error-regression"],
  constitutionDigest: "b".repeat(64),
  memoryContext: { contextDigest: "c".repeat(64), memories: [] },
};

for (const status of [500, 503]) {
  test(`Cloudflare HTTP ${status} fails once without leaking provider content or credentials`, async () => {
    let calls = 0;
    const privateProviderBody = `PRIVATE_PROVIDER_BODY_${status}`;
    const generator = createCloudflareFreeCandidateGenerator({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      workersPlan: "free",
      async fetcher() {
        calls += 1;
        return new Response(privateProviderBody, { status });
      },
    });

    await assert.rejects(
      () => generator.generate(input),
      (error: Error) => {
        assert.equal(calls, 1);
        assert.equal(error.message, `Cloudflare inference failed with HTTP ${status}.`);
        assert.doesNotMatch(error.message, new RegExp(API_TOKEN, "u"));
        assert.doesNotMatch(error.message, new RegExp(privateProviderBody, "u"));
        return true;
      },
    );
    assert.equal(calls, 1);
  });
}
