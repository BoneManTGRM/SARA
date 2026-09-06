import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { TelegramNicoDeliveryOperator } from "../src/telegram-nico-delivery.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Telegram NICO delivery operator", () => {
  it("rejects an unpaired Telegram identity before any external action", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "sara-telegram-nico-"));
    temporaryDirectories.push(stateDirectory);
    let externalCalls = 0;
    const operator = new TelegramNicoDeliveryOperator({
      stateDirectory,
      expectedTelegramUserIdSha256: createHash("sha256").update("paired-owner").digest("hex"),
      nicoOperator: {
        createRun: async () => { externalCalls += 1; return {}; },
        getRun: async () => { externalCalls += 1; return {}; },
        continueRun: async () => { externalCalls += 1; return {}; },
        getReport: async () => { externalCalls += 1; return { contentType: "application/pdf", body: new Uint8Array() }; },
        getReviewQueue: async () => { externalCalls += 1; return {}; },
        finalizeExactDraft: async () => { externalCalls += 1; return {}; },
        authorizeDelivery: async () => { externalCalls += 1; return {}; },
        getApprovedDeliveryPackage: async () => { externalCalls += 1; return { contentType: "application/pdf", body: new Uint8Array(), digest: null }; },
        getAutomatedDeliveryPackage: async () => { externalCalls += 1; return { contentType: "application/pdf", body: new Uint8Array(), digest: null }; },
      },
      targetVerifier: { verify: async () => { externalCalls += 1; return { repository: "sindresorhus/p-map", repositoryUrl: "https://github.com/sindresorhus/p-map", commitSha: "22dda61ea29037ba85af25e84bc5efba77e62f44" }; } },
      authorize: async () => ({ allowed: true, code: "TEST", reason: "test" }),
    });

    await assert.rejects(() => operator.submit({
      requestId: "request-00000001",
      telegramUserId: "unpaired-user",
      action: "nico_assessment_start",
      repository: "https://github.com/sindresorhus/p-map",
      commitSha: "22dda61ea29037ba85af25e84bc5efba77e62f44",
      emailVerifiedReport: true,
    }), /paired Telegram identity/);
    assert.equal(externalCalls, 0);
  });
});
