import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as ts from "typescript";
import { FreshTypecheckHost, codingTypecheckHost } from "../src/fresh-typecheck-host.ts";
import { ExperimentalCompilerCache } from "../src/experimental-compiler-cache.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { candidate, context } from "./helpers/repair-memory-fixture.ts";

const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, skipLibCheck: true,
  allowImportingTsExtensions: true, allowJs: true, checkJs: true, types: [], lib: ["lib.es2022.d.ts"] };
const normalized = (program: ts.Program, root: string) => ts.getPreEmitDiagnostics(program).map(d => ({
  category: d.category, code: d.code, file: d.file?.fileName.replace(root, "ROOT"), start: d.start, length: d.length,
  message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
}));
async function pair(files: Record<string, string>, expectedError: boolean, extra: ts.CompilerOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "sara-jsdoc-equivalence-"));
  try {
    for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
    const settings = { ...options, ...extra }, paths = Object.keys(files).map(f => join(root, f));
    const old = ts.createProgram(paths, settings, ts.createCompilerHost(settings));
    const current = ts.createProgram(paths, settings, new FreshTypecheckHost().createHost(settings));
    const expected = normalized(old, root);
    assert.equal(expected.some(d => d.category === ts.DiagnosticCategory.Error), expectedError, JSON.stringify(expected));
    assert.deepEqual(normalized(current, root), expected);
    assert.notEqual(old.getTypeChecker(), current.getTypeChecker());
    return { old, current, root };
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("only canary selects the type-error-preserving host and never ParseNone", () => {
  assert.equal(codingTypecheckHost("off"), undefined);
  assert.equal(codingTypecheckHost("shadow"), undefined);
  const a = codingTypecheckHost("canary")!, b = codingTypecheckHost("canary")!;
  assert.notEqual(a, b);
  assert.equal(a.createHost(options).jsDocParsingMode, ts.JSDocParsingMode.ParseForTypeErrors);
  assert.equal(new ExperimentalCompilerCache().createHost(options).jsDocParsingMode, undefined);
});

test("plain TS documentation is omitted but see/link documentation remains", async () => {
  const { old, current, root } = await pair({ "value.ts": `/** Plain descriptive documentation. */
export const value: number = 17;
/** @see value */
export const seen: number = value;
/** Documentation with {@link value}. */
export const linked: number = value;
` }, false);
  const a = old.getSourceFile(join(root, "value.ts"))!, b = current.getSourceFile(join(root, "value.ts"))!;
  assert(ts.getJSDocCommentsAndTags(a.statements[0]).length > 0);
  assert.equal(ts.getJSDocCommentsAndTags(b.statements[0]).length, 0);
  for (const i of [1, 2]) assert(ts.getJSDocCommentsAndTags(b.statements[i]).length > 0);
});

test("TS annotations and declaration-module errors match with documentation present", async () => {
  await pair({ "types.d.ts": '/** Trusted explicit type. */ export interface Payload { count: number }',
    "value.ts": '/** Do not infer types from documentation. */\nimport type { Payload } from "./types.d.ts";\nexport const item: Payload = { count: "wrong" };' }, true);
});

test("syntax and unresolved imports retain exact locations and error codes", async () => {
  await pair({ "value.ts": '/** docs */\nimport { missing } from "./absent.ts";\nexport const bad: = missing;' }, true);
});

test("strict nullability, generics and overload diagnostics are preserved", async () => {
  await pair({ "value.ts": '/** docs */\nexport function first<T>(values: T[]): T | undefined { return values.at(0); }\nconst n: number = first([1]);\nexport const m: Map<string, number> = new Map([["x", "bad"]]);' }, true);
});

test("JSDoc type annotations in JavaScript are not skipped", async () => {
  await pair({ "value.js": '/** @type {number} */\nexport const value = "wrong";' }, true);
});

test("JavaScript parameter and return annotations still report wrong calls", async () => {
  await pair({ "value.js": '/** @param {number} n @returns {number} */\nexport function twice(n) { return n * 2; }\ntwice("wrong");' }, true);
});

test("JavaScript typedef/template annotations and valid generic calls match", async () => {
  await pair({ "value.js": '/** @typedef {{ value: number }} Box */\n/** @template T @param {T} x @returns {T} */\nexport function identity(x) { return x; }\n/** @type {Box} */\nexport const b = identity({value: 17});' }, false);
});

test("JavaScript satisfies/import JSDoc retains type errors across modules", async () => {
  await pair({ "types.d.ts": 'export interface Box { value: number }',
    "value.js": '/** @import { Box } from "./types.d.ts" */\n/** @satisfies {Box} */\nexport const box = { value: "wrong" };' }, true);
});

test("TS declaration merging and expect-error behavior are preserved", async () => {
  await pair({ "a.ts": '/** First */ interface Pair { x: number }\n',
    "b.ts": '/** Second */ interface Pair { x: string }\n// @ts-expect-error\nconst ok: number = "x";\n' }, true);
});

test("fresh hosts reread changed source and do not share mutable SourceFiles", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-fresh-host-"));
  try {
    const file = join(root, "value.ts"), cache = new FreshTypecheckHost();
    await writeFile(file, 'export const value: number = 17;');
    const first = ts.createProgram([file], options, cache.createHost(options));
    assert.equal(ts.getPreEmitDiagnostics(first).length, 0);
    const sf = first.getSourceFile(file)!;
    Reflect.set(sf, "statements", ts.factory.createNodeArray());
    const fresh = ts.createProgram([file], options, cache.createHost(options));
    assert.notEqual(fresh.getSourceFile(file), sf);
    assert.equal(fresh.getSourceFile(file)!.statements.length, 1);
    await writeFile(file, 'export const value: number = "x";');
    const changed = ts.createProgram([file], options, cache.createHost(options));
    assert(ts.getPreEmitDiagnostics(changed).some(d => d.code === 2322));
    assert.equal(cache.snapshot().entries, 0);
    assert.equal(cache.snapshot().hits, 0);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("current getSourceFile parse options and module-indicator callbacks run afresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-fresh-options-"));
  try {
    const file = join(root, "value.ts"); await writeFile(file, 'export const value = 17;');
    const host = new FreshTypecheckHost().createHost(options);
    let calls = 0;
    const settings: ts.CreateSourceFileOptions = { languageVersion: ts.ScriptTarget.ES2022,
      jsDocParsingMode: ts.JSDocParsingMode.ParseForTypeErrors,
      setExternalModuleIndicator: source => { calls++; Reflect.set(source, "externalModuleIndicator", calls % 2 ? source.statements[0] : undefined); } };
    const a = host.getSourceFile(file, settings)!;
    const b = host.getSourceFile(file, settings, undefined, true)!;
    assert.equal(calls, 2); assert.notEqual(a, b);
    assert(Reflect.get(a, "externalModuleIndicator")); assert.equal(Reflect.get(b, "externalModuleIndicator"), undefined);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("full actual verifier keeps independent correct, type-error, and behavior-error outcomes", async () => {
  const good = candidate(true), wrongType = candidate(true);
  wrongType.files[1].content = 'export const value: number = "17";';
  for (const c of [good, candidate(), wrongType, good]) {
    const a = await verifyGenomeLabProgramCandidate({ candidate: c, ...context });
    const b = await verifyGenomeLabProgramCandidate({ candidate: c, ...context, experimentalCompilerCache: new FreshTypecheckHost() });
    assert.deepEqual(b, a);
  }
});

test("an edited declaration is checked again instead of inheriting a previous PASS", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-fresh-declaration-"));
  try {
    const src = join(root, "value.ts"), dts = join(root, "types.d.ts"), host = new FreshTypecheckHost();
    await writeFile(src, 'import { value } from "./types"; export const checked: number = value;');
    await writeFile(dts, 'export declare const value: number;');
    assert.equal(ts.getPreEmitDiagnostics(ts.createProgram([src, dts], options, host.createHost(options))).length, 0);
    await writeFile(dts, 'export declare const value: string;');
    const next = ts.createProgram([src, dts], options, host.createHost(options));
    assert(ts.getPreEmitDiagnostics(next).some(d => d.code === 2322));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("source guards and hidden behavior errors are unchanged by the selected host", async () => {
  const policy = candidate(true), syntax = candidate(true);
  policy.files[1].content = 'export const value = [17][0];';
  syntax.files[1].content = 'export const value: = 17;';
  for (const c of [policy, syntax]) {
    const a = await verifyGenomeLabProgramCandidate({candidate: c, ...context});
    const b = await verifyGenomeLabProgramCandidate({candidate: c, ...context, experimentalCompilerCache: codingTypecheckHost("canary")});
    assert.equal(b.passed, false); assert.deepEqual(b, a);
    assert.equal(b.completedChecks.includes("behavior_tests"), false);
  }
});
