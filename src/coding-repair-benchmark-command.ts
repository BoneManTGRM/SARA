import { canonicalJson, sha256 } from "./canonical.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";

export type CodingBenchmarkCommandConfig = {
  live: true;
  acknowledgeLabOnly: true;
  benchmarkId: string;
  maximumSpendUsd: number;
  maximumModelSpendUsdPerArm: number;
  currentCanaryPercent: number;
  caseCount: number;
  stateDirectory: string;
  authorityDigest: string;
  sourceRevision: string;
  apiKey: string;
};

export type CodingBenchmarkAuthorityInput = {
  benchmarkId: string;
  sourceRevision: string;
  maximumSpendUsd: number;
  maximumModelSpendUsdPerArm?: number;
  currentCanaryPercent: number;
  caseCount: number;
};

const MAXIMUM_ARM_SPEND_USD = INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd;
const USD_MICROS = 1_000_000;

const VALUE_ARGUMENTS = new Set([
  "--benchmark-id",
  "--max-spend-usd",
  "--max-arm-spend-usd",
  "--current-canary-percent",
  "--case-count",
  "--state-directory",
]);
const FLAG_ARGUMENTS = new Set(["--live", "--acknowledge-lab-only"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HEX_DIGEST = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function parseInteger(value: string | undefined, label: string): number {
  if (value === undefined || !/^\d+$/u.test(value)) {
    throw new Error(`${label} is required and must be an integer.`);
  }
  return Number(value);
}

function parseMoney(value: string | undefined): number {
  if (value === undefined || !/^\d+(?:\.\d{1,2})?$/u.test(value)) {
    throw new Error("--max-spend-usd is required and must be a whole-cent amount.");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10) {
    throw new Error("--max-spend-usd must be greater than 0 and no more than 10.00.");
  }
  return parsed;
}

function validatedArmSpend(value: number = MAXIMUM_ARM_SPEND_USD): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAXIMUM_ARM_SPEND_USD
      || Math.round(value * USD_MICROS) / USD_MICROS !== value) {
    throw new Error("Benchmark arm spend must be positive, at most $0.15, and use at most six decimal places.");
  }
  return value;
}

function parseArmSpend(value: string | undefined): number {
  if (value === undefined) return MAXIMUM_ARM_SPEND_USD;
  if (!/^\d+(?:\.\d{1,6})?$/u.test(value)) {
    throw new Error("--max-arm-spend-usd must be a decimal amount with at most six decimal places.");
  }
  return validatedArmSpend(Number(value));
}

export function codingBenchmarkAuthorityDigest(
  input: CodingBenchmarkAuthorityInput,
): string {
  if (!UUID_V4.test(input.benchmarkId)) throw new Error("Benchmark authority id is malformed.");
  if (!SOURCE_REVISION.test(input.sourceRevision)) {
    throw new Error("Benchmark authority source revision is malformed.");
  }
  if (!Number.isFinite(input.maximumSpendUsd) || input.maximumSpendUsd <= 0 || input.maximumSpendUsd > 10) {
    throw new Error("Benchmark authority maximum spend is malformed.");
  }
  if (
    !Number.isInteger(input.currentCanaryPercent)
    || input.currentCanaryPercent < 0
    || input.currentCanaryPercent > 100
  ) throw new Error("Benchmark authority canary percentage is malformed.");
  if (!Number.isInteger(input.caseCount) || input.caseCount < 1 || input.caseCount > 100) {
    throw new Error("Benchmark authority case count is malformed.");
  }
  const maximumModelSpendUsdPerArm = validatedArmSpend(input.maximumModelSpendUsdPerArm);
  return sha256(canonicalJson({
    schemaVersion: 1,
    action: "run_live_reparodynamic_coding_benchmark",
    evidenceScope: "LAB_SYNTHETIC_ONLY",
    benchmarkId: input.benchmarkId.toLowerCase(),
    sourceRevision: input.sourceRevision.toLowerCase(),
    maximumSpendUsd: input.maximumSpendUsd,
    currentCanaryPercent: input.currentCanaryPercent,
    caseCount: input.caseCount,
    maximumModelSpendUsdPerArm,
  }));
}

export function assertCodingBenchmarkSourceRevision(
  expectedRevision: string,
  actualRevision: string,
): void {
  const expected = expectedRevision.trim().toLowerCase();
  const actual = actualRevision.trim().toLowerCase();
  if (!SOURCE_REVISION.test(expected) || !SOURCE_REVISION.test(actual)) {
    throw new Error("The coding benchmark source revision is malformed.");
  }
  if (expected !== actual) {
    throw new Error("The bound source revision does not match the exact checked-out revision.");
  }
}

export function parseCodingBenchmarkCommand(input: {
  args: string[];
  env: Record<string, string | undefined>;
  maximumCases: number;
}): CodingBenchmarkCommandConfig {
  if (!Number.isInteger(input.maximumCases) || input.maximumCases < 1 || input.maximumCases > 100) {
    throw new Error("maximumCases must be an integer from 1 through 100.");
  }
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < input.args.length; index += 1) {
    const argument = input.args[index]!;
    if (FLAG_ARGUMENTS.has(argument)) {
      if (flags.has(argument)) throw new Error(`Duplicate coding benchmark argument ${argument}.`);
      flags.add(argument);
      continue;
    }
    if (VALUE_ARGUMENTS.has(argument)) {
      if (values.has(argument)) throw new Error(`Duplicate coding benchmark argument ${argument}.`);
      const value = input.args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      values.set(argument, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown coding benchmark argument: ${argument}`);
  }
  if (!flags.has("--live")) {
    throw new Error("Live model execution requires the explicit --live flag.");
  }
  if (!flags.has("--acknowledge-lab-only")) {
    throw new Error("Live execution requires explicit LAB-only evidence acknowledgement.");
  }
  const benchmarkId = values.get("--benchmark-id")?.toLowerCase() ?? "";
  if (!UUID_V4.test(benchmarkId)) {
    throw new Error("--benchmark-id is required and must be a UUID v4.");
  }
  const caseCount = parseInteger(
    values.get("--case-count") ?? String(input.maximumCases),
    "--case-count",
  );
  if (caseCount < 1 || caseCount > input.maximumCases) {
    throw new Error(`--case-count must be from 1 through ${input.maximumCases}.`);
  }
  const currentCanaryPercent = parseInteger(
    values.get("--current-canary-percent"),
    "--current-canary-percent",
  );
  if (currentCanaryPercent < 0 || currentCanaryPercent > 100) {
    throw new Error("--current-canary-percent must be from 0 through 100.");
  }
  const maximumSpendUsd = parseMoney(values.get("--max-spend-usd"));
  const maximumModelSpendUsdPerArm = parseArmSpend(values.get("--max-arm-spend-usd"));
  // Compare integer micro-dollars. Rounding $0.152 down to cents would admit
  // two $0.076 arms under a $0.15 total, despite insufficient reservations.
  const minimumSpendMicros = caseCount * 2 * Math.round(maximumModelSpendUsdPerArm * USD_MICROS);
  const minimumSpendUsd = minimumSpendMicros / USD_MICROS;
  if (Math.round(maximumSpendUsd * USD_MICROS) < minimumSpendMicros) {
    throw new Error(
      `--max-spend-usd must be at least $${minimumSpendUsd.toFixed(6)} for ${caseCount} complete matched pairs.`,
    );
  }
  const stateDirectory = values.get("--state-directory") ?? ".sara-state";
  if (!stateDirectory.trim() || stateDirectory.length > 1_024 || stateDirectory.includes("\0")) {
    throw new Error("--state-directory is malformed.");
  }
  const sourceRevision = input.env.SARA_CODING_BENCHMARK_SOURCE_REVISION
    ?.trim().toLowerCase() ?? "";
  if (!SOURCE_REVISION.test(sourceRevision)) {
    throw new Error(
      "SARA_CODING_BENCHMARK_SOURCE_REVISION is required as an immutable Git revision.",
    );
  }
  const authorityDigest = input.env.SARA_CODING_BENCHMARK_AUTHORITY_SHA256
    ?.trim().toLowerCase() ?? "";
  if (!HEX_DIGEST.test(authorityDigest)) {
    throw new Error(
      "SARA_CODING_BENCHMARK_AUTHORITY_SHA256 is required as a target-bound SHA-256 digest.",
    );
  }
  const expectedAuthorityDigest = codingBenchmarkAuthorityDigest({
    benchmarkId,
    sourceRevision,
    maximumSpendUsd,
    maximumModelSpendUsdPerArm,
    currentCanaryPercent,
    caseCount,
  });
  if (authorityDigest !== expectedAuthorityDigest) {
    throw new Error(
      "SARA_CODING_BENCHMARK_AUTHORITY_SHA256 does not match the exact live benchmark target.",
    );
  }
  const apiKey = input.env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for live matched coding benchmark execution.");
  }
  return {
    live: true,
    acknowledgeLabOnly: true,
    benchmarkId,
    maximumSpendUsd,
    maximumModelSpendUsdPerArm,
    currentCanaryPercent,
    caseCount,
    stateDirectory,
    authorityDigest,
    sourceRevision,
    apiKey,
  };
}
