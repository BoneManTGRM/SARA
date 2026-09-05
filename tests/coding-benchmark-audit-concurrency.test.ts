import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { createBenchmarkAudit } from "../src/coding-benchmark-audit.ts";

const url = "https://api.openai.com/v1/responses";
const body = JSON.stringify({ model: "gpt-5.6-luna", input: "bounded offline fixture", max_output_tokens: 8000, reasoning: { effort: "medium" }, store: false });
const response = () => Response.json({ model: "gpt-5.6-luna", status: "completed", usage: { input_tokens: 10, output_tokens: 5 } });

for (const endpoint of [url, `${url}/input_tokens`]) {
  it(`same-instance overlap cannot exceed one admitted dispatch: ${endpoint}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "sara-audit-overlap-"));
    try {
      let release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      let calls = 0;
      const audit = createBenchmarkAudit({ directory, method: "luna", beforeDispatch: () => barrier,
        fetchImpl: async () => { calls++; return response(); } });
      const pending = Array.from({ length: 4 }, () => audit.fetch(endpoint, { method: "POST", body }));
      const completed = Promise.allSettled(pending);
      release();
      const results = await completed;
      assert.equal(calls, 1);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(results.filter(result => result.status === "rejected").length, 3);
      // Reject overlap rather than queue it, but retain three sequential attempts.
      await audit.fetch(endpoint, { method: "POST", body });
      await audit.fetch(endpoint, { method: "POST", body });
      await assert.rejects(audit.fetch(endpoint, { method: "POST", body }), /ceiling/i);
      assert.equal(calls, 3);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

it("snapshots the validated URL, request body and headers before asynchronous admission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-audit-snapshot-"));
  try {
    const resource = new URL(url);
    const headers = new Headers({ authorization: "Bearer original-offline-value" });
    const init: RequestInit = { method: "POST", body, headers };
    let callbacks = 0;
    let providerCalls = 0;
    const audit = createBenchmarkAudit({ directory, method: "luna", beforeDispatch: async () => {
      if (++callbacks !== 1) return;
      resource.pathname = "/v1/forbidden";
      init.body = JSON.stringify({ model: "other", input: "mutated", max_output_tokens: 50000 });
      init.method = "DELETE";
      headers.set("authorization", "Bearer mutated-offline-value");
    }, fetchImpl: async (actualUrl, actualInit) => {
      providerCalls++;
      assert.equal(String(actualUrl), url);
      assert.equal(actualInit?.method, "POST");
      assert.equal(actualInit?.body, body);
      assert.equal(new Headers(actualInit?.headers).get("authorization"), "Bearer original-offline-value");
      return response();
    } });
    await audit.fetch(resource, init);
    assert.equal(providerCalls, 1);
    const reservation = JSON.parse(await readFile(join(directory, "luna-0001-reservation.json"), "utf8"));
    assert.equal(reservation.payload.requestDigest, sha256(body));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
