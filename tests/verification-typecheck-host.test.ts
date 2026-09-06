import assert from "node:assert/strict";
import { test } from "node:test";
import * as ts from "typescript";
import { mkdtemp, writeFile, readFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FreshTypecheckCompilerHost, verifyCanaryProgramCandidate } from "../src/verification-typecheck-host.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { candidate, context } from "./helpers/repair-memory-fixture.ts";

const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true,
  allowImportingTsExtensions: true };

function diagnostics(files: string[], current: ts.CompilerOptions, optimized: boolean) {
  const host = optimized ? new FreshTypecheckCompilerHost().createHost(current) : ts.createCompilerHost(current);
  return ts.getPreEmitDiagnostics(ts.createProgram(files, current, host)).map(d => ({ code: d.code, category: d.category,
    file: d.file?.fileName, start: d.start, length: d.length, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") }));
}

test("the type-error parser mode does not change compiler options or activate an AST/result cache", () => {
  const before = structuredClone(options), factory = new FreshTypecheckCompilerHost();
  const a = factory.createHost(options), b = factory.createHost(options);
  assert.notEqual(a, b); assert.equal(a.jsDocParsingMode, ts.JSDocParsingMode.ParseForTypeErrors);
  assert.equal(b.jsDocParsingMode, ts.JSDocParsingMode.ParseForTypeErrors);
  assert.deepEqual(options, before); assert.equal(factory.snapshot().entries, 0);
});

test("source objects are freshly parsed and changed or deleted files are not recalled", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-doc-host-"));
  try {
    const path = join(root, "file.ts"); await writeFile(path, "export const n: number = 1;");
    const factory = new FreshTypecheckCompilerHost(), a = factory.createHost(options), b = factory.createHost(options);
    const one = a.getSourceFile(path, ts.ScriptTarget.ES2022)!;
    const two = b.getSourceFile(path, ts.ScriptTarget.ES2022)!;
    assert.notEqual(one, two); assert.notEqual(one.statements[0], two.statements[0]);
    await writeFile(path, 'export const n: number = "bad";');
    assert.match(a.getSourceFile(path, ts.ScriptTarget.ES2022)!.text, /bad/);
    assert(diagnostics([path], options, true).some(d => d.code === 2322));
    await unlink(path); assert.equal(a.getSourceFile(path, ts.ScriptTarget.ES2022), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const examples = [
  { name: "typescript documentation", extension: "ts", source: '/** Documentation without type effects. */\nexport const n: number = 17;', error: false },
  { name: "explicit type mismatch behind documentation", extension: "ts", source: '/** @param value Documentation. */\nexport const n: number = "wrong";', error: true },
  { name: "unused expect-error directive", extension: "ts", source: '// @ts-expect-error\nexport const n: number = 17;', error: true },
  { name: "link and see diagnostics", extension: "ts", source: '/** @see MissingSymbol\n * {@link AnotherMissingSymbol} */\nexport const n: number = "bad";', error: true },
  { name: "generic overloads", extension: "ts", source: 'export function id<T extends string>(x: T): T;\nexport function id(x: string) { return x; }\nid(42);', error: true },
  { name: "javascript type tag", extension: "js", source: '/** @type {number} */\nexport const n = "bad";', error: true },
  { name: "javascript typedef and param tags", extension: "js", source: '/** @typedef {{count:number}} Row */\n/** @param {Row} row */\nexport function count(row) { return row.count; }\ncount({count:"bad"});', error: true },
  { name: "javascript satisfies", extension: "js", source: '/** @satisfies {{count:number}} */\nexport const row = {count:"bad"};', error: true },
  { name: "javascript valid typed function", extension: "js", source: '/** @param {number} n\n * @returns {number} */\nexport function add(n) { return n + 1; }', error: false },
];
for (const example of examples) test(`all default compiler diagnostics match: ${example.name}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-doc-equivalence-"));
  try {
    const path = join(root, `file.${example.extension}`); await writeFile(path, example.source);
    const config = { ...options, allowJs: true, checkJs: true };
    const baseline = diagnostics([path], config, false), current = diagnostics([path], config, true);
    assert.deepEqual(current, baseline); assert.equal(current.length > 0, example.error);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("changed declarations receive new semantic checks rather than old diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-doc-declarations-"));
  try {
    const source = join(root, "file.ts"), declaration = join(root, "dep.d.ts");
    await writeFile(source, 'import {value} from "./dep";\nexport const n: number = value;');
    await writeFile(declaration, '/** prose */\nexport declare const value: number;');
    assert.deepEqual(diagnostics([source], options, true), diagnostics([source], options, false));
    await writeFile(declaration, '/** prose */\nexport declare const value: string;');
    const bad = diagnostics([source], options, true);
    assert(bad.some(d => d.code === 2322)); assert.deepEqual(bad, diagnostics([source], options, false));
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const kind of ["correct", "behavior", "type", "syntax", "policy", "structure", "node-test"] as const) {
  test(`unchanged full verifier agrees with canary: ${kind}`, async () => {
    const c = candidate(true);
    c.files[1].content = "/** Ordinary documentation, not cached acceptance. */\n" + c.files[1].content;
    if (kind === "behavior") c.files[1].content = candidate(false).files[1].content;
    if (kind === "type") c.files[1].content = 'export const value: number = "bad";\n';
    if (kind === "syntax") c.files[1].content = 'export const value: number = ;\n';
    if (kind === "policy") c.files[1].content = 'export const value = [17][0];\n';
    if (kind === "structure") c.files.pop();
    if (kind === "node-test") c.files[2].content = 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { value } from "../src/value.ts";\ntest("accepted", () => assert.equal(value, 17));\n';
    const original = structuredClone(c);
    const before = await verifyGenomeLabProgramCandidate({ candidate: c, ...context });
    const after = await verifyCanaryProgramCandidate({ candidate: c, ...context });
    assert.deepEqual(after, before); assert.deepEqual(c, original);
    assert.equal(after.passed, kind === "correct" || kind === "node-test");
  });
}

test("canary-only routing and the new implementation identity are explicit", async () => {
  const server = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(server, /mode === "canary"\s*\? verifyCanaryProgramCandidate : verifyGenomeLabProgramCandidate/u);
  const scope = await readFile(new URL("../src/coding-repair-memory.ts", import.meta.url), "utf8");
  assert.match(scope, /"verification-typecheck-host.ts"/u);
});
