import * as ts from "typescript";
import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingRepairSourceChangeSummary } from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

const MAX_SOURCE_CHANGE_SUMMARIES = 6;
const MAX_SIGNALS_PER_DIRECTION = 24;
const DIGEST = /^[a-f0-9]{64}$/u;
const SOURCE_PATH = /^src\/[a-zA-Z0-9][a-zA-Z0-9._/-]{0,235}\.(?:ts|tsx)$/u;
const SIGNAL = /^(?:syntax|call|new|operator):[A-Za-z0-9_.$<>=!&|?%*+/-]{1,64}:[+-][1-9]\d{0,2}$/u;
const STATIC_CALLS = new Set([
  "Array.from",
  "Array.isArray",
  "JSON.parse",
  "JSON.stringify",
  "Math.abs",
  "Math.ceil",
  "Math.floor",
  "Math.max",
  "Math.min",
  "Math.round",
  "Number.isFinite",
  "Number.isInteger",
  "Number.isNaN",
  "Object.entries",
  "Object.fromEntries",
  "Object.keys",
  "Object.values",
  "Promise.all",
  "Promise.allSettled",
]);
const GLOBAL_CALLS = new Set([
  "clearInterval",
  "clearTimeout",
  "fetch",
  "parseFloat",
  "parseInt",
  "queueMicrotask",
  "setInterval",
  "setTimeout",
]);
const METHOD_CALLS = new Set([
  "abort",
  "every",
  "filter",
  "find",
  "flatMap",
  "includes",
  "map",
  "reduce",
  "some",
  "sort",
]);
const SAFE_CONSTRUCTORS = new Set([
  "AggregateError",
  "Error",
  "Map",
  "RangeError",
  "Set",
  "TypeError",
]);

const INTERESTING_SYNTAX = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.AwaitExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.SpreadElement,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
]);

function assertDigest(value: string, label: string): string {
  if (!DIGEST.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  return value;
}

function boundedSignals(values: readonly string[]): string[] {
  const signals = [...new Set(values)].sort().slice(0, MAX_SIGNALS_PER_DIRECTION);
  if (signals.some((signal) => !SIGNAL.test(signal))) {
    throw new Error("Coding repair source summary contains a malformed signal.");
  }
  return signals;
}

function callName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return GLOBAL_CALLS.has(expression.text) ? expression.text : "local";
  }
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const property = expression.name.text;
  if (ts.isIdentifier(expression.expression)) {
    const qualified = `${expression.expression.text}.${property}`;
    if (STATIC_CALLS.has(qualified)) return qualified;
  }
  return METHOD_CALLS.has(property) ? property : "method";
}

function constructorName(expression: ts.Expression): string | null {
  if (!ts.isIdentifier(expression)) return null;
  return SAFE_CONSTRUCTORS.has(expression.text) ? expression.text : "local";
}

function addSignal(signals: Map<string, number>, signal: string): void {
  if (signal.length > 72) return;
  signals.set(signal, (signals.get(signal) ?? 0) + 1);
}

function collectSignals(path: string, content: string): Map<string, number> {
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.ES2022,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const signals = new Map<string, number>();

  const visit = (node: ts.Node): void => {
    if (INTERESTING_SYNTAX.has(node.kind)) {
      addSignal(signals, `syntax:${String(ts.SyntaxKind[node.kind])}`);
    }
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (name) addSignal(signals, `call:${name}`);
    }
    if (ts.isNewExpression(node)) {
      const name = constructorName(node.expression);
      if (name) addSignal(signals, `new:${name}`);
    }
    if (ts.isBinaryExpression(node)) {
      addSignal(signals, `operator:${node.operatorToken.getText(sourceFile)}`);
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      const operator = ts.tokenToString(node.operator);
      if (operator) addSignal(signals, `operator:${operator}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return signals;
}

function signalDelta(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): { addedSignals: string[]; removedSignals: string[] } {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  const addedSignals: string[] = [];
  const removedSignals: string[] = [];
  for (const key of keys) {
    const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0);
    if (delta > 0) addedSignals.push(`${key}:+${delta}`);
    if (delta < 0) removedSignals.push(`${key}:-${Math.abs(delta)}`);
  }
  return {
    addedSignals: boundedSignals(addedSignals),
    removedSignals: boundedSignals(removedSignals),
  };
}

function normalizeSummary(
  summary: CodingRepairSourceChangeSummary,
): CodingRepairSourceChangeSummary {
  if (!SOURCE_PATH.test(summary.path) || summary.path.includes("..")) {
    throw new Error("Coding repair source summary path is not a bounded source file.");
  }
  const core = {
    schemaVersion: 1 as const,
    path: summary.path,
    beforeContentDigest: assertDigest(summary.beforeContentDigest, "beforeContentDigest"),
    afterContentDigest: assertDigest(summary.afterContentDigest, "afterContentDigest"),
    addedSignals: boundedSignals(summary.addedSignals),
    removedSignals: boundedSignals(summary.removedSignals),
  };
  return {
    ...core,
    signalDigest: sha256(canonicalJson(core)),
  };
}

export function normalizeCodingRepairSourceChanges(
  summaries: readonly CodingRepairSourceChangeSummary[],
): CodingRepairSourceChangeSummary[] {
  return summaries
    .slice(0, MAX_SOURCE_CHANGE_SUMMARIES)
    .map((summary) => normalizeSummary(structuredClone(summary)))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function digestCodingRepairSourceChanges(
  summaries: readonly CodingRepairSourceChangeSummary[],
): string {
  return sha256(canonicalJson(normalizeCodingRepairSourceChanges(summaries)));
}

export function summarizeCodingRepairSourceChanges(input: {
  before: ProgramCandidateProposal;
  after: ProgramCandidateProposal;
  changedPaths: readonly string[];
}): CodingRepairSourceChangeSummary[] {
  const beforeFiles = new Map(input.before.files.map((file) => [file.path, file.content]));
  const afterFiles = new Map(input.after.files.map((file) => [file.path, file.content]));
  const paths = [...new Set(input.changedPaths)]
    .filter((path) => SOURCE_PATH.test(path) && !path.includes(".."))
    .sort()
    .slice(0, MAX_SOURCE_CHANGE_SUMMARIES);

  return normalizeCodingRepairSourceChanges(paths.map((path) => {
    const beforeContent = beforeFiles.get(path);
    const afterContent = afterFiles.get(path);
    if (beforeContent === undefined || afterContent === undefined) {
      throw new Error("Coding repair source summary references a missing candidate file.");
    }
    const delta = signalDelta(
      collectSignals(path, beforeContent),
      collectSignals(path, afterContent),
    );
    return {
      schemaVersion: 1,
      path,
      beforeContentDigest: sha256(beforeContent),
      afterContentDigest: sha256(afterContent),
      ...delta,
      signalDigest: "0".repeat(64),
    };
  }));
}
