import * as ts from "typescript";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { posix } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import { buildVerifiedSkillCandidate } from "./genome-lab.ts";
import type { CodingFailureKind, CodingFailureSignal, ProgramVerificationResult } from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

const SAFE_PATH = /^(?:src\/[a-z0-9][a-z0-9._/-]*|tests\/[a-z0-9][a-z0-9._/-]*\.test)\.ts$/u;
const PROHIBITED_SOURCE = /\b(?:fetch|process|require|WebSocket|XMLHttpRequest|child_process)\b|\bimport\s*\(/u;
const VIRTUAL_ROOT = "/sara-candidate";

function signal(input: {
  kind: CodingFailureKind;
  code: string;
  file?: string;
  line?: number;
  column?: number;
  note: string;
  severity?: CodingFailureSignal["severity"];
}): CodingFailureSignal {
  const evidenceDigest = sha256(canonicalJson(input));
  return {
    kind: input.kind,
    code: input.code,
    file: input.file ?? "",
    line: input.line ?? 0,
    column: input.column ?? 0,
    evidenceDigest,
    fingerprint: sha256(canonicalJson({ kind: input.kind, code: input.code, file: input.file ?? "", line: input.line ?? 0 })),
    severity: input.severity ?? "medium",
    existedBeforeRepair: true,
  };
}

function diagnosticSignal(diagnostic: ts.Diagnostic): CodingFailureSignal {
  const location = diagnostic.file && diagnostic.start !== undefined
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : undefined;
  return signal({
    kind: diagnostic.code >= 1000 && diagnostic.code < 2000 ? "syntax" : "type",
    code: `TS${diagnostic.code}`,
    file: diagnostic.file?.fileName.replace(`${VIRTUAL_ROOT}/`, "") ?? "",
    line: location ? location.line + 1 : 0,
    column: location ? location.character + 1 : 0,
    note: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  });
}

function typeDiagnostics(candidate: ProgramCandidateProposal): ts.Diagnostic[] {
  const files = new Map(candidate.files.map((file) => [`${VIRTUAL_ROOT}/${file.path}`, file.content]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowImportingTsExtensions: true,
  };
  const base = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (name) => files.has(name) || base.fileExists(name),
    readFile: (name) => files.get(name) ?? base.readFile(name),
    getSourceFile: (name, languageVersion) => {
      const source = files.get(name);
      return source === undefined ? base.getSourceFile(name, languageVersion) : ts.createSourceFile(name, source, languageVersion, true);
    },
    resolveModuleNames: (moduleNames, containingFile) => moduleNames.map((moduleName) => {
      if (moduleName.startsWith(".")) {
        const resolvedFileName = posix.normalize(posix.join(posix.dirname(containingFile), moduleName));
        if (files.has(resolvedFileName)) return { resolvedFileName, extension: ts.Extension.Ts };
      }
      return ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule;
    }),
  };
  return [...ts.getPreEmitDiagnostics(ts.createProgram([...files.keys()], options, host))];
}

export async function verifyProgramCandidate(input: {
  candidate: ProgramCandidateProposal;
  behaviorCheck?: (candidate: ProgramCandidateProposal) => Promise<CodingFailureSignal[]>;
}): Promise<ProgramVerificationResult> {
  const canonicalFiles = [...input.candidate.files]
    .map((file) => ({ path: file.path, contentDigest: sha256(file.content) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const artifactDigest = sha256(canonicalJson({ schemaVersion: 1, files: canonicalFiles }));
  const failures: CodingFailureSignal[] = [];
  const paths = new Set<string>();
  for (const file of input.candidate.files) {
    if (!SAFE_PATH.test(file.path) || file.path.includes("..") || paths.has(file.path)) {
      failures.push(signal({ kind: "policy", code: "UNSAFE_PATH", file: file.path, note: "Candidate path is unsafe or duplicated.", severity: "high" }));
    }
    if (PROHIBITED_SOURCE.test(file.content)) {
      failures.push(signal({ kind: "security", code: "PROHIBITED_CAPABILITY", file: file.path, note: "Candidate requests a prohibited capability.", severity: "critical" }));
    }
    paths.add(file.path);
  }
  const completedChecks: ProgramVerificationResult["completedChecks"] = ["source_policy", "syntax", "typecheck", "artifact_integrity"];
  if (!failures.some((failure) => failure.kind === "policy" || failure.kind === "security")) {
    failures.push(...typeDiagnostics(input.candidate).map(diagnosticSignal));
  }
  if (input.behaviorCheck) {
    failures.push(...await input.behaviorCheck(structuredClone(input.candidate)));
    completedChecks.push("behavior_tests");
  }
  const evidenceDigests = [...new Set(failures.map((failure) => failure.evidenceDigest))];
  if (!failures.length) evidenceDigests.push(sha256(canonicalJson({ artifactDigest, completedChecks, result: "PASS" })));
  const denominator = 5;
  const passedChecks = completedChecks.filter((check) => {
    if (check === "source_policy") return !failures.some((failure) => failure.kind === "policy" || failure.kind === "security");
    if (check === "syntax") return !failures.some((failure) => failure.kind === "syntax");
    if (check === "typecheck") return !failures.some((failure) => failure.kind === "type");
    if (check === "behavior_tests") return !failures.some((failure) => failure.kind === "test" || failure.kind === "behavior");
    return !failures.some((failure) => failure.kind === "integrity");
  }).length;
  return {
    passed: failures.length === 0 && completedChecks.includes("behavior_tests"),
    score: passedChecks / denominator,
    artifactDigest,
    failures,
    completedChecks,
    evidenceDigests,
  };
}

export async function verifyGenomeLabProgramCandidate(input: {
  candidate: ProgramCandidateProposal;
  objective: string;
  acceptanceCriteria: string[];
  constitutionDigest: string;
  maximumBudgetUsd?: number;
}): Promise<ProgramVerificationResult> {
  const initial = await verifyProgramCandidate({ candidate: input.candidate });
  if (initial.failures.length > 0) return initial;
  const root = await mkdtemp(join(tmpdir(), "sara-reparodynamic-verify-"));
  try {
    await buildVerifiedSkillCandidate(
      {
        schemaVersion: 1,
        role: "sandboxed_coding_executor",
        jobId: randomUUID(),
        constitutionDigest: input.constitutionDigest,
        objective: input.objective,
        acceptanceCriteria: [...input.acceptanceCriteria],
        missingCapabilities: [],
        maximumBudgetUsd: input.maximumBudgetUsd ?? 0.15,
        prohibitedActions: [],
        requiredProcess: [],
        requiredOutput: [],
      },
      input.candidate,
      root,
      randomUUID(),
    );
    const completedChecks: ProgramVerificationResult["completedChecks"] = [
      "source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity",
    ];
    return {
      passed: true,
      score: 1,
      artifactDigest: initial.artifactDigest,
      failures: [],
      completedChecks,
      evidenceDigests: [sha256(canonicalJson({ artifactDigest: initial.artifactDigest, completedChecks, result: "PASS" }))],
    };
  } catch {
    const failure = signal({
      kind: "behavior",
      code: "GENOME_LAB_RUNTIME_FAILURE",
      file: input.candidate.files.find((file) => file.path.startsWith("tests/"))?.path ?? "",
      note: "The isolated Genome Lab behavioral verification failed.",
      severity: "high",
    });
    return {
      ...initial,
      passed: false,
      score: 0.8,
      failures: [failure],
      completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
      evidenceDigests: [failure.evidenceDigest],
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
