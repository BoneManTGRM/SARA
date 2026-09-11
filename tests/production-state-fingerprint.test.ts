import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { compileLearningCampaign } from "../src/learning-campaign.ts";
import { readProductionStateFingerprint } from "../src/production-state-fingerprint.ts";
import { EventStoreIntegrityError, type StoredEvent } from "../src/store.ts";

const actor = { id: "sara", kind: "sara" as const, authenticated: true };

function appendEvent(events: StoredEvent[], type: string, data: unknown): void {
  const previousHash = events.at(-1)?.hash ?? "0".repeat(64);
  const sequence = events.length + 1;
  const event = {
    id: `event-${sequence}`,
    sequence,
    occurredAt: `2026-09-11T12:${String(sequence).padStart(2, "0")}:00.000Z`,
    type,
    actor,
    data,
    previousHash,
  };
  events.push({ ...event, hash: sha256(canonicalJson(event)) });
}

async function writeEvents(directory: string, events: StoredEvent[]): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "events.ndjson"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

test("production fingerprint verifies the hash chain and projects non-secret state identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-state-fingerprint-"));
  try {
    const campaign = compileLearningCampaign({
      id: "qualification-state-v1",
      maximumRequests: 100,
      contracts: [{
        capabilityId: "bounded-state-check",
        objective: "Return one deterministic state classification.",
        publicCriteria: ["Return a deterministic classification."],
        acceptanceTests: [
          { name: "one", input: { value: 1 }, expected: "one" },
          { name: "two", input: { value: 2 }, expected: "two" },
        ],
        estimatedEffort: 1,
      }],
    });
    const events: StoredEvent[] = [];
    appendEvent(events, "system_booted", {
      constitutionVersion: 1,
      constitutionDigest: "a".repeat(64),
      ownerTokenSha256: "OWNER_AUTH_SECRET_SHOULD_NOT_APPEAR",
    });
    appendEvent(events, "core_memory_seeded", { memories: [{ id: "one" }, { id: "two" }] });
    appendEvent(events, "learning_campaign_configured", campaign);
    appendEvent(events, "autonomous_learning_reserved", {
      jobId: "job-1",
      campaignId: campaign.id,
      contractDigest: "b".repeat(64),
    });
    appendEvent(events, "standing_mandate_snapshot", {
      id: "internal-learning-test",
      digest: "c".repeat(64),
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    appendEvent(events, "mutation_created", {
      id: "candidate-1",
      jobId: "job-1",
      candidateDigest: "d".repeat(64),
      stage: "SANDBOX",
    });
    appendEvent(events, "mutation_stage_changed", {
      mutationId: "candidate-1",
      from: "SANDBOX",
      stage: "SHADOW",
      approval: null,
    });
    appendEvent(events, "learning_qualification_failed", { mutationId: "candidate-1" });
    await writeEvents(directory, events);

    const fingerprint = await readProductionStateFingerprint(directory);
    assert.equal(fingerprint.constitution.version, 1);
    assert.equal(fingerprint.constitution.digest, "a".repeat(64));
    assert.equal(fingerprint.audit.eventCount, 8);
    assert.equal(fingerprint.audit.headHash, events.at(-1)!.hash);
    assert.equal(fingerprint.campaign?.id, campaign.id);
    assert.equal(fingerprint.campaign?.maximumRequests, 100);
    assert.equal(fingerprint.campaign?.reserved, 1);
    assert.equal(fingerprint.campaign?.remaining, 99);
    assert.equal(fingerprint.mandate?.id, "internal-learning-test");
    assert.equal(fingerprint.memoryCount, 2);
    assert.equal(fingerprint.reservations, 1);
    assert.deepEqual(fingerprint.qualifications, { passed: 0, failed: 1 });
    assert.equal(fingerprint.mutations.total, 1);
    assert.equal(fingerprint.mutations.byStage.SHADOW, 1);
    assert.equal(fingerprint.mutations.recent[0]?.candidateDigest, "d".repeat(64));
    assert.match(fingerprint.fingerprintDigest, /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify(fingerprint), /OWNER_AUTH_SECRET_SHOULD_NOT_APPEAR/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production fingerprint fails closed when persisted history is tampered", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-state-fingerprint-tamper-"));
  try {
    const events: StoredEvent[] = [];
    appendEvent(events, "system_booted", {
      constitutionVersion: 1,
      constitutionDigest: "a".repeat(64),
    });
    appendEvent(events, "memory_recorded", { id: "original" });
    events[1] = { ...events[1]!, data: { id: "tampered" } };
    await writeEvents(directory, events);
    await assert.rejects(
      () => readProductionStateFingerprint(directory),
      (error: unknown) => error instanceof EventStoreIntegrityError && /audit hash check/u.test(error.message),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production fingerprint represents an uninitialized state directory without creating state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-state-fingerprint-empty-"));
  try {
    const fingerprint = await readProductionStateFingerprint(join(directory, "not-created"));
    assert.equal(fingerprint.audit.eventCount, 0);
    assert.equal(fingerprint.audit.headHash, null);
    assert.equal(fingerprint.campaign, null);
    assert.equal(fingerprint.mutations.total, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
