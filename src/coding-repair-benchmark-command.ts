import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";

export type CodingBenchmarkCommandConfig = {
  live: true;
  acknowledgeLabOnly: true;
  benchmarkId: string;
  maximumSpendUsd: number;
  currentCanaryPercent: number;
  caseCount: number;
  stateDirectory: string;
  authorityDigest: string;
  sourceRevision: string;
  apiKey: string;
};

const VALUE_ARGUMENTS = new Set([
  "--benchmark-id",
  "--max-spend-usd",
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
  const benchmarkId = values.get("--benchmark-id") ?? "";
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
  const minimumSpendUsd = Number((
    caseCount * 2 * INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd
  ).toFixed(2));
  if (maximumSpendUsd < minimumSpendUsd) {
    throw new Error(
      `--max-spend-usd must be at least $${minimumSpendUsd.toFixed(2)} for ${caseCount} complete matched pairs.`,
    );
  }
  const stateDirectory = values.get("--state-directory") ?? ".sara-state";
  if (!stateDirectory.trim() || stateDirectory.length > 1_024 || stateDirectory.includes("\0")) {
    throw new Error("--state-directory is malformed.");
  }
  const authorityDigest = input.env.SARA_CODING_BENCHMARK_AUTHORITY_SHA256
    ?.trim().toLowerCase() ?? "";
  if (!HEX_DIGEST.test(authorityDigest)) {
    throw new Error(
      "SARA_CODING_BENCHMARK_AUTHORITY_SHA256 is required as a target-bound SHA-256 digest.",
    );
  }
  const sourceRevision = input.env.SARA_CODING_BENCHMARK_SOURCE_REVISION
    ?.trim().toLowerCase() ?? "";
  if (!SOURCE_REVISION.test(sourceRevision)) {
    throw new Error(
      "SARA_CODING_BENCHMARK_SOURCE_REVISION is required as an immutable Git revision.",
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
    currentCanaryPercent,
    caseCount,
    stateDirectory,
    authorityDigest,
    sourceRevision,
    apiKey,
  };
}
