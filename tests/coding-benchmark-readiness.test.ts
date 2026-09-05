import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { inspectCodingBenchmarkReadiness, assertCodingBenchmarkDispatch, CODING_BENCHMARK_CONTINUATION } from "../src/coding-benchmark-readiness.ts";
import { createBenchmarkAudit } from "../src/coding-benchmark-audit.ts";

const ownerToken = "offline-owner-token";
const environment = {
  OPENAI_API_KEY: "offline-provider-key", SARA_OWNER_TOKEN: ownerToken,
  SARA_OWNER_TOKEN_SHA256: sha256(ownerToken),
  RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
};

describe("coding benchmark readiness and unreconciled exposure", () => {
  it("reports the original hold without claiming it was billed or available", () => {
    const ready = inspectCodingBenchmarkReadiness({ environment, constitutionVerified: true, emergencyStopped: false });
    assert.equal(ready.ready, false);
    assert.equal(ready.unresolvedExposureUsd, 0.15);
    assert.equal(ready.availableAuthorizationUsd, 0);
    assert.equal(ready.confirmedChargeUsd, null);
    assert.equal(ready.benchmarkId, "41267154-ba42-496a-bb79-1656898ac716");
    assert.ok(ready.blockers.includes("UNRECONCILED_MODEL_EXPOSURE"));
    assert.ok(!JSON.stringify(ready).includes(ownerToken));
    assert.ok(!JSON.stringify(ready).includes(environment.OPENAI_API_KEY));
  });
  it("cannot renew the grant by changing an ID, source, or environment flag", () => {
    for (const benchmarkId of [CODING_BENCHMARK_CONTINUATION.benchmarkId, "11111111-1111-4111-8111-111111111111"]) {
      assert.throws(() => assertCodingBenchmarkDispatch({
        benchmarkId, environment: { ...environment, SARA_IGNORE_BENCHMARK_HOLD: "true" },
        constitutionVerified: true, emergencyStopped: false,
      }), /UNRECONCILED_MODEL_EXPOSURE|BENCHMARK_SCOPE_MISMATCH/);
    }
  });
  it("reports missing credentials, unverified Constitution and emergency stop independently", () => {
    const ready = inspectCodingBenchmarkReadiness({ environment: {}, constitutionVerified: false, emergencyStopped: true });
    for (const code of ["OWNER_AUTHENTICATION_UNAVAILABLE", "MODEL_CREDENTIAL_UNAVAILABLE", "SOURCE_IDENTITY_UNAVAILABLE", "CONSTITUTION_UNVERIFIED", "EMERGENCY_STOP", "UNRECONCILED_MODEL_EXPOSURE"]) assert.ok(ready.blockers.includes(code));
  });
});

describe("private, durable benchmark request audit", () => {
  async function fixture(run: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), "sara-benchmark-audit-test-"));
    try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
  }
  const body = { model: "gpt-5.6-luna", input: "bounded public fixture", max_output_tokens: 8000, reasoning: { effort: "medium" }, store: false };
  it("saves a conservative reservation before dispatch and saves provider identity/usage/output", async () => fixture(async directory => {
    let calls = 0;
    const audit = createBenchmarkAudit({ directory, method: "luna", beforeDispatch: async () => {}, fetchImpl: async (_url, init) => {
      calls++;
      assert.ok((await readdir(directory)).includes("luna-0001-reservation.json"));
      assert.ok(new Headers(init?.headers).get("authorization"));
      return Response.json({ id: "resp_fixture", model: "gpt-5.6-luna", status: "completed", usage: { input_tokens: 100, output_tokens: 20 }, output: [{ type: "message", content: [{ type: "output_text", text: "fixture output" }] }] }, { headers: { "x-request-id": "req_fixture" } });
    } });
    await audit.fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: "Bearer NEVER_SAVE_SECRET" }, body: JSON.stringify(body) });
    assert.equal(calls, 1);
    const reservation = JSON.parse(await readFile(join(directory, "luna-0001-reservation.json"), "utf8"));
    assert.equal(reservation.payload.maximumReservedUsd, 0.0156);
    const receiptText = await readFile(join(directory, "luna-0001-response.json"), "utf8");
    const receipt = JSON.parse(receiptText).payload;
    assert.equal(receipt.providerRequestId, "req_fixture");
    assert.equal(receipt.responseId, "resp_fixture");
    assert.equal(receipt.model, "gpt-5.6-luna");
    assert.equal(receipt.inputTokens, 100);
    assert.equal(receipt.billableOutputTokens, 20);
    assert.equal(receipt.estimatedCostUsd, 0.000044);
    assert.equal(receipt.outputText, "fixture output");
    assert.ok(!receiptText.includes("NEVER_SAVE_SECRET"));
  }));
  it("keeps reservation and failure evidence on network errors without retry", async () => fixture(async directory => {
    let calls = 0;
    const audit = createBenchmarkAudit({ directory, method: "luna", beforeDispatch: async () => {}, fetchImpl: async () => { calls++; throw new Error("private request detail"); } });
    await assert.rejects(audit.fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify(body) }));
    assert.equal(calls, 1);
    assert.ok((await readdir(directory)).includes("luna-0001-reservation.json"));
    const error = await readFile(join(directory, "luna-0001-error.json"), "utf8");
    assert.ok(!error.includes("private request detail"));
    assert.equal(JSON.parse(error).payload.estimatedCostUsd, null);
  }));
  it("rejects overlapping/replayed invocation before a second provider dispatch", async () => fixture(async directory => {
    let calls = 0;
    const options = { directory, method: "luna" as const, beforeDispatch: async () => {}, fetchImpl: async () => { calls++; return Response.json({ model: "gpt-5.6-luna", status: "completed", usage: { input_tokens: 100, output_tokens: 20 } }); } };
    const results = await Promise.allSettled([createBenchmarkAudit(options).fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify(body) }), createBenchmarkAudit(options).fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify(body) })]);
    assert.equal(calls, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 1);
  }));
  it("fails closed on emergency stop or evidence-write failure before dispatch", async () => fixture(async directory => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return Response.json({ model: "gpt-5.6-luna", status: "completed", usage: { input_tokens: 100, output_tokens: 20 } }); };
    const stopped = createBenchmarkAudit({ directory, method: "luna", beforeDispatch: async () => { throw new Error("EMERGENCY_STOP"); }, fetchImpl });
    await assert.rejects(stopped.fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify(body) }), /EMERGENCY_STOP/);
    const invalid = createBenchmarkAudit({ directory: "/dev/null/invalid", method: "luna", beforeDispatch: async () => {}, fetchImpl });
    await assert.rejects(invalid.fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify(body) }));
    assert.equal(calls, 0);
  }));
  it("never admits a fourth generation or changed model/reasoning/output ceiling", async () => fixture(async directory => {
    let calls = 0;
    const audit = createBenchmarkAudit({ directory, method: "luna", beforeDispatch: async () => {}, fetchImpl: async () => { calls++; return Response.json({ model: "gpt-5.6-luna", status: "completed", usage: { input_tokens: 100, output_tokens: 20 } }); } });
    for (let i = 0; i < 3; i++) await audit.fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify(body) });
    await assert.rejects(audit.fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify(body) }), /attempt|ceiling/i);
    for (const patch of [{ model: "other" }, { max_output_tokens: 8001 }, { reasoning: { effort: "high" } }]) {
      await assert.rejects(createBenchmarkAudit({ directory, method: "luna_reparodynamic", beforeDispatch: async () => {}, fetchImpl: async () => { calls++; return Response.json({ model: "gpt-5.6-luna", status: "completed", usage: { input_tokens: 100, output_tokens: 20 } }); } }).fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ ...body, ...patch }) }));
    }
    assert.equal(calls, 3);
  }));
  it("retains incomplete/refused output and usage without calling it success", async () => fixture(async directory => {
    const audit = createBenchmarkAudit({ directory, method: "luna", beforeDispatch: async () => {}, fetchImpl: async () => Response.json({ model: "gpt-5.6-luna", status: "incomplete", usage: { input_tokens: 12, output_tokens: 8000 }, output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot complete" }] }] }) });
    await audit.fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify(body) });
    const result = JSON.parse(await readFile(join(directory, "luna-0001-response.json"), "utf8")).payload;
    assert.equal(result.status, "incomplete");
    assert.equal(result.refused, true);
    assert.equal(result.billableOutputTokens, 8000);
  }));
});

import { codingBenchmarkLaunchSpec, persistentBenchmarkStateDirectory } from "../src/coding-benchmark-owner.ts";
import { assertCodingBenchmarkRuntimeAuthority } from "../src/coding-benchmark-readiness.ts";
describe("bounded existing-runner launch adapter", () => {
  it("does not forward unrelated production credentials, arbitrary Node flags or paid-run flags", () => {
    const spec = codingBenchmarkLaunchSpec({ sourceRevision: "a".repeat(40), stateDirectory: "/data/sara/coding-benchmark-lab", environment: { ...environment, PORT: "8080", SARA_STATE_DIRECTORY: "/data/sara", NODE_OPTIONS: "--require attacker", SARA_NICO_OPERATOR_PASSWORD: "unrelated", DATABASE_URL: "private", SARA_RUN_CODING_SPEED_BENCHMARK: "true" } });
    assert.equal(spec.environment.NODE_OPTIONS, undefined);
    assert.equal(spec.environment.SARA_NICO_OPERATOR_PASSWORD, undefined);
    assert.equal(spec.environment.DATABASE_URL, undefined);
    assert.equal(spec.environment.SARA_RUN_CODING_SPEED_BENCHMARK, undefined);
    assert.equal(spec.args[spec.args.indexOf("--max-spend-usd") + 1], "0.15");
    assert.equal(spec.args[spec.args.indexOf("--max-arm-spend-usd") + 1], "0.075");
    assert.ok(spec.args.includes("scripts/benchmark-matched-coding-evidence.ts"));
    assert.equal(spec.environment.SARA_OWNER_TOKEN, ownerToken);
  });
  it("rejects ephemeral/missing state rather than using a pre-deploy filesystem", async () => {
    await assert.rejects(persistentBenchmarkStateDirectory(undefined));
    await assert.rejects(persistentBenchmarkStateDirectory(".sara-state"));
    const path = await mkdtemp(join(tmpdir(), "sara-ephemeral-"));
    try { await assert.rejects(persistentBenchmarkStateDirectory(path)); } finally { await rm(path, { recursive: true, force: true }); }
  });
  it("checks a live kernel read instead of starting a competing production kernel", async () => {
    let requests = 0;
    await assert.rejects(assertCodingBenchmarkRuntimeAuthority({ benchmarkId: CODING_BENCHMARK_CONTINUATION.benchmarkId,
      environment: { ...environment, PORT: "8080" }, fetchImpl: async (url, options) => {
        requests++; assert.equal(url, "http://127.0.0.1:8080/health"); assert.equal(options?.method, "GET");
        assert.equal(options?.redirect, "error");
        return Response.json({ ok: true, constitutionVerified: true, emergencyStopped: true });
      },
    }), /EMERGENCY_STOP/);
    assert.equal(requests, 1);
  });
});

import { benchmarkSpendExposure } from "../src/coding-benchmark-audit.ts";
it("keeps failed-arm exposure reserved without charging it as a known cost", () => {
  assert.deepEqual(benchmarkSpendExposure([null, 0.01], 0.075), { knownEstimatedCostUsd: 0.01, accountedCostUsd: null, unresolvedReservedUsd: 0.075, totalExposureUsd: 0.085 });
  assert.equal(benchmarkSpendExposure([null, null], 0.075).totalExposureUsd, 0.15);
  assert.equal(benchmarkSpendExposure([0.01, 0.02], 0.075).accountedCostUsd, 0.03);
  assert.throws(() => benchmarkSpendExposure([0.076], 0.075));
  assert.throws(() => benchmarkSpendExposure([0, 0, 0], 0.075));
});
