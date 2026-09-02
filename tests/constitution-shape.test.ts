import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  assertConstitutionShape,
  ConstitutionIntegrityError,
  defaultConstitutionPath,
  type SaraConstitution,
} from "../src/constitution.ts";

async function canonicalConstitution(): Promise<SaraConstitution> {
  return JSON.parse(await readFile(defaultConstitutionPath(), "utf8")) as SaraConstitution;
}

function rejectsWith(value: unknown, message: string): void {
  assert.throws(
    () => assertConstitutionShape(value),
    (error: unknown) => error instanceof ConstitutionIntegrityError && error.message === message,
  );
}

describe("Constitution shape validation", () => {
  it("accepts the canonical Constitution", async () => {
    const constitution = await canonicalConstitution();
    assert.doesNotThrow(() => assertConstitutionShape(constitution));
  });

  it("rejects malformed core, stewardship, and succession structures", async () => {
    const core = await canonicalConstitution();
    core.principles = undefined as unknown as string[];
    rejectsWith(core, "Constitution schema or version is unsupported.");

    const stewardship = await canonicalConstitution();
    stewardship.stewardship.financialSafety = "";
    rejectsWith(stewardship, "Constitution schema or version is unsupported.");

    const succession = await canonicalConstitution();
    succession.familySuccession.activationRequirements = [];
    rejectsWith(succession, "Constitution schema or version is unsupported.");
  });

  it("preserves each protected economic failure message", async () => {
    const ceiling = await canonicalConstitution();
    ceiling.ownerAuthority.ownerFundedRecurringMonthlyUsdMaximum = 301;
    rejectsWith(ceiling, "The protected owner-funded recurring ceiling must remain $300.");

    const bootstrap = await canonicalConstitution();
    bootstrap.ownerAuthority.unearnedExpansionBudgetUsd = 1;
    rejectsWith(bootstrap, "Bootstrap recurring target and unearned expansion budget must remain $0.");

    const distribution = await canonicalConstitution();
    distribution.ownerAuthority.defaultReinvestmentRate = 0.3;
    rejectsWith(distribution, "Protected distribution and reinvestment limits changed.");
  });
});
