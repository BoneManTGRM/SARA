import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";

const cleanup: string[] = [];
const OWNER_TOKEN_DIGEST = createHash("sha256").update("memory-fabric-owner-token").digest("hex");

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sara-memory-fabric-"));
  cleanup.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SARA durable memory fabric", () => {
  // Production defect caught: a restarted SARA loses her mission anchors or cannot retrieve
  // the economic rules needed to evaluate work.
  it("seeds 42 durable anchors and Reparodynamics doctrine once, then recalls them after restart", async () => {
    const directory = await stateDirectory();
    const first = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: OWNER_TOKEN_DIGEST });
    assert.equal((await first.getStatus()).memoryCount, 42);
    assert.equal((await first.getStatus()).learning.doctrineMemoryCount, 6);

    const firstRecall = await first.recallMemory({
      query: "customer revenue realized profit reinvestment owner distribution",
      scope: "global",
      limit: 8,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    assert.ok(firstRecall.anchors.some((memory) => memory.statement.includes("Preserve the Constitution")));
    assert.ok(firstRecall.relevant.some((memory) => memory.statement.includes("realized distributable profit")));
    assert.match(firstRecall.contextDigest, /^[a-f0-9]{64}$/);

    const restarted = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: OWNER_TOKEN_DIGEST });
    assert.equal((await restarted.getStatus()).memoryCount, 42);
    const restartedRecall = await restarted.recallMemory({
      query: "customer revenue realized profit reinvestment owner distribution",
      scope: "global",
      limit: 8,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    assert.equal(restartedRecall.contextDigest, firstRecall.contextDigest);
    assert.deepEqual(
      restartedRecall.relevant.map((memory) => memory.id),
      firstRecall.relevant.map((memory) => memory.id),
    );
    assert.equal(
      (await restarted.inspectAudit()).filter((event) => event.type === "core_memory_seeded").length,
      1,
    );
    assert.equal(
      (await restarted.inspectAudit()).filter((event) => event.type === "reparodynamics_memory_seeded").length,
      1,
    );
  });

  it("writes an identical verified lesson once across replay and restart", async () => {
    const directory = await stateDirectory();
    const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: OWNER_TOKEN_DIGEST });
    const lesson = {
      category: "repair" as const,
      statement: "A measured repair passed its independent deterministic gate.",
      source: "sara://learning/example/cycle",
      observedAt: "2026-09-03T00:00:00.000Z",
      confidence: 1,
      verification: "measured" as const,
      scope: "service.example",
      dependencies: ["a".repeat(64)],
      lastValidatedAt: "2026-09-03T00:00:00.000Z",
      importance: 3 as const,
      tags: ["verified-outcome"],
      status: "active" as const,
      supersedes: [],
    };
    const first = await kernel.recordMemoryOnce(SARA_PRINCIPAL, lesson);
    const replay = await kernel.recordMemoryOnce(SARA_PRINCIPAL, lesson);
    assert.equal(replay.id, first.id);
    assert.equal((await kernel.getStatus()).learning.verifiedOutcomeCount, 1);

    const restarted = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: OWNER_TOKEN_DIGEST });
    const afterRestart = await restarted.recordMemoryOnce(SARA_PRINCIPAL, lesson);
    assert.equal(afterRestart.id, first.id);
    assert.equal((await restarted.getStatus()).learning.verifiedOutcomeCount, 1);
  });

  it("applies the Reparodynamics migration once across simultaneous pristine boots", async () => {
    const directory = await stateDirectory();
    const kernels = await Promise.all(Array.from({ length: 3 }, () =>
      SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: OWNER_TOKEN_DIGEST })
    ));
    assert.ok(kernels.every((kernel) => kernel.constitutionDigest === kernels[0].constitutionDigest));
    const events = await kernels[0].inspectAudit();
    assert.equal(events.filter((event) => event.type === "reparodynamics_memory_seeded").length, 1);
    assert.equal((await kernels[0].getStatus()).learning.doctrineMemoryCount, 6);
  });

  // Production defects caught: one customer's memory leaks into another customer's context;
  // stale or explicitly superseded claims continue steering SARA.
  it("isolates customer scopes and excludes stale and superseded memories", async () => {
    const kernel = await SaraKernel.boot({
      stateDirectory: await stateDirectory(),
      ownerTokenSha256: OWNER_TOKEN_DIGEST,
    });
    const base = {
      category: "customer" as const,
      source: "owner-authorized-customer-intake",
      observedAt: "2026-08-01T00:00:00.000Z",
      confidence: 1,
      verification: "measured" as const,
      dependencies: [],
      lastValidatedAt: "2026-08-01T00:00:00.000Z",
      importance: 4 as const,
      status: "active" as const,
      tags: ["release", "deadline"],
    };
    const alphaOld = await kernel.recordMemory(SARA_PRINCIPAL, {
      ...base,
      statement: "Alpha release deadline is Friday.",
      scope: "customer:alpha",
    });
    await kernel.recordMemory(SARA_PRINCIPAL, {
      ...base,
      statement: "Beta release deadline is Monday.",
      scope: "customer:beta",
    });
    await kernel.recordMemory(SARA_PRINCIPAL, {
      ...base,
      statement: "Alpha release deadline is Tuesday.",
      scope: "customer:alpha",
      supersedes: [alphaOld.id],
    });
    await kernel.recordMemory(SARA_PRINCIPAL, {
      ...base,
      statement: "Alpha uses a temporary API price that has expired.",
      scope: "customer:alpha",
      revalidateAfter: "2026-08-15T00:00:00.000Z",
    });

    const recalled = await kernel.recallMemory({
      query: "release deadline API price",
      scope: "customer:alpha",
      limit: 10,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    const statements = [...recalled.anchors, ...recalled.relevant].map((memory) => memory.statement);
    assert.ok(statements.includes("Alpha release deadline is Tuesday."));
    assert.ok(!statements.includes("Alpha release deadline is Friday."));
    assert.ok(!statements.some((statement) => statement.includes("Beta release")));
    assert.ok(!statements.some((statement) => statement.includes("temporary API price")));
    assert.equal(recalled.supersededExcluded, 1);
    assert.equal(recalled.staleExcluded, 1);
  });

  // Production defect caught: an invalid retrieval request silently returns an unbounded or
  // cross-scope memory dump.
  it("rejects blank queries, unsafe scopes, and unbounded limits", async () => {
    const kernel = await SaraKernel.boot({
      stateDirectory: await stateDirectory(),
      ownerTokenSha256: OWNER_TOKEN_DIGEST,
    });
    await assert.rejects(() => kernel.recallMemory({ query: "", scope: "global" }), /query is required/i);
    await assert.rejects(
      () => kernel.recallMemory({ query: "profit", scope: "customer:alpha/../beta" }),
      /scope/i,
    );
    await assert.rejects(
      () => kernel.recallMemory({ query: "profit", scope: "global", limit: 51 }),
      /between 1 and 50/i,
    );
  });
});
