import { OpenAIResponsesClient } from "../src/openai-worker.ts";
import type { PublicRepositoryEvidenceSnapshot } from "../src/public-repository-evidence.ts";
import { compileRepositoryReadinessWorkerOutput } from "../src/repository-readiness-report-artifacts.ts";

const repository = "https://github.com/BoneManTGRM/SARA";
const commit = "c14f5113c34271abd69e0a9fbcbd29d4dcf4f750";
const paths = [
  "package.json",
  "src/openai-worker.ts",
  "src/model-router.ts",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
] as const;

async function snapshot(): Promise<PublicRepositoryEvidenceSnapshot> {
  const sampledFiles: PublicRepositoryEvidenceSnapshot["sampledFiles"] = [];
  let total = 0;
  for (const path of paths) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `https://raw.githubusercontent.com/BoneManTGRM/SARA/${commit}/${encoded}`,
      { headers: { "user-agent": "SARA-Isolated-Compiler-Diagnostic/1.0" } },
    );
    if (!response.ok) throw new Error(`Diagnostic source ${path} failed with status ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const limit = Math.max(0, Math.min(1_500, 6_000 - total));
    const slice = bytes.subarray(0, limit);
    const sourceText = slice.toString("utf8").replace(/\u0000/gu, "");
    total += Buffer.byteLength(sourceText, "utf8");
    sampledFiles.push({
      path,
      permalink: `${repository}/blob/${commit}/${encoded}`,
      sourceText,
      sourceTruncated: bytes.length > slice.length,
    });
  }
  return {
    schemaVersion: 1,
    provider: "github",
    repository,
    immutableCommitSha: commit,
    defaultBranch: "main",
    collectedAt: new Date().toISOString(),
    collectionMode: "anonymous_read_only",
    repositoryFacts: {
      archived: false,
      disabled: false,
      fork: false,
      stars: 0,
      openIssues: 1,
      licenseSpdx: "NOASSERTION",
    },
    inventory: sampledFiles.map((file) => ({
      path: file.path,
      type: "blob" as const,
      size: Buffer.byteLength(file.sourceText, "utf8"),
    })),
    inventoryTruncated: true,
    sampledFiles,
    limitations: [
      "Private diagnostic reproduction of the same connector-verified pinned evidence packet.",
    ],
  };
}

function safeShape(outputText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(outputText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { json: true, object: false };
    }
    const record = parsed as Record<string, unknown>;
    const categories = Array.isArray(record.categoryEvidence) ? record.categoryEvidence : [];
    const findings = Array.isArray(record.findings) ? record.findings : [];
    return {
      json: true,
      object: true,
      topLevelKeys: Object.keys(record).sort(),
      categoryCount: categories.length,
      categoryNames: categories.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>).category
          : null
      ),
      categoryStatuses: categories.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>).status
          : null
      ),
      findingCount: findings.length,
      findingCategories: findings.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>).category
          : null
      ),
      limitationCount: Array.isArray(record.evidenceLimitations)
        ? record.evidenceLimitations.length
        : null,
    };
  } catch {
    return {
      json: false,
      beginsWithFence: outputText.trimStart().startsWith("```"),
      characterCount: outputText.length,
    };
  }
}

const evidence = await snapshot();
const originalExecute = OpenAIResponsesClient.prototype.execute;
let completedExecutions = 0;
OpenAIResponsesClient.prototype.execute = async function (
  this: OpenAIResponsesClient,
  input: Parameters<OpenAIResponsesClient["execute"]>[0],
): ReturnType<OpenAIResponsesClient["execute"]> {
  const result = await originalExecute.call(this, input);
  completedExecutions += 1;
  if (completedExecutions === 4) {
    const shape = safeShape(result.outputText);
    try {
      const report = compileRepositoryReadinessWorkerOutput({
        outputText: result.outputText,
        snapshot: evidence,
      });
      console.log(`SARA_INTERNAL_FREE_PROOF_COMPILER_DIAGNOSTIC=${JSON.stringify({
        result: "PASS",
        shape,
        reportStatus: report.status,
        findingCount: report.findings.length,
      })}`);
    } catch (error) {
      console.error(`SARA_INTERNAL_FREE_PROOF_COMPILER_DIAGNOSTIC=${JSON.stringify({
        result: "FAIL",
        shape,
        safeCompilerMessage: error instanceof Error ? error.message : String(error),
      })}`);
    }
  }
  return result;
};

await import("./live-internal-readiness-proof.ts");
