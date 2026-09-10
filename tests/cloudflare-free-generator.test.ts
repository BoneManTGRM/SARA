import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLOUDFLARE_FREE_MODEL,
  createCloudflareFreeCandidateGenerator,
  cloudflareQualificationReasoningEffort,
  cloudflareQualificationThinkingMode,
} from "../src/cloudflare-free-generator.ts";

const ACCOUNT_ID = "a".repeat(32);
const API_TOKEN = "test-token-that-is-long-enough";

function input() {
  return {
    objective: "Create a deterministic opportunity scorer.",
    acceptanceCriteria: ["Return a structured score."],
    missingCapabilities: ["opportunity-scoring"],
    constitutionDigest: "b".repeat(64),
    memoryContext: { contextDigest: "c".repeat(64), memories: [] },
  };
}

function candidate() {
  return {
    schemaVersion: 1 as const,
    skillName: "Opportunity Scorer",
    summary: "Scores a bounded opportunity record.",
    source: "export function runSkill(input: unknown): unknown { return input; }\n",
    tests: [{ name: "identity", input: { value: 1 }, expected: { value: 1 } }],
    limitations: ["Bounded test candidate."],
  };
}

describe("Cloudflare free candidate generator", () => {
  it("rejects unsupported thinking settings before dispatch without exposing their value", () => {
    assert.equal(cloudflareQualificationThinkingMode("current"), undefined);
    assert.equal(cloudflareQualificationThinkingMode(undefined), undefined);
    for (const invalid of ["", "enabled", "PRIVATE", false, null, {enable_thinking:false}]) {
      assert.throws(() => createCloudflareFreeCandidateGenerator({
        accountId: ACCOUNT_ID, apiToken: API_TOKEN, workersPlan: "free",
        thinkingMode: invalid as "disabled",
        async fetcher() { assert.fail("Invalid configuration must not dispatch"); },
      }), error => {
        assert.equal((error as Error).message, "Cloudflare qualification thinking mode must be current or disabled.");
        return true;
      });
    }
  });

  it("stops without fallback when disabled thinking is unsupported or still returns no content", async () => {
    for (const response of [
      new Response("PRIVATE provider error", {status:400}),
      Response.json({choices:[{finish_reason:"length", message:{reasoning_content:"PRIVATE"}}],
        usage:{prompt_tokens:605, completion_tokens:8192}}),
    ]) {
      let calls = 0;
      const generator = createCloudflareFreeCandidateGenerator({
        accountId: ACCOUNT_ID, apiToken: API_TOKEN, workersPlan: "free",
        reasoningEffort: "low", thinkingMode: "disabled",
        async fetcher() { calls += 1; return response; },
      });
      await assert.rejects(() => generator.generate(input()), (error: Error) => {
        assert.match(error.message, /HTTP 400|no candidate content.*completion_tokens=8192/);
        assert.doesNotMatch(error.message, /PRIVATE/);
        return true;
      });
      assert.equal(calls, 1);
    }
  });

  it("rejects unsupported reasoning settings before dispatch without exposing their value", () => {
    assert.equal(cloudflareQualificationReasoningEffort("current"), undefined);
    assert.equal(cloudflareQualificationReasoningEffort(undefined), undefined);
    for (const invalid of ["", "high", "PRIVATE", 1, null]) {
      assert.throws(() => createCloudflareFreeCandidateGenerator({
        accountId: ACCOUNT_ID, apiToken: API_TOKEN, workersPlan: "free",
        reasoningEffort: invalid as "low",
        async fetcher() { assert.fail("Invalid configuration must not dispatch"); },
      }), error => {
        assert.equal((error as Error).message, "Cloudflare qualification reasoning effort must be current or low.");
        return true;
      });
    }
  });
  it("changes only reasoning effort when explicitly selected under the same request ceiling", async () => {
    const requests: Record<string, unknown>[] = [];
    for (const reasoningEffort of [undefined, "low"] as const) {
      const generator = createCloudflareFreeCandidateGenerator({
        accountId: ACCOUNT_ID, apiToken: API_TOKEN, workersPlan: "free", ...{reasoningEffort},
        async fetcher(_url, init) {
          requests.push(JSON.parse(String(init?.body)));
          return Response.json({choices:[{message:{content:JSON.stringify(candidate())}}]});
        },
      });
      await generator.generate(input());
    }
    assert.equal(requests.length, 2);
    assert.equal(requests[0].reasoning_effort, undefined);
    const {reasoning_effort, ...otherwiseIdentical} = requests[1];
    assert.equal(reasoning_effort, "low");
    assert.deepEqual(otherwiseIdentical, requests[0]);
    assert.equal(requests[1].max_completion_tokens, 2048);
    assert.equal(requests[1].model, CLOUDFLARE_FREE_MODEL);
  });

  it("changes only the thinking template when selected, including on a repair request", async () => {
    for (const reasoningEffort of [undefined, "low"] as const) {
      for (const repairProposal of [undefined, candidate()]) {
        const requests: Record<string, unknown>[] = [];
        for (const thinkingMode of [undefined, "disabled"] as const) {
          const generator = createCloudflareFreeCandidateGenerator({
            accountId: ACCOUNT_ID, apiToken: API_TOKEN, workersPlan: "free",
            reasoningEffort, repairProposal, ...{thinkingMode},
            async fetcher(_url, init) {
              requests.push(JSON.parse(String(init?.body)));
              return Response.json({choices:[{message:{content:JSON.stringify(candidate())}}]});
            },
          });
          assert.deepEqual(await generator.generate(input()), candidate());
        }
        assert.equal(requests.length, 2);
        assert.equal(requests[0].chat_template_kwargs, undefined);
        const {chat_template_kwargs, ...otherwiseIdentical} = requests[1];
        assert.deepEqual(chat_template_kwargs, {enable_thinking:false});
        assert.deepEqual(otherwiseIdentical, requests[0]);
        assert.equal(requests[1].max_completion_tokens, 2048);
        assert.equal(requests[1].model, CLOUDFLARE_FREE_MODEL);
      }
    }
  });

  it("uses one fixed-model request and returns one JSON proposal", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const generator = createCloudflareFreeCandidateGenerator({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      workersPlan: "free",
      async fetcher(url, init) {
        calls.push({ url: String(url), init });
        return Response.json({ choices: [{ message: { content: JSON.stringify(candidate()) } }] });
      },
    });

    assert.deepEqual(await generator.generate(input()), candidate());
    assert.equal(generator.external, true);
    assert.equal(generator.maximumCostUsd, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/v1/chat/completions`);
    assert.equal((calls[0].init?.headers as Record<string, string>).authorization, `Bearer ${API_TOKEN}`);
    const request = JSON.parse(String(calls[0].init?.body)) as {
      max_completion_tokens: number;
      messages: unknown[];
      model: string;
      stream: boolean;
    };
    assert.equal(request.model, CLOUDFLARE_FREE_MODEL);
    assert.equal(request.stream, false);
    assert.equal(request.messages.length, 2);
    assert.equal(request.max_completion_tokens, 2_048);
  });

  it("extracts one complete proposal from bounded model commentary", async () => {
    const generator = createCloudflareFreeCandidateGenerator({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      workersPlan: "free",
      async fetcher() {
        const content = `I verified the candidate.\n\`\`\`json\n${JSON.stringify(candidate())}\n\`\`\`\nComplete.`;
        return Response.json({ choices: [{ message: { content } }] });
      },
    });

    assert.deepEqual(await generator.generate(input()), candidate());
  });

  it("rejects any plan other than free before inference", () => {
    assert.throws(
      () => createCloudflareFreeCandidateGenerator({
        accountId: ACCOUNT_ID,
        apiToken: API_TOKEN,
        workersPlan: "paid",
      }),
      /locked to the Workers Free plan/,
    );
  });

  it("does not retry or disclose the token when Cloudflare rejects the request", async () => {
    let calls = 0;
    const generator = createCloudflareFreeCandidateGenerator({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      workersPlan: "free",
      async fetcher() {
        calls += 1;
        return new Response('{"errors":[{"message":"quota"}]}', { status: 429 });
      },
    });
    await assert.rejects(
      () => generator.generate(input()),
      (error: Error) => {
        assert.equal(calls, 1);
        assert.equal(error.message.includes(API_TOKEN), false);
        assert.match(error.message, /HTTP 429/);
        return true;
      },
    );
  });

  it("rejects malformed and oversized model output", async () => {
    const malformed = createCloudflareFreeCandidateGenerator({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      workersPlan: "free",
      async fetcher() {
        return Response.json({ choices: [{ message: { content: "not-json" } }] });
      },
    });
    await assert.rejects(() => malformed.generate(input()), /not valid JSON/);

    const ambiguous = createCloudflareFreeCandidateGenerator({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      workersPlan: "free",
      async fetcher() {
        return Response.json({
          choices: [{ message: { content: `${JSON.stringify(candidate())}\n${JSON.stringify(candidate())}` } }],
        });
      },
    });
    await assert.rejects(() => ambiguous.generate(input()), /ambiguous/);

    const truncated = createCloudflareFreeCandidateGenerator({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      workersPlan: "free",
      async fetcher() {
        return Response.json({ choices: [{ message: { content: '{"schemaVersion":1' } }] });
      },
    });
    await assert.rejects(() => truncated.generate(input()), /not valid JSON/);

    const oversized = createCloudflareFreeCandidateGenerator({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      workersPlan: "free",
      async fetcher() {
        return new Response("x".repeat(128 * 1024 + 1));
      },
    });
    await assert.rejects(() => oversized.generate(input()), /bounded envelope/);
  });

  it("provides the rejected proposal only to one explicitly configured repair request", async () => {
    const previous = candidate();
    let requestBody = "";
    const generator = createCloudflareFreeCandidateGenerator({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      workersPlan: "free",
      repairProposal: previous,
      repairFeedback: 'Behavioral verification mismatches: [{"name":"strong","expected":"{\\"score\\":90}","actual":"{\\"score\\":85}"}]',
      async fetcher(_url, init) {
        requestBody = String(init?.body);
        return Response.json({ choices: [{ message: { content: JSON.stringify(candidate()) } }] });
      },
    });
    await generator.generate(input());
    const request = JSON.parse(requestBody) as { messages: Array<{ content: string }> };
    assert.match(request.messages[1].content, /Previous rejected candidate \(bounded repair context\):/);
    assert.match(request.messages[1].content, /Opportunity Scorer/);
    assert.match(request.messages[1].content, /Measured repair directive:/);
    assert.match(request.messages[1].content, /actual.*score.*85/);
  });
});
