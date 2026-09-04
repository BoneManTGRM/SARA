import { readFile } from "node:fs/promises";
import { canonicalJson, sha256 } from "./canonical.ts";
import type { Capability } from "./types.ts";

export const REVENUE_CAPABILITY_MIGRATION_ID = "revenue-pilot-capabilities" as const;
export const REVENUE_CAPABILITY_EVIDENCE_VERSION = 5 as const;

type Definition = {
  id: string;
  name: string;
  implementationFiles: string[];
  evidenceTests: string[];
  limitations: string[];
};

const DEFINITIONS: readonly Definition[] = [
  {
    id: "public-repository-inventory",
    name: "Immutable public repository inventory",
    implementationFiles: ["src/public-repository-evidence.ts"],
    evidenceTests: ["tests/public-repository-evidence.test.ts"],
    limitations: ["Anonymous public GitHub repositories only."],
  },
  {
    id: "readiness-analysis",
    name: "Evidence-bound repository readiness analysis",
    implementationFiles: ["src/founding-pilot.ts", "src/repository-readiness-report.ts"],
    evidenceTests: ["tests/founding-pilot.test.ts", "tests/repository-readiness-report.test.ts"],
    limitations: ["Technical observations only; no certification, warranty, or exploit validation."],
  },
  {
    id: "independent-report-verification",
    name: "Independent report verification",
    implementationFiles: ["src/revenue-pilot.ts", "src/revenue-pilot-operator.ts"],
    evidenceTests: ["tests/revenue-pilot.test.ts", "tests/revenue-pilot-operator.test.ts"],
    limitations: [
      "Logical role separation is enforced; automated delivery is disclosed and requires a passing verifier.",
    ],
  },
  {
    id: "delivery-package-generation",
    name: "Private readiness delivery package generation",
    implementationFiles: [
      "src/repository-readiness-report-artifacts.ts",
      "src/revenue-pilot-artifacts.ts",
    ],
    evidenceTests: ["tests/repository-readiness-report.test.ts", "tests/revenue-pilot-operator.test.ts"],
    limitations: [
      "External delivery authority is limited to the approved public-repository service and active standing mandate.",
    ],
  },
] as const;

async function implementationDigest(files: readonly string[]): Promise<string> {
  const contents = await Promise.all(files.map(async (path) => ({
    path,
    sha256: sha256(await readFile(new URL(`../${path}`, import.meta.url), "utf8")),
  })));
  return sha256(canonicalJson(contents));
}

export async function verifiedRevenueCapabilities(now = new Date()): Promise<Capability[]> {
  const verifiedAt = now.toISOString();
  return Promise.all(DEFINITIONS.map(async (definition) => {
    const digest = await implementationDigest(definition.implementationFiles);
    const evidence = {
      schemaVersion: 1,
      capabilityId: definition.id,
      implementationFiles: definition.implementationFiles,
      implementationDigest: digest,
      evidenceTests: definition.evidenceTests,
      verificationCommand: "npm run verify",
    };
    return {
      id: definition.id,
      name: definition.name,
      status: "available",
      evidence: [
        ...definition.evidenceTests.map((test) => `behavioral-test:${test}`),
        `implementation-sha256:${digest}`,
        "integrated-gate:npm run verify",
      ],
      limitations: [...definition.limitations],
      registration: {
        schemaVersion: 1,
        migrationId: REVENUE_CAPABILITY_MIGRATION_ID,
        evidenceVersion: REVENUE_CAPABILITY_EVIDENCE_VERSION,
        implementationDigest: digest,
        evidenceDigest: sha256(canonicalJson(evidence)),
        provenance: "https://github.com/BoneManTGRM/SARA",
        verifiedAt,
      },
    } satisfies Capability;
  }));
}

export function revenueCapabilityMigrationDecision(
  existing: Capability | undefined,
  candidate: Capability,
): "register" | "preserve" {
  if (!existing || existing.status !== "available") return "register";
  const current = existing.registration;
  const next = candidate.registration!;
  if (!current || current.migrationId !== next.migrationId) {
    throw new Error(`Capability ${candidate.id} already has conflicting available evidence.`);
  }
  if (current.evidenceVersion > next.evidenceVersion) return "preserve";
  if (current.evidenceVersion < next.evidenceVersion) return "register";
  if (
    current.implementationDigest !== next.implementationDigest ||
    current.evidenceDigest !== next.evidenceDigest
  ) {
    throw new Error(`Capability ${candidate.id} changed without a stronger evidence version.`);
  }
  return "preserve";
}
