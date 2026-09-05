import type { ExperimentalCompilerCache } from "./experimental-compiler-cache.ts";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { promisify } from "node:util";
import * as ts from "typescript";
import { canonicalJson, sha256 } from "./canonical.ts";
import type { ExecutorHandoff } from "./handoff.ts";
import { compileOperationalSkillProvenance } from "./operational-skills.ts";
import type { CandidateProposal, ProgramCandidateProposal, SkillCandidateProposal } from "./types.ts";

export type GeneratedSkillCandidate = {
  artifactDirectory: string;
  artifactRelativePath: string;
  candidateDigest: string;
  verificationOutputDigest: string;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const execFileAsync = promisify(execFile);
const MAX_SOURCE_BYTES = 32 * 1024;
const MAX_TEST_VECTORS = 16;
const MAX_PROGRAM_FILES = 24;
const MAX_PROGRAM_FILE_BYTES = 16 * 1024;
const MAX_PROGRAM_BYTES = 48 * 1024;
const PROGRAM_PATH = /^(?:src\/[a-z0-9][a-z0-9._/-]*|tests\/[a-z0-9][a-z0-9._/-]*\.test)\.ts$/u;
const BLOCKED_IDENTIFIERS = new Set([
  "Bun",
  "Date",
  "Deno",
  "EventSource",
  "Function",
  "Object",
  "Proxy",
  "Reflect",
  "WebAssembly",
  "WebSocket",
  "XMLHttpRequest",
  "eval",
  "fetch",
  "global",
  "globalThis",
  "module",
  "navigator",
  "performance",
  "process",
  "require",
  "setImmediate",
  "setInterval",
  "setTimeout",
]);
const BLOCKED_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

type ArtifactTreeEntry = {
  path: string;
  type: "directory" | "file";
  mode: number;
  contentDigest?: string;
};

export async function digestArtifactTree(artifactDirectory: string): Promise<string> {
  const entries: ArtifactTreeEntry[] = [];
  async function walk(absoluteDirectory: string, relativeDirectory: string): Promise<void> {
    const directoryStat = await lstat(absoluteDirectory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error("Genome Lab artifact tree contains an invalid directory.");
    }
    entries.push({
      path: relativeDirectory || ".",
      type: "directory",
      mode: directoryStat.mode & 0o777,
    });
    const children = await readdir(absoluteDirectory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      const absolutePath = join(absoluteDirectory, child.name);
      const childStat = await lstat(absolutePath);
      if (childStat.isSymbolicLink()) {
        throw new Error("Genome Lab artifacts may not contain symbolic links.");
      }
      if (childStat.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!childStat.isFile()) {
        throw new Error("Genome Lab artifacts may contain only regular files and directories.");
      }
      entries.push({
        path: relativePath,
        type: "file",
        mode: childStat.mode & 0o777,
        contentDigest: sha256(await readFile(absolutePath)),
      });
    }
  }
  await walk(artifactDirectory, "");
  return sha256(canonicalJson(entries));
}

function validateSkillCandidateProposal(proposal: SkillCandidateProposal): void {
  if (proposal.schemaVersion !== 1) throw new Error("Skill candidate schema version is unsupported.");
  if (!/^[A-Za-z][A-Za-z0-9 _-]{1,63}$/.test(proposal.skillName)) {
    throw new Error("Skill name must be 2–64 safe display characters.");
  }
  if (!proposal.summary.trim() || proposal.summary.length > 500) {
    throw new Error("Skill candidate summary must be 1–500 characters.");
  }
  if (Buffer.byteLength(proposal.source, "utf8") === 0 || Buffer.byteLength(proposal.source, "utf8") > MAX_SOURCE_BYTES) {
    throw new Error(`Skill source must be between 1 and ${MAX_SOURCE_BYTES} bytes.`);
  }
  if (proposal.tests.length === 0 || proposal.tests.length > MAX_TEST_VECTORS) {
    throw new Error(`Skill candidates require 1–${MAX_TEST_VECTORS} behavioral test vectors.`);
  }
  if (proposal.limitations.length > 16 || proposal.limitations.some((item) => !item.trim() || item.length > 300)) {
    throw new Error("Skill limitations must contain at most 16 non-empty entries of 300 characters or fewer.");
  }
  const names = new Set<string>();
  for (const vector of proposal.tests) {
    if (!vector.name.trim() || vector.name.length > 120 || names.has(vector.name)) {
      throw new Error("Behavioral test names must be unique and 1–120 characters.");
    }
    names.add(vector.name);
    canonicalJson(vector.input);
    canonicalJson(vector.expected);
  }
  if (proposal.operational) compileOperationalSkillProvenance(proposal.operational);
}

function assertPureSkillSource(source: string): void {
  const sourceFile = ts.createSourceFile("skill.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const syntaxErrors = (sourceFile as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (syntaxErrors.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new Error("Generated skill contains invalid TypeScript syntax.");
  }
  let exportsRunSkill = false;
  let violation = "";
  const visit = (node: ts.Node): void => {
    if (violation) return;
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      violation = "imports and module loading are prohibited";
      return;
    }
    if (ts.isIdentifier(node) && BLOCKED_IDENTIFIERS.has(node.text)) {
      violation = `identifier ${node.text} is prohibited`;
      return;
    }
    if (ts.isPropertyAccessExpression(node) && BLOCKED_PROPERTIES.has(node.name.text)) {
      violation = `property ${node.name.text} is prohibited`;
      return;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text.startsWith("__")) {
      violation = `property ${node.name.text} is prohibited`;
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      violation = "computed property access is prohibited";
      return;
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      violation = "the any type is prohibited";
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === "runSkill") {
      exportsRunSkill = Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (violation) throw new Error(`Generated skill is not a pure isolated candidate: ${violation}.`);
  if (!exportsRunSkill) throw new Error("Generated skill must export a runSkill(input) function.");
}

function verificationSource(proposal: SkillCandidateProposal): string {
  return [
    'import { runSkill } from "./skill.ts";',
    `const vectors = ${JSON.stringify(proposal.tests)} as const;`,
    "function normalize(value: unknown): unknown {",
    "  if (Array.isArray(value)) return value.map(normalize);",
    '  if (value && typeof value === "object") {',
    "    const record = value as Record<string, unknown>;",
    "    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalize(record[key])]));",
    "  }",
    "  return value;",
    "}",
    "function summarize(value: string): string {",
    "  return value.length <= 2048 ? value : `${value.slice(0, 2048)}...[truncated]`;",
    "}",
    "const failures: Array<{ name: string; expected: string; actual: string }> = [];",
    "for (const vector of vectors) {",
    "  const observed = await Promise.resolve(runSkill(structuredClone(vector.input)));",
    "  const actualJson = JSON.stringify(normalize(observed));",
    "  const expectedJson = JSON.stringify(normalize(vector.expected));",
    "  if (actualJson !== expectedJson) failures.push({ name: vector.name, expected: summarize(expectedJson), actual: summarize(actualJson) });",
    "}",
    "if (failures.length) throw new Error(`Behavioral verification mismatches: ${JSON.stringify(failures)}`);",
    'console.log(JSON.stringify({ result: "PASS", tests: vectors.length }));',
    "",
  ].join("\n");
}

function semanticDiagnostics(files: string[], cache?: ExperimentalCompilerCache): ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowImportingTsExtensions: true,
  };
  const program = ts.createProgram(files, options, cache?.createHost(options));
  return ts.getPreEmitDiagnostics(program).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
}

function isProgramCandidate(proposal: CandidateProposal): proposal is ProgramCandidateProposal {
  return "candidateKind" in proposal && proposal.candidateKind === "typescript_program";
}

export function validateProgramCandidateStructure(proposal: ProgramCandidateProposal): void {
  if (proposal.schemaVersion !== 1) throw new Error("Program candidate schema version is unsupported.");
  if (!/^[A-Za-z][A-Za-z0-9 _-]{1,63}$/u.test(proposal.programName)) {
    throw new Error("Program name must be 2–64 safe display characters.");
  }
  if (!proposal.summary.trim() || proposal.summary.length > 500) {
    throw new Error("Program candidate summary must be 1–500 characters.");
  }
  if (proposal.files.length < 3 || proposal.files.length > MAX_PROGRAM_FILES) {
    throw new Error(`Program candidates require 3–${MAX_PROGRAM_FILES} files.`);
  }
  if (proposal.limitations.length > 16 || proposal.limitations.some((item) => !item.trim() || item.length > 300)) {
    throw new Error("Program limitations must contain at most 16 non-empty entries of 300 characters or fewer.");
  }
  const paths = new Set<string>();
  let totalBytes = 0;
  let sourceFiles = 0;
  let testFiles = 0;
  for (const file of proposal.files) {
    if (
      !PROGRAM_PATH.test(file.path) ||
      file.path.includes("//") ||
      file.path.includes("..") ||
      posix.normalize(file.path) !== file.path ||
      paths.has(file.path)
    ) {
      throw new Error("Program file paths must be unique normalized src/*.ts or tests/*.test.ts paths.");
    }
    paths.add(file.path);
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes === 0 || bytes > MAX_PROGRAM_FILE_BYTES) {
      throw new Error(`Each program file must be between 1 and ${MAX_PROGRAM_FILE_BYTES} bytes.`);
    }
    totalBytes += bytes;
    if (file.path.startsWith("src/")) sourceFiles += 1;
    if (file.path.startsWith("tests/")) testFiles += 1;
  }
  if (totalBytes > MAX_PROGRAM_BYTES) throw new Error(`Program source exceeds ${MAX_PROGRAM_BYTES} bytes.`);
  if (!paths.has("src/index.ts") || sourceFiles < 2 || testFiles < 1) {
    throw new Error("Programs require src/index.ts, at least two source modules, and at least one test module.");
  }
}

function programModuleSpecifier(node: ts.Node): ts.Expression | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  return undefined;
}

function assertBoundedProgramSource(
  filePath: string,
  source: string,
  allPaths: ReadonlySet<string>,
): void {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const syntaxErrors = (sourceFile as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (syntaxErrors.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new Error(`Program file ${filePath} contains invalid TypeScript syntax.`);
  }
  let violation = "";
  const visit = (node: ts.Node): void => {
    if (violation) return;
    if (ts.isImportEqualsDeclaration(node) || (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      violation = "dynamic or legacy module loading is prohibited";
      return;
    }
    const moduleExpression = programModuleSpecifier(node);
    if (moduleExpression) {
      if (!ts.isStringLiteral(moduleExpression)) {
        violation = "module specifiers must be string literals";
        return;
      }
      const specifier = moduleExpression.text;
      const allowedTestBuiltin = filePath.startsWith("tests/") &&
        (specifier === "node:test" || specifier === "node:assert/strict");
      if (!allowedTestBuiltin) {
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
          violation = `external module ${specifier} is prohibited`;
          return;
        }
        if (!specifier.endsWith(".ts")) {
          violation = "relative imports must use an explicit .ts extension";
          return;
        }
        const resolved = posix.normalize(posix.join(posix.dirname(filePath), specifier));
        if (resolved.startsWith("../") || !allPaths.has(resolved)) {
          violation = `relative module ${specifier} is outside or absent from the candidate`;
          return;
        }
        if (filePath.startsWith("src/") && !resolved.startsWith("src/")) {
          violation = "production source may not import test modules";
          return;
        }
      }
    }
    if (ts.isIdentifier(node) && BLOCKED_IDENTIFIERS.has(node.text)) {
      violation = `identifier ${node.text} is prohibited`;
      return;
    }
    if (ts.isPropertyAccessExpression(node) && (BLOCKED_PROPERTIES.has(node.name.text) || node.name.text.startsWith("__"))) {
      violation = `property ${node.name.text} is prohibited`;
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      violation = "computed property access is prohibited";
      return;
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      violation = "the any type is prohibited";
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (violation) throw new Error(`Generated program is not a bounded isolated candidate: ${filePath}: ${violation}.`);
}

function runtimeModuleSource(source: string): string {
  const emitted = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return emitted.replace(/(["'])(\.\.?\/[^"']+)\.ts\1/gu, "$1$2.mjs$1");
}

async function buildVerifiedProgramCandidate(
  handoff: ExecutorHandoff,
  proposal: ProgramCandidateProposal,
  genomeLabRoot: string,
  candidateId: string,
  experimentalCompilerCache?: ExperimentalCompilerCache,
): Promise<GeneratedSkillCandidate> {
  validateProgramCandidateStructure(proposal);
  const allPaths = new Set(proposal.files.map((file) => file.path));
  for (const file of proposal.files) assertBoundedProgramSource(file.path, file.content, allPaths);

  await mkdir(genomeLabRoot, { recursive: true, mode: 0o700 });
  const artifactDirectory = join(genomeLabRoot, candidateId);
  await mkdir(artifactDirectory, { recursive: false, mode: 0o700 });
  try {
    const projectDirectory = join(artifactDirectory, "project");
    const runtimeDirectory = join(artifactDirectory, "runtime");
    await Promise.all([
      mkdir(projectDirectory, { recursive: true, mode: 0o700 }),
      mkdir(runtimeDirectory, { recursive: true, mode: 0o700 }),
    ]);
    const projectFiles: string[] = [];
    const runtimeFiles: string[] = [];
    const runtimeTests: string[] = [];
    for (const file of proposal.files) {
      const projectPath = join(projectDirectory, file.path);
      const runtimePath = join(runtimeDirectory, file.path.replace(/\.ts$/u, ".mjs"));
      await Promise.all([
        mkdir(dirname(projectPath), { recursive: true, mode: 0o700 }),
        mkdir(dirname(runtimePath), { recursive: true, mode: 0o700 }),
      ]);
      await Promise.all([
        writeFile(projectPath, file.content, { encoding: "utf8", mode: 0o600 }),
        writeFile(runtimePath, runtimeModuleSource(file.content), { encoding: "utf8", mode: 0o600 }),
      ]);
      projectFiles.push(projectPath);
      runtimeFiles.push(runtimePath);
      if (file.path.startsWith("tests/")) runtimeTests.push(runtimePath);
    }
    const diagnostics = semanticDiagnostics(projectFiles, experimentalCompilerCache);
    if (diagnostics.length > 0) {
      throw new Error(`Generated program failed TypeScript verification with ${diagnostics.length} error(s).`);
    }
    const runtimeVerifierPath = join(runtimeDirectory, "program-verification.mjs");
    await writeFile(
      runtimeVerifierPath,
      `${runtimeTests.map((path) => `import ${JSON.stringify(`./${path.slice(runtimeDirectory.length + 1).replaceAll("\\", "/")}`)};`).join("\n")}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    const allowedRuntimeFiles = [...runtimeFiles, runtimeVerifierPath]
      .flatMap((path) => ["--allow-fs-read", path]);
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "--permission",
        ...allowedRuntimeFiles,
        "--max-old-space-size=64",
        runtimeVerifierPath,
      ],
      {
        cwd: runtimeDirectory,
        env: { NODE_NO_WARNINGS: "1" },
        timeout: 5_000,
        maxBuffer: 128 * 1024,
        encoding: "utf8",
      },
    );
    const verification = {
      result: "PASS",
      command: "kernel:isolated-typescript-program-verification",
      exitCode: 0,
      stdout: stdout.trim().slice(0, 64 * 1024),
      stderr: stderr.trim().slice(0, 64 * 1024),
      sourceFiles: proposal.files.filter((file) => file.path.startsWith("src/")).length,
      testFiles: runtimeTests.length,
      typescriptVersion: ts.version,
      networkAuthority: false,
      filesystemWriteAuthority: false,
      productionAuthority: false,
    } as const;
    const manifest = {
      schemaVersion: 1,
      kind: "generated_typescript_program_candidate",
      generatorAuthority: "untrusted_candidate",
      objective: handoff.objective,
      acceptanceCriteria: handoff.acceptanceCriteria,
      programName: proposal.programName,
      summary: proposal.summary.trim(),
      limitations: proposal.limitations,
      files: proposal.files.map((file) => ({ path: file.path, contentDigest: sha256(file.content) })),
      maximumBudgetUsd: handoff.maximumBudgetUsd,
      constitutionDigest: handoff.constitutionDigest,
      dependencyPolicy: "no_external_dependencies",
      productionAuthority: false,
    } as const;
    await Promise.all([
      writeFile(join(artifactDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 }),
      writeFile(join(artifactDirectory, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`, { mode: 0o600 }),
    ]);
    return {
      artifactDirectory,
      artifactRelativePath: join("genome-lab", candidateId),
      candidateDigest: await digestArtifactTree(artifactDirectory),
      verificationOutputDigest: sha256(canonicalJson(verification)),
    };
  } catch (error) {
    await rm(artifactDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function buildVerifiedSkillCandidate(
  handoff: ExecutorHandoff,
  proposal: CandidateProposal,
  genomeLabRoot: string,
  candidateId: string,
  experimentalCompilerCache?: ExperimentalCompilerCache,
): Promise<GeneratedSkillCandidate> {
  if (!UUID_V4.test(candidateId)) throw new Error("Genome Lab candidate id must be a UUID v4.");
  if (isProgramCandidate(proposal)) {
    return buildVerifiedProgramCandidate(handoff, proposal, genomeLabRoot, candidateId, experimentalCompilerCache);
  }
  validateSkillCandidateProposal(proposal);
  assertPureSkillSource(proposal.source);
  await mkdir(genomeLabRoot, { recursive: true, mode: 0o700 });
  const artifactDirectory = join(genomeLabRoot, candidateId);
  await mkdir(artifactDirectory, { recursive: false, mode: 0o700 });
  try {
    const skillPath = join(artifactDirectory, "skill.ts");
    const verificationPath = join(artifactDirectory, "verification.ts");
    const manifest = {
      schemaVersion: 1,
      kind: "generated_skill_candidate",
      generatorAuthority: "untrusted_candidate",
      objective: handoff.objective,
      acceptanceCriteria: handoff.acceptanceCriteria,
      skillName: proposal.skillName,
      summary: proposal.summary.trim(),
      limitations: proposal.limitations,
      ...(proposal.operational
        ? { operational: compileOperationalSkillProvenance(proposal.operational) }
        : {}),
      testNames: proposal.tests.map((test) => test.name),
      maximumBudgetUsd: handoff.maximumBudgetUsd,
      constitutionDigest: handoff.constitutionDigest,
      productionAuthority: false,
    } as const;
    const verifier = verificationSource(proposal);
    await Promise.all([
      writeFile(skillPath, proposal.source, { encoding: "utf8", mode: 0o600 }),
      writeFile(verificationPath, verifier, { encoding: "utf8", mode: 0o600 }),
      writeFile(join(artifactDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      }),
    ]);
    const diagnostics = semanticDiagnostics([skillPath, verificationPath]);
    if (diagnostics.length > 0) {
      throw new Error(`Generated skill failed TypeScript verification with ${diagnostics.length} error(s).`);
    }
    const runtimeDirectory = join(artifactDirectory, "runtime");
    await mkdir(runtimeDirectory, { mode: 0o700 });
    const runtimeSkill = ts.transpileModule(proposal.source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const runtimeVerification = ts.transpileModule(verifier.replace("./skill.ts", "./skill.mjs"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const runtimeSkillPath = join(runtimeDirectory, "skill.mjs");
    const runtimeVerificationPath = join(runtimeDirectory, "verification.mjs");
    await Promise.all([
      writeFile(runtimeSkillPath, runtimeSkill, { encoding: "utf8", mode: 0o600 }),
      writeFile(runtimeVerificationPath, runtimeVerification, { encoding: "utf8", mode: 0o600 }),
    ]);
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--permission", `--allow-fs-read=${runtimeDirectory}`, "--max-old-space-size=64", runtimeVerificationPath],
      {
        cwd: runtimeDirectory,
        env: { NODE_NO_WARNINGS: "1" },
        timeout: 3_000,
        maxBuffer: 64 * 1024,
        encoding: "utf8",
      },
    );
    const verification = {
      result: "PASS",
      command: "kernel:isolated-typescript-behavioral-verification",
      exitCode: 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      tests: proposal.tests.length,
      typescriptVersion: ts.version,
    } as const;
    await writeFile(join(artifactDirectory, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return {
      artifactDirectory,
      artifactRelativePath: join("genome-lab", candidateId),
      candidateDigest: await digestArtifactTree(artifactDirectory),
      verificationOutputDigest: sha256(canonicalJson(verification)),
    };
  } catch (error) {
    await rm(artifactDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyGenomeLabArtifact(
  stateDirectory: string,
  artifactRelativePath: string,
  expectedDigest: string,
): Promise<void> {
  const parts = artifactRelativePath.split(/[\\/]/);
  if (parts.length !== 2 || parts[0] !== "genome-lab" || !UUID_V4.test(parts[1])) {
    throw new Error("Genome Lab artifact path is outside the protected candidate namespace.");
  }
  const artifactDirectory = join(stateDirectory, parts[0], parts[1]);
  const [manifestText, observedDigest] = await Promise.all([
    readFile(join(artifactDirectory, "manifest.json"), "utf8"),
    digestArtifactTree(artifactDirectory),
  ]);
  const manifest = JSON.parse(manifestText) as { kind?: unknown; productionAuthority?: unknown };
  if (manifest.productionAuthority !== false) {
    throw new Error("Genome Lab artifacts must explicitly deny candidate production authority.");
  }
  if (manifest.kind === "generated_skill_candidate") {
    const source = await readFile(join(artifactDirectory, "skill.ts"), "utf8");
    if (!source.trim()) throw new Error("Genome Lab skill source is empty.");
    const verification = JSON.parse(await readFile(join(artifactDirectory, "verification.json"), "utf8")) as {
      result?: unknown;
      exitCode?: unknown;
      command?: unknown;
    };
    if (
      verification.result !== "PASS" ||
      verification.exitCode !== 0 ||
      verification.command !== "kernel:isolated-typescript-behavioral-verification"
    ) {
      throw new Error("Generated skill candidate lacks a valid kernel verification record.");
    }
  } else if (manifest.kind === "generated_typescript_program_candidate") {
    const verification = JSON.parse(await readFile(join(artifactDirectory, "verification.json"), "utf8")) as {
      result?: unknown;
      exitCode?: unknown;
      command?: unknown;
      networkAuthority?: unknown;
      filesystemWriteAuthority?: unknown;
      productionAuthority?: unknown;
    };
    if (
      verification.result !== "PASS" ||
      verification.exitCode !== 0 ||
      verification.command !== "kernel:isolated-typescript-program-verification" ||
      verification.networkAuthority !== false ||
      verification.filesystemWriteAuthority !== false ||
      verification.productionAuthority !== false
    ) {
      throw new Error("Generated program candidate lacks a valid isolated kernel verification record.");
    }
    const projectEntries = await readdir(join(artifactDirectory, "project"));
    if (projectEntries.length === 0) throw new Error("Genome Lab program source is empty.");
  } else if (manifest.kind !== "skill_scaffold") {
    throw new Error("Genome Lab artifact kind is unsupported.");
  }
  if (observedDigest !== expectedDigest) {
    throw new Error("Genome Lab artifact no longer matches its verified candidate digest.");
  }
}

export const verifyDeterministicSkillScaffold = verifyGenomeLabArtifact;

export async function buildDeterministicSkillScaffold(
  handoff: ExecutorHandoff,
  genomeLabRoot: string,
  candidateId: string,
): Promise<GeneratedSkillCandidate> {
  if (!UUID_V4.test(candidateId)) throw new Error("Genome Lab candidate id must be a UUID v4.");
  await mkdir(genomeLabRoot, { recursive: true, mode: 0o700 });
  const artifactDirectory = join(genomeLabRoot, candidateId);
  await mkdir(artifactDirectory, { recursive: false, mode: 0o700 });

  const manifest = {
    schemaVersion: 1,
    kind: "skill_scaffold",
    jobId: handoff.jobId,
    objective: handoff.objective,
    acceptanceCriteria: handoff.acceptanceCriteria,
    missingCapabilities: handoff.missingCapabilities,
    maximumBudgetUsd: handoff.maximumBudgetUsd,
    constitutionDigest: handoff.constitutionDigest,
    productionAuthority: false,
  } as const;
  const source = [
    `export const skillGenome = ${JSON.stringify(manifest, null, 2)} as const;`,
    "",
    "export type SkillScaffoldResult = { status: \"scaffold_ready\"; objective: string };",
    "",
    "export function runSkillScaffold(): SkillScaffoldResult {",
    "  return { status: \"scaffold_ready\", objective: skillGenome.objective };",
    "}",
    "",
  ].join("\n");
  const skillPath = join(artifactDirectory, "skill.ts");
  await writeFile(skillPath, source, { encoding: "utf8", mode: 0o600 });
  await writeFile(join(artifactDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const emittedOutput: string[] = [];
  const program = ts.createProgram([skillPath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    skipLibCheck: true,
    noEmitOnError: true,
  });
  const emitResult = program.emit(undefined, (_fileName, data) => emittedOutput.push(data));
  const errors = [...ts.getPreEmitDiagnostics(program), ...emitResult.diagnostics].filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw new Error(`Generated skill scaffold failed TypeScript verification with ${errors.length} error(s).`);
  }
  return {
    artifactDirectory,
    artifactRelativePath: join("genome-lab", candidateId),
    candidateDigest: await digestArtifactTree(artifactDirectory),
    verificationOutputDigest: sha256(
      canonicalJson({ typescriptVersion: ts.version, diagnostics: [], emittedOutput }),
    ),
  };
}
