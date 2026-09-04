import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value);

// Give moving branch/tag/path targets a precise fail-closed diagnostic.
{
  const relative = "src/github-exact-target-verifier.ts";
  let source = read(relative);
  const marker = '  const parts = url.pathname.split("/").filter(Boolean);\n';
  const guard = '  if (parts.length > 2) {\n';
  if (!source.includes(guard)) {
    if (!source.includes(marker)) throw new Error("Exact GitHub target parser marker was not found.");
    source = source.replace(marker, marker + '  if (parts.length > 2) {\n    throw new Error("Use the canonical GitHub repository URL without a branch, tag, path, query, or fragment.");\n  }\n');
    write(relative, source);
  }
}

// Remove only the unique verified extra parenthesis if the verifier test does not parse.
{
  const relative = "tests/nico-automated-package-verifier.test.ts";
  const absolute = path.join(root, relative);
  const parse = spawnSync("npx", ["--no-install", "esbuild", absolute, "--platform=node", "--format=esm", "--outfile=/tmp/pr59-verifier.js"], { stdio: "ignore" });
  if (parse.status !== 0) {
    const source = read(relative);
    const lines = source.split(/(?<=\n)/u);
    if (lines.length <= 73) throw new Error("Verified package-verifier syntax location is absent.");
    const line = lines[73];
    const candidates = [];
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== ")") continue;
      const trialLines = [...lines];
      trialLines[73] = line.slice(0, index) + line.slice(index + 1);
      const trial = trialLines.join("");
      fs.writeFileSync("/tmp/pr59-verifier-candidate.test.ts", trial);
      const result = spawnSync("npx", ["--no-install", "esbuild", "/tmp/pr59-verifier-candidate.test.ts", "--platform=node", "--format=esm", "--outfile=/tmp/pr59-verifier-candidate.js"], { stdio: "ignore" });
      if (result.status === 0) candidates.push(trial);
    }
    if (candidates.length !== 1) throw new Error(`Package-verifier syntax repair was not unique: ${candidates.length}.`);
    write(relative, candidates[0]);
  }
}

// Test doubles must compare exact Google hosts, never attacker-controlled substrings.
{
  const relative = "tests/gmail-verified-report-sender.test.ts";
  let source = read(relative);
  for (const host of ["oauth2.googleapis.com", "openidconnect.googleapis.com", "gmail.googleapis.com"]) {
    const escaped = host.replaceAll(".", "\\.");
    source = source.replace(new RegExp(`([A-Za-z_$][A-Za-z0-9_$]*)\\.includes\\([\"']${escaped}[\"']\\)`, "gu"), `new URL($1).hostname === ${JSON.stringify(host)}`);
  }
  if (/\.includes\(["'](?:oauth2|openidconnect|gmail)\.googleapis\.com["']\)/u.test(source)) throw new Error("Unsafe Google host substring comparison remains.");
  write(relative, source);
}

// OAuth values are credentials/configuration, not material for a fast durable hash.
{
  const relative = "src/telegram-nico-production.ts";
  let source = read(relative);
  const file = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sensitive = ["SARA_GMAIL_OAUTH_CLIENT_ID", "SARA_GMAIL_OAUTH_REDIRECT_URI"];
  const replacement = JSON.stringify(crypto.createHash("sha256").update("sara-gmail-oauth-runtime-schema-v1").digest("hex"));
  const edits = [];
  const text = (node) => source.slice(node.getStart(file), node.getEnd());
  const unsafe = (value) => sensitive.some((name) => value.includes(name)) && /(?:createHash|sha256|digest|hash)/iu.test(value);
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && unsafe(text(node.initializer))) edits.push([node.initializer.getStart(file), node.initializer.getEnd(), replacement]);
    if (ts.isReturnStatement(node) && node.expression && unsafe(text(node.expression))) edits.push([node.expression.getStart(file), node.expression.getEnd(), replacement]);
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) source = source.slice(0, start) + value + source.slice(end);
  if (sensitive.some((name) => new RegExp(`(?:createHash|sha256|digest|hash)[\\s\\S]{0,800}${name}|${name}[\\s\\S]{0,800}(?:createHash|sha256|digest|hash)`, "iu").test(source))) {
    throw new Error("OAuth configuration still flows into a fast hash.");
  }
  if (!source.includes("createHash(")) {
    source = source.replace(/import\s*\{\s*createHash\s*\}\s*from\s*["']node:crypto["'];\s*/u, "");
    source = source.replace(/import\s*\{\s*createHash\s*,\s*/u, "import { ");
    source = source.replace(/,\s*createHash\s*\}/u, " }");
  }
  write(relative, source);
}

// NICO production accepts only comprun_<32 lowercase hex> identities.
{
  const relative = "src/telegram-nico-delivery.ts";
  let source = read(relative);
  const file = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && /NicoRunId/u.test(node.name.text)) {
      function nested(child) {
        if (ts.isStringLiteral(child) && child.text.startsWith("nico_") && !child.text.startsWith("comprun_")) {
          edits.push([child.getStart(file), child.getEnd(), JSON.stringify(child.text.replace(/^nico_/u, "comprun_"))]);
        }
        ts.forEachChild(child, nested);
      }
      nested(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) source = source.slice(0, start) + value + source.slice(end);
  if (!source.includes("comprun_")) throw new Error("Production NICO run identity prefix is absent.");
  write(relative, source);
}
