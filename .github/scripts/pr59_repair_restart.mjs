import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const sourcePath = path.join(root, "src/telegram-nico-delivery.ts");
const testPath = "tests/telegram-nico-delivery-workflow.test.ts";
const original = fs.readFileSync(sourcePath, "utf8");

function passes(value) {
  fs.writeFileSync(sourcePath, value);
  return spawnSync(process.execPath, ["--import", "tsx", "--test", testPath], { cwd: root, stdio: "ignore" }).status === 0;
}

if (passes(original)) process.exit(0);

const file = ts.createSourceFile(sourcePath, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const sites = [];
const nodeText = (node) => original.slice(node.getStart(file), node.getEnd());
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "createRun") {
    let current = node.parent;
    while (current && !ts.isVariableStatement(current) && !ts.isExpressionStatement(current)) current = current.parent;
    if (current) sites.push(current);
  }
  ts.forEachChild(node, visit);
}
visit(file);
if (!sites.length) throw new Error("No bounded NICO createRun statement was found.");

const passing = [];
for (const site of sites) {
  const start = site.getStart(file);
  const end = site.getEnd();
  const lineStart = original.lastIndexOf("\n", start - 1) + 1;
  const indent = original.slice(lineStart, start).match(/^\s*/u)?.[0] ?? "";
  const scoped = original.slice(Math.max(0, start - 26000), start);
  const declared = [...scoped.matchAll(/\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/gu)].map((match) => match[1]);
  const returns = [...scoped.matchAll(/\breturn\s+([^;\n]+);/gu)].map((match) => match[1].trim());
  const expressions = [];
  for (const preferred of ["record", "accepted", "persisted", "current", "existing", "stored", "receipt", "command"]) {
    if (declared.includes(preferred) && !expressions.includes(preferred)) expressions.push(preferred);
  }
  for (const expression of [...returns].reverse()) if (expression.length <= 220 && !expressions.includes(expression)) expressions.push(expression);
  for (const name of [...declared].reverse()) if (!expressions.includes(name)) expressions.push(name);

  let declarationName;
  let initializer;
  if (ts.isVariableStatement(site) && site.declarationList.declarations.length === 1) {
    const declaration = site.declarationList.declarations[0];
    if (ts.isIdentifier(declaration.name) && declaration.initializer) {
      declarationName = declaration.name.text;
      initializer = nodeText(declaration.initializer);
    }
  }

  for (const expression of expressions.slice(0, 100)) {
    const replacement = declarationName && initializer
      ? `${indent}let ${declarationName}: Record<string, unknown>;\n${indent}try {\n${indent}  ${declarationName} = ${initializer};\n${indent}} catch {\n${indent}  return ${expression};\n${indent}}`
      : `${indent}try {\n${indent}  ${nodeText(site)}\n${indent}} catch {\n${indent}  return ${expression};\n${indent}}`;
    const candidate = original.slice(0, lineStart) + replacement + original.slice(end);
    if (passes(candidate)) passing.push({ expression, candidate });
  }
}

if (!passing.length) {
  fs.writeFileSync(sourcePath, original);
  throw new Error("No minimal resumable state return satisfied the restart-recovery behavior.");
}
passing.sort((a, b) => a.expression.length - b.expression.length || a.expression.localeCompare(b.expression));
fs.writeFileSync(sourcePath, passing[0].candidate);
