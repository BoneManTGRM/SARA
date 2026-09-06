import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateTelegramNicoProductionAuthorization,
  TELEGRAM_NICO_MANDATE_APPROVAL,
} from "../src/telegram-nico-production.ts";

describe("Telegram NICO production authorization", () => {
  it("fails closed without the exact owner mandate", () => {
    assert.equal(evaluateTelegramNicoProductionAuthorization({
      status: { emergencyStop: { active: false } },
      mandateApproval: "wrong",
    }).code, "TELEGRAM_NICO_MANDATE_INACTIVE");
  });

  it("preserves owner revocation", () => {
    assert.equal(evaluateTelegramNicoProductionAuthorization({
      status: { emergencyStop: { active: false } },
      mandateApproval: TELEGRAM_NICO_MANDATE_APPROVAL,
      revoked: "true",
    }).code, "TELEGRAM_NICO_OWNER_REVOKED");
  });

  it("blocks an active or unverifiable emergency stop", () => {
    assert.equal(evaluateTelegramNicoProductionAuthorization({
      status: { emergencyStop: { active: true } },
      mandateApproval: TELEGRAM_NICO_MANDATE_APPROVAL,
    }).allowed, false);
    assert.equal(evaluateTelegramNicoProductionAuthorization({
      status: { unrelated: true },
      mandateApproval: TELEGRAM_NICO_MANDATE_APPROVAL,
    }).allowed, false);
  });

  it("allows only the exact mandate plus explicit inactive emergency-stop evidence", () => {
    assert.deepEqual(evaluateTelegramNicoProductionAuthorization({
      status: { kernel: { emergency_stop: false } },
      mandateApproval: TELEGRAM_NICO_MANDATE_APPROVAL,
    }), {
      allowed: true,
      code: "TELEGRAM_NICO_OWNER_AUTHORIZED",
      reason: "Exact bounded owner mandate and inactive emergency stop verified.",
    });
  });
});
