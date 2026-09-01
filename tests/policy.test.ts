import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConstitution } from "../src/constitution.ts";
import { evaluatePolicy } from "../src/policy.ts";
import type { ActionRequest, Principal } from "../src/types.ts";

const sara: Principal = { id: "sara", kind: "sara", authenticated: true };
const owner: Principal = { id: "OWNER", kind: "owner", authenticated: true };

describe("SARA family, identity, and financial safety policy", () => {
  it("never permits impersonation or tax evasion, including for the owner", async () => {
    const { constitution } = await loadConstitution();
    for (const action of ["human_impersonation", "tax_evasion"] as const) {
      const decision = evaluatePolicy({
        constitution,
        principal: owner,
        request: { action, targetId: "prohibited", external: true },
        currentOwnerRecurringMonthlyUsd: 0,
        emergencyStopped: false,
      });
      assert.equal(decision.allowed, false);
      assert.equal(decision.code, "PROHIBITED_HARMFUL_ACTION");
    }
  });

  it("never permits legally prohibited activity, even with owner approval", async () => {
    const { constitution } = await loadConstitution();
    const targetId = "prohibited-action";
    const decision = evaluatePolicy({
      constitution,
      principal: owner,
      request: {
        action: "legally_prohibited_activity",
        targetId,
        external: true,
        approval: {
          approvalId: "approval-prohibited",
          action: "legally_prohibited_activity",
          targetId,
          approvedAt: "2026-09-01T00:00:00.000Z",
          ownerId: owner.id,
        },
      },
      currentOwnerRecurringMonthlyUsd: 0,
      emergencyStopped: false,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "PROHIBITED_HARMFUL_ACTION");
  });

  it("keeps financial accounts and transfers behind target-bound owner approval", async () => {
    const { constitution } = await loadConstitution();
    for (const action of ["financial_account_creation", "money_transfer", "beneficiary_change"] as const) {
      const request: ActionRequest = { action, targetId: `${action}:specific-target`, external: true };
      const denied = evaluatePolicy({
        constitution,
        principal: sara,
        request,
        currentOwnerRecurringMonthlyUsd: 0,
        emergencyStopped: false,
      });
      assert.equal(denied.allowed, false);
      assert.equal(denied.code, "OWNER_REQUIRED");

      const approved = evaluatePolicy({
        constitution,
        principal: owner,
        request: {
          ...request,
          approval: {
            approvalId: `approval-${action}`,
            action,
            targetId: request.targetId,
            approvedAt: "2026-09-01T00:00:00.000Z",
            ownerId: owner.id,
          },
        },
        currentOwnerRecurringMonthlyUsd: 0,
        emergencyStopped: false,
      });
      assert.equal(approved.allowed, true);
    }
  });

  it("recognizes only the exact authenticated constitutional owner", async () => {
    const { constitution } = await loadConstitution();
    for (const impostor of [
      { id: "not-the-owner", kind: "owner", authenticated: true },
      { id: "OWNER", kind: "owner", authenticated: false },
    ] as Principal[]) {
      const decision = evaluatePolicy({
        constitution,
        principal: impostor,
        request: {
          action: "money_transfer",
          targetId: "transfer:probe",
          external: true,
          approval: {
            approvalId: `approval-${impostor.id}-${impostor.authenticated}`,
            action: "money_transfer",
            targetId: "transfer:probe",
            approvedAt: "2026-09-01T00:00:00.000Z",
            ownerId: impostor.id,
          },
        },
        currentOwnerRecurringMonthlyUsd: 0,
        emergencyStopped: false,
      });
      assert.equal(decision.allowed, false);
      assert.equal(decision.code, "OWNER_REQUIRED");
    }
  });

  it("freezes even owner-approved financial actions during emergency stop", async () => {
    const { constitution } = await loadConstitution();
    const action = "money_transfer" as const;
    const targetId = "transfer:specific-target";
    const decision = evaluatePolicy({
      constitution,
      principal: owner,
      request: {
        action,
        targetId,
        external: false,
        approval: {
          approvalId: "approval-transfer-during-stop",
          action,
          targetId,
          approvedAt: "2026-09-01T00:00:00.000Z",
          ownerId: owner.id,
        },
      },
      currentOwnerRecurringMonthlyUsd: 0,
      emergencyStopped: true,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "EMERGENCY_STOP");
  });
});
