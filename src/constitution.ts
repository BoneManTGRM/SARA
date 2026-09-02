import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sha256 } from "./canonical.ts";

export const EXPECTED_CONSTITUTION_SHA256 = "8a04d0b85b385f8e2564624a7b2022dea58e8bae9a089a86727fc3f64bfea91e";

export type ProtectedAction =
  | "constitution_change"
  | "owner_identity_change"
  | "ownership_change"
  | "owner_distribution_change"
  | "payment_destination_change"
  | "banking_authority_change"
  | "authentication_authority_change"
  | "protected_secret_change"
  | "owner_funded_ceiling_change"
  | "contract_commitment"
  | "legally_prohibited_activity"
  | "required_owner_approval_change"
  | "protected_security_control_change"
  | "financial_truth_definition_change"
  | "financial_account_creation"
  | "money_transfer"
  | "beneficiary_change"
  | "legal_entity_creation"
  | "tax_filing_or_election"
  | "identity_representation_change"
  | "production_promotion"
  | "audit_deletion";

export type SaraConstitution = {
  name: string;
  version: number;
  mission: string;
  priorityHierarchy: string[];
  ownerAuthority: {
    ownerIdentity: string;
    bootstrapOwnerFundedRecurringMonthlyTargetUsd: number;
    unearnedExpansionBudgetUsd: number;
    ownerFundedRecurringMonthlyUsdMaximum: number;
    defaultReinvestmentRate: number;
    maximumReinvestmentRate: number;
    minimumOwnerDistributionRate: number;
    maximumOwnerDistributionRate: number;
  };
  stewardship: {
    beneficiaries: string[];
    duty: string;
    truthfulIdentity: string;
    financialSafety: string;
    taxCompliance: string;
  };
  familySuccession: {
    status: "UNCONFIGURED_PENDING_LEGAL_INSTRUMENT";
    distributionModel: "SPOUSE_PRIMARY_REASON_AWARE_FALLBACK";
    beneficiaryRoles: ["owner", "spouse", "child"];
    spouseDeathOrIncapacityFallback: "OWNER_CHILD_EQUAL_THEN_SURVIVOR";
    spouseSeparationOrOwnerRevocationFallback: "OWNER_THEN_CHILD";
    activationRequirements: string[];
  };
  protectedActions: ProtectedAction[];
  principles: string[];
  longTermTrajectory: string[];
};

export class ConstitutionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConstitutionIntegrityError";
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function defaultConstitutionPath(): string {
  return fileURLToPath(new URL("../constitution/constitution.v1.json", import.meta.url));
}

function unsupportedConstitution(): never {
  throw new ConstitutionIntegrityError("Constitution schema or version is unsupported.");
}

function assertCoreCollections(c: Partial<SaraConstitution>): void {
  if (
    c.version !== 1 ||
    !Array.isArray(c.priorityHierarchy) ||
    !Array.isArray(c.protectedActions) ||
    !Array.isArray(c.principles) ||
    !Array.isArray(c.longTermTrajectory)
  ) {
    unsupportedConstitution();
  }
}

function assertStewardship(stewardship: SaraConstitution["stewardship"] | undefined): void {
  if (
    !stewardship ||
    !Array.isArray(stewardship.beneficiaries) ||
    !stewardship.duty ||
    !stewardship.truthfulIdentity ||
    !stewardship.financialSafety ||
    !stewardship.taxCompliance
  ) {
    unsupportedConstitution();
  }
}

function assertSuccession(succession: SaraConstitution["familySuccession"] | undefined): void {
  if (
    !succession ||
    succession.status !== "UNCONFIGURED_PENDING_LEGAL_INSTRUMENT" ||
    succession.distributionModel !== "SPOUSE_PRIMARY_REASON_AWARE_FALLBACK" ||
    succession.beneficiaryRoles?.join(",") !== "owner,spouse,child" ||
    succession.spouseDeathOrIncapacityFallback !== "OWNER_CHILD_EQUAL_THEN_SURVIVOR" ||
    succession.spouseSeparationOrOwnerRevocationFallback !== "OWNER_THEN_CHILD" ||
    !Array.isArray(succession.activationRequirements) ||
    succession.activationRequirements.length === 0
  ) {
    unsupportedConstitution();
  }
}

function assertOwnerAuthority(authority: SaraConstitution["ownerAuthority"] | undefined): void {
  if (!authority) unsupportedConstitution();
  if (authority.ownerFundedRecurringMonthlyUsdMaximum !== 300) {
    throw new ConstitutionIntegrityError("The protected owner-funded recurring ceiling must remain $300.");
  }
  if (authority.bootstrapOwnerFundedRecurringMonthlyTargetUsd !== 0 || authority.unearnedExpansionBudgetUsd !== 0) {
    throw new ConstitutionIntegrityError("Bootstrap recurring target and unearned expansion budget must remain $0.");
  }
  if (
    authority.defaultReinvestmentRate !== 0.25 ||
    authority.maximumReinvestmentRate !== 0.5 ||
    authority.minimumOwnerDistributionRate !== 0.5 ||
    authority.maximumOwnerDistributionRate !== 0.75
  ) {
    throw new ConstitutionIntegrityError("Protected distribution and reinvestment limits changed.");
  }
}

export function assertConstitutionShape(value: unknown): asserts value is SaraConstitution {
  if (!value || typeof value !== "object") throw new ConstitutionIntegrityError("Constitution must be an object.");
  const c = value as Partial<SaraConstitution>;
  assertCoreCollections(c);
  assertStewardship(c.stewardship);
  assertSuccession(c.familySuccession);
  assertOwnerAuthority(c.ownerAuthority);
}

export async function loadConstitution(path = defaultConstitutionPath()): Promise<{
  constitution: SaraConstitution;
  digest: string;
}> {
  const raw = await readFile(path);
  const digest = sha256(raw);
  if (digest !== EXPECTED_CONSTITUTION_SHA256) {
    throw new ConstitutionIntegrityError(
      `Constitution digest mismatch: expected ${EXPECTED_CONSTITUTION_SHA256}, received ${digest}.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new ConstitutionIntegrityError(`Constitution JSON is invalid: ${(error as Error).message}`);
  }
  assertConstitutionShape(parsed);
  return { constitution: deepFreeze(parsed), digest };
}
