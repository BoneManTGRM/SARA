import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import * as ts from "typescript";
import { codingTypecheckHost } from "./fresh-typecheck-host.ts";
import { canonicalJson, sha256 } from "./canonical.ts";
import { assertBoundedProgramSource, validateProgramCandidateStructure } from "./genome-lab.ts";
import { verifyGenomeLabProgramCandidate } from "./genome-lab-verifier.ts";
import { codingRepairCandidateDigest } from "./experimental-v5/coding-repair-verification.ts";
import type { ProgramVerificationResult } from "./coding-repair-types.ts";

type Input = Omit<Parameters<typeof verifyGenomeLabProgramCandidate>[0], "experimentalCompilerCache">;
const execute = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../tools/native-checker/", import.meta.url));
const relativeBinary = "node_modules/@typescript/typescript-linux-x64/lib/tsc";
const require = createRequire(import.meta.url);
const typeRoot = dirname(dirname(require.resolve("@types/node/package.json")));
// Retain the already-released TS5 host in authoritative fallbacks; every call
// still creates its own host, Program and checker. No diagnostic or PASS reuse.
const legacy = (input: Input) => verifyGenomeLabProgramCandidate({ ...input, experimentalCompilerCache: codingTypecheckHost("canary") });
const checks: ProgramVerificationResult["completedChecks"] = ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"];

// These are loop checks only. A current TS 5.9.3 final check MUST run before
// returning or learning a candidate; the unchanged kernel checks again later.
// The native compiler is not a drop-in semantic replacement for TS 5.9.3.
export class NativeCodingVerifier {
  readonly engineDigest: string;
  readonly #binary: string;
  #active = 0;
  #waiting: Array<() => void> = [];
  private constructor(binary: string, engineDigest: string) { this.#binary = binary; this.engineDigest = engineDigest; }

  static async create(): Promise<NativeCodingVerifier | undefined> {
    if (process.platform !== "linux" || process.arch !== "x64") return undefined;
    if (ts.version !== "5.9.3") throw new Error("NATIVE_CANARY_LEGACY_COMPILER_MISMATCH");
    const manifest = JSON.parse(await readFile(join(packageRoot, "integrity.json"), "utf8")) as { files: Record<string, string> };
    const entries = Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length || entries.some(([p, h]) => p.includes("..") || !p.startsWith("node_modules/") || !/^[a-f0-9]{64}$/u.test(h))) {
      throw new Error("NATIVE_CANARY_INVALID_MANIFEST");
    }
    for (const [path, hash] of entries) if (sha256(await readFile(join(packageRoot, path))) !== hash) throw new Error("NATIVE_CANARY_INTEGRITY_FAILURE");
    if (!manifest.files[relativeBinary]) throw new Error("NATIVE_CANARY_MISSING_BINARY");
    const binary = join(packageRoot, relativeBinary);
    const version = await execute(binary, ["--version"], { env: { GOMAXPROCS: "2" }, timeout: 5000, maxBuffer: 4096, encoding: "utf8" });
    if (version.stdout.trim() !== "Version 7.0.2" || version.stderr.trim()) throw new Error("NATIVE_CANARY_VERSION_MISMATCH");
    return new NativeCodingVerifier(binary, sha256(canonicalJson(entries)));
  }

  async verify(input: Input, beforeDispatch?: () => Promise<void> | void): Promise<ProgramVerificationResult> {
    // Own inputs across all queue/filesystem/process awaits. No client, secrets,
    // user-controlled command or compiler options cross the process boundary.
    const owned: Input = { candidate: structuredClone(input.candidate), objective: input.objective,
      acceptanceCriteria: [...input.acceptanceCriteria], constitutionDigest: input.constitutionDigest,
      ...(input.maximumBudgetUsd === undefined ? {} : { maximumBudgetUsd: input.maximumBudgetUsd }) };
    try {
      validateProgramCandidateStructure(owned.candidate);
      const paths = new Set(owned.candidate.files.map(f => f.path));
      for (const file of owned.candidate.files) assertBoundedProgramSource(file.path, file.content, paths);
    } catch { return legacy(owned); }
    // Preserve the original critical-capability classification, including its
    // lexical policy. Rejection remains in the existing, unchanged verifier.
    if (owned.candidate.files.some(f => /\b(?:fetch|process|require|WebSocket|XMLHttpRequest|child_process)\b|\bimport\s*\(/u.test(f.content))) {
      return legacy(owned);
    }
    if (this.#active >= 2) {
      if (this.#waiting.length >= 16) throw new Error("NATIVE_CANARY_QUEUE_FULL");
      await new Promise<void>((resolve, reject) => {
        const ready = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { this.#waiting = this.#waiting.filter(f => f !== ready); reject(new Error("NATIVE_CANARY_QUEUE_TIMEOUT")); }, 15000);
        this.#waiting.push(ready);
      });
    } else this.#active++;
    // A released slot is transferred directly to the first waiter.
    let root: string | undefined;
    try {
      await beforeDispatch?.();
      root = await mkdtemp(join(tmpdir(), "sara-native-canary-"));
      const project = join(root, "project"), runtime = join(root, "runtime");
      const runtimePaths: string[] = [], runtimeTests: string[] = [];
      for (const file of owned.candidate.files) {
        const path = join(project, file.path), emitted = join(runtime, file.path.replace(/\.ts$/u, ".mjs"));
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await mkdir(dirname(emitted), { recursive: true, mode: 0o700 });
        await writeFile(path, file.content, { mode: 0o600 });
        const output = ts.transpileModule(file.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
          .replace(/(["'])(\.\.?\/[^"']+)\.ts\1/gu, "$1$2.mjs$1");
        await writeFile(emitted, output, { mode: 0o600 });
        runtimePaths.push(emitted);
        if (file.path.startsWith("tests/")) runtimeTests.push(emitted);
      }
      const config = { compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
        skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, noUncheckedSideEffectImports: false,
        types: ["node"], typeRoots: [typeRoot], rootDir: "." }, files: owned.candidate.files.map(f => f.path) };
      const configPath = join(project, "tsconfig.json");
      await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
      try {
        const result = await execute(this.#binary, ["--project", configPath, "--pretty", "false"], {
          cwd: project, env: { GOMAXPROCS: "2" }, timeout: 5000, maxBuffer: 128 * 1024, encoding: "utf8" });
        if (result.stdout.trim() || result.stderr.trim()) throw new Error("NATIVE_CANARY_UNEXPECTED_OUTPUT");
      } catch (error) {
        // A normal native diagnostic is not authoritative under the old language
        // contract. Obtain the original exact diagnostics, not an invented mapping.
        const failure = error as { code?: number; killed?: boolean; signal?: string | null; stdout?: string };
        if (!failure.killed && !failure.signal && (failure.code === 1 || failure.code === 2) && /error TS\d+:/u.test(failure.stdout ?? "")) {
          return await legacy(owned);
        }
        throw new Error("NATIVE_CANARY_COMPILER_UNAVAILABLE");
      }
      const entry = join(runtime, "program-verification.mjs");
      await writeFile(entry, runtimeTests.map(p => `import ${JSON.stringify(`./${p.slice(runtime.length + 1)}`)};`).join("\n") + "\n", { mode: 0o600 });
      const artifactDigest = codingRepairCandidateDigest(owned.candidate);
      const engineEvidence = sha256(canonicalJson({ phase: "native_loop_check", engineDigest: this.engineDigest, artifactDigest,
        finalLegacyVerificationRequired: true }));
      try {
        await execute(process.execPath, ["--permission", ...[...runtimePaths, entry].flatMap(p => ["--allow-fs-read", p]),
          "--max-old-space-size=64", entry], { cwd: runtime, env: { NODE_NO_WARNINGS: "1" }, timeout: 5000, maxBuffer: 128 * 1024, encoding: "utf8" });
      } catch {
        const signal = { kind: "behavior" as const, code: "GENOME_LAB_RUNTIME_FAILURE", note: "The isolated Genome Lab behavioral verification failed.", severity: "high" as const };
        const evidenceDigest = sha256(canonicalJson(signal));
        const failure = { kind: signal.kind, code: signal.code, file: "", line: 0, column: 0, severity: signal.severity,
          existedBeforeRepair: true, evidenceDigest, fingerprint: sha256(canonicalJson({ kind: signal.kind, code: signal.code, file: "", line: 0 })) };
        return { passed: false, score: 0.8, artifactDigest, failures: [failure], completedChecks: [...checks], evidenceDigests: [evidenceDigest, engineEvidence] };
      }
      return { passed: true, score: 1, artifactDigest, failures: [], completedChecks: [...checks], evidenceDigests: [engineEvidence] };
    } finally {
      // Cleanup is part of the invocation and holds the slot until complete.
      try { if (root) await rm(root, { recursive: true, force: true }); }
      finally { const next = this.#waiting.shift(); if (next) next(); else this.#active--; }
    }
  }
}
