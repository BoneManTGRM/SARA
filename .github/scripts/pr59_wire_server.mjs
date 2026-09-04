import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const serverPath = path.join(root, "src/server.ts");
const productionPath = path.join(root, "src/telegram-nico-production.ts");
const httpPath = path.join(root, "src/telegram-nico-http.ts");
const testPath = path.join(root, "tests/telegram-nico-server-wiring.test.ts");
const bindingPath = path.join(root, "src/telegram-nico-server-binding.ts");

for (const required of [serverPath, productionPath, httpPath]) {
  if (!fs.existsSync(required)) throw new Error(`Required production source is missing: ${path.relative(root, required)}`);
}

function importedNames(testRelative, moduleFragment) {
  const absolute = path.join(root, testRelative);
  if (!fs.existsSync(absolute)) return [];
  const source = fs.readFileSync(absolute, "utf8");
  const file = ts.createSourceFile(absolute, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.includes(moduleFragment)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) names.push(element.name.text);
  }
  return names;
}

async function runtimeFunctionNames(relative) {
  const module = await import(pathToFileURL(path.join(root, relative)).href);
  return Object.entries(module).filter(([, value]) => typeof value === "function").map(([name]) => name);
}

function rank(names, imported, kind) {
  const unique = [...new Set(names)];
  const score = (name) => {
    let value = imported.includes(name) ? 1000 : 0;
    if (/^(create|build|load|from)/iu.test(name)) value += 120;
    if (/telegram/iu.test(name)) value += 80;
    if (/nico/iu.test(name)) value += 80;
    if (/production/iu.test(name)) value += kind === "production" ? 160 : 20;
    if (/(http|handler|bridge|runtime)/iu.test(name)) value += kind === "http" ? 150 : 80;
    if (/test|fake|mock/iu.test(name)) value -= 1000;
    return value;
  };
  return unique.sort((a, b) => score(b) - score(a) || a.localeCompare(b)).filter((name) => score(name) > 0);
}

const productionNames = rank(
  await runtimeFunctionNames("src/telegram-nico-production.ts"),
  importedNames("tests/telegram-nico-production.test.ts", "telegram-nico-production"),
  "production",
);
const httpNames = rank(
  await runtimeFunctionNames("src/telegram-nico-http.ts"),
  importedNames("tests/telegram-nico-http.test.ts", "telegram-nico-http"),
  "http",
);
if (!productionNames.length) throw new Error("No bounded Telegram NICO production factory export was found.");
if (!httpNames.length) throw new Error("No bounded Telegram NICO HTTP handler factory export was found.");

function bindingSource(productionName, httpName) {
  return `import type { IncomingMessage, ServerResponse } from "node:http";\nimport * as ProductionModule from "./telegram-nico-production.js";\nimport * as HttpModule from "./telegram-nico-http.js";\n\nconst PRODUCTION_FACTORY_NAME = ${JSON.stringify(productionName)};\nconst HTTP_FACTORY_NAME = ${JSON.stringify(httpName)};\nconst MAX_BODY_BYTES = 128 * 1024;\nlet cachedHandler: unknown;\n\ntype Callable = (...args: any[]) => unknown;\n\nfunction exactFunction(module: Record<string, unknown>, name: string): Callable {\n  const value = module[name];\n  if (typeof value !== "function") throw new Error("The configured Telegram NICO production binding is unavailable.");\n  return value as Callable;\n}\n\nfunction construct(factory: Callable, candidates: unknown[]): unknown {\n  let lastError: unknown;\n  for (const candidate of candidates) {\n    try {\n      const result = candidate === undefined ? factory() : factory(candidate);\n      if (result !== undefined && result !== null) return result;\n    } catch (error) {\n      lastError = error;\n    }\n  }\n  throw lastError instanceof Error ? lastError : new Error("The Telegram NICO production binding could not be initialized.");\n}\n\nfunction buildHandler(): unknown {\n  const environment = process.env;\n  const productionFactory = exactFunction(ProductionModule as Record<string, unknown>, PRODUCTION_FACTORY_NAME);\n  const production = construct(productionFactory, [\n    { env: environment, environment, processEnv: environment, fetchImpl: fetch },\n    environment,\n    undefined,\n  ]);\n  const httpFactory = exactFunction(HttpModule as Record<string, unknown>, HTTP_FACTORY_NAME);\n  const options = {\n    env: environment,\n    environment,\n    processEnv: environment,\n    production,\n    runtime: production,\n    workflow: production,\n    bridge: production,\n    dependencies: production,\n    fetchImpl: fetch,\n  };\n  return construct(httpFactory, [options, production, undefined]);\n}\n\nfunction selectedHandler(): unknown {\n  if (cachedHandler === undefined) cachedHandler = buildHandler();\n  return cachedHandler;\n}\n\nasync function bodyBytes(request: IncomingMessage): Promise<Uint8Array> {\n  const chunks: Buffer[] = [];\n  let total = 0;\n  for await (const chunk of request) {\n    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);\n    total += bytes.length;\n    if (total > MAX_BODY_BYTES) throw new Error("Telegram NICO request body exceeded the permitted size.");\n    chunks.push(bytes);\n  }\n  return new Uint8Array(Buffer.concat(chunks));\n}\n\nfunction requestHeaders(request: IncomingMessage): Headers {\n  const headers = new Headers();\n  for (const [name, raw] of Object.entries(request.headers)) {\n    if (raw === undefined) continue;\n    if (Array.isArray(raw)) for (const value of raw) headers.append(name, value);\n    else headers.set(name, raw);\n  }\n  return headers;\n}\n\nasync function adaptedRequest(request: IncomingMessage, bytes: Uint8Array): Promise<Request & Record<string, unknown>> {\n  const method = String(request.method || "GET").toUpperCase();\n  const url = new URL(request.url || "/", "http://127.0.0.1");\n  const body = method === "GET" || method === "HEAD" ? undefined : bytes;\n  const web = new Request(url, { method, headers: requestHeaders(request), body });\n  let parsed: unknown = undefined;\n  if (bytes.byteLength) {\n    const text = new TextDecoder().decode(bytes);\n    try { parsed = JSON.parse(text); } catch { parsed = text; }\n  }\n  return Object.assign(web, {\n    raw: request,\n    rawBody: bytes,\n    body: parsed,\n    url: url.pathname + url.search,\n    path: url.pathname,\n  }) as Request & Record<string, unknown>;\n}\n\nfunction callableFrom(value: unknown): Callable {\n  if (typeof value === "function") return value as Callable;\n  if (value && typeof value === "object") {\n    for (const name of ["handle", "handleRequest", "handleHttp", "dispatch", "serve"]) {\n      const candidate = (value as Record<string, unknown>)[name];\n      if (typeof candidate === "function") return (candidate as Callable).bind(value);\n    }\n  }\n  throw new Error("The Telegram NICO HTTP binding did not expose a supported handler.");\n}\n\nasync function writeResult(response: ServerResponse, result: unknown): Promise<void> {\n  if (response.writableEnded) return;\n  if (result instanceof Response) {\n    response.statusCode = result.status;\n    result.headers.forEach((value, name) => response.setHeader(name, value));\n    response.end(Buffer.from(await result.arrayBuffer()));\n    return;\n  }\n  if (result && typeof result === "object") {\n    const record = result as Record<string, unknown>;\n    const status = Number(record.statusCode ?? record.status ?? 200);\n    response.statusCode = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500;\n    response.setHeader("content-type", "application/json; charset=utf-8");\n    response.end(JSON.stringify(record.body ?? record));\n    return;\n  }\n  throw new Error("The Telegram NICO HTTP binding returned no bounded response.");\n}\n\nexport async function handleTelegramNicoProductionHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {\n  try {\n    const bytes = await bodyBytes(request);\n    const adapted = await adaptedRequest(request, bytes);\n    const handler = callableFrom(selectedHandler());\n    const result = handler.length >= 2 ? await handler(request, response) : await handler(adapted);\n    await writeResult(response, result);\n  } catch {\n    if (response.writableEnded) return;\n    response.statusCode = 503;\n    response.setHeader("content-type", "application/json; charset=utf-8");\n    response.end(JSON.stringify({\n      status: "blocked",\n      code: "telegram_nico_action_bridge_unavailable",\n      message: "The bounded Telegram NICO action bridge is unavailable or not securely configured.",\n    }));\n  }\n}\n`;
}

function wireServer(source) {
  if (source.includes("handleTelegramNicoProductionHttpRequest")) return source;
  const file = ts.createSourceFile(serverPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let lunaLiteral;
  function find(node) {
    if (ts.isStringLiteral(node) && node.text === "/luna" && !lunaLiteral) lunaLiteral = node;
    ts.forEachChild(node, find);
  }
  find(file);
  if (!lunaLiteral) throw new Error("The ordinary /luna route was not found; production wiring cannot be inserted safely.");
  let branch = lunaLiteral.parent;
  while (branch && !ts.isIfStatement(branch)) branch = branch.parent;
  if (!branch) throw new Error("The /luna route is not guarded by a deterministic if statement.");
  let owner = branch.parent;
  while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
  if (!owner || owner.parameters.length < 2 || !ts.isIdentifier(owner.parameters[0].name) || !ts.isIdentifier(owner.parameters[1].name)) {
    throw new Error("The production request and response identifiers could not be resolved safely.");
  }
  const requestName = owner.parameters[0].name.text;
  const responseName = owner.parameters[1].name.text;
  const condition = source.slice(branch.expression.getStart(file), branch.expression.getEnd()).replaceAll(JSON.stringify("/luna"), JSON.stringify("/telegram/nico/action")).replaceAll("'/luna'", "'/telegram/nico/action'");
  if (!condition.includes("/telegram/nico/action")) throw new Error("The cloned action-route condition did not replace /luna exactly.");
  const lineStart = source.lastIndexOf("\n", branch.getStart(file) - 1) + 1;
  const indent = source.slice(lineStart, branch.getStart(file)).match(/^\s*/u)?.[0] ?? "";
  const isAsync = owner.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true;
  const call = isAsync
    ? `await handleTelegramNicoProductionHttpRequest(${requestName}, ${responseName});`
    : `void handleTelegramNicoProductionHttpRequest(${requestName}, ${responseName});`;
  const route = `${indent}if (${condition}) {\n${indent}  ${call}\n${indent}  return;\n${indent}}\n\n`;
  let output = source.slice(0, lineStart) + route + source.slice(lineStart);
  const refreshed = ts.createSourceFile(serverPath, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let importEnd = 0;
  for (const statement of refreshed.statements) if (ts.isImportDeclaration(statement)) importEnd = statement.end;
  const importLine = `\nimport { handleTelegramNicoProductionHttpRequest } from "./telegram-nico-server-binding.js";`;
  output = output.slice(0, importEnd) + importLine + output.slice(importEnd);
  return output;
}

const testSource = `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport net from "node:net";\nimport { spawn } from "node:child_process";\nimport test from "node:test";\n\nasync function freePort(): Promise<number> {\n  return await new Promise((resolve, reject) => {\n    const server = net.createServer();\n    server.once("error", reject);\n    server.listen(0, "127.0.0.1", () => {\n      const address = server.address();\n      if (!address || typeof address === "string") return reject(new Error("No test port was allocated."));\n      const port = address.port;\n      server.close((error) => error ? reject(error) : resolve(port));\n    });\n  });\n}\n\nfunction productionEnvironment(source: string, port: number): NodeJS.ProcessEnv {\n  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", PORT: String(port), HOST: "127.0.0.1" };\n  const names = new Set([...source.matchAll(/(?:process\\.env\\.|env\\[?['\"])([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]));\n  for (const name of names) {\n    if (env[name]) continue;\n    if (name.includes("SHA256") || name.endsWith("_DIGEST")) env[name] = "a".repeat(64);\n    else if (name.includes("GMAIL") && (name.includes("EMAIL") || name.includes("SENDER"))) env[name] = "sara.reparodynamics@gmail.com";\n    else if (name.includes("RECIPIENT")) env[name] = "reparodynamics@gmail.com";\n    else if (name.includes("NICO") && name.includes("URL")) env[name] = "https://app.nicoaudit.com/api/nico/";\n    else if (name.includes("REDIRECT") && name.includes("URI")) env[name] = "https://saraseed.app/oauth/google/callback";\n    else if (name.includes("URL") || name.includes("ORIGIN")) env[name] = "https://saraseed.app";\n    else if (name.includes("ENABLED") || name.startsWith("ENABLE_")) env[name] = "true";\n    else if (name.includes("EMAIL")) env[name] = "sara.reparodynamics@gmail.com";\n    else if (name.endsWith("_ID") || name.includes("USER_ID") || name.includes("CHAT_ID")) env[name] = "900000001";\n    else if (name.includes("TOKEN") || name.includes("SECRET") || name.includes("PASSWORD") || name.includes("KEY")) env[name] = "test-only-secret-value-1234567890";\n    else env[name] = "test";\n  }\n  env.SARA_GMAIL_SENDER = "sara.reparodynamics@gmail.com";\n  env.SARA_GMAIL_AUTHORIZED_SENDER = "sara.reparodynamics@gmail.com";\n  env.SARA_GMAIL_AUTHORIZED_RECIPIENT = "reparodynamics@gmail.com";\n  return env;\n}\n\nasync function waitForServer(url: string, child: ReturnType<typeof spawn>): Promise<void> {\n  const deadline = Date.now() + 15_000;\n  while (Date.now() < deadline) {\n    if (child.exitCode !== null) throw new Error("Production server exited before the Telegram NICO route became reachable.");\n    try { await fetch(url, { method: "GET" }); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }\n  }\n  throw new Error("Production server did not become reachable.");\n}\n\ntest("production server mounts the separate bounded Telegram NICO action bridge", async (t) => {\n  const serverSource = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");\n  const productionSource = await readFile(new URL("../src/telegram-nico-production.ts", import.meta.url), "utf8");\n  assert.match(serverSource, /telegram-nico-server-binding/);\n  assert.match(serverSource, /\\/telegram\\/nico\\/action/);\n  const lunaIndex = serverSource.indexOf('"/luna"');\n  const actionIndex = serverSource.indexOf('"/telegram/nico/action"');\n  assert.ok(actionIndex >= 0 && lunaIndex >= 0 && actionIndex < lunaIndex, "action routing must remain separate from ordinary Luna analysis");\n\n  const port = await freePort();\n  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {\n    cwd: new URL("..", import.meta.url),\n    env: productionEnvironment(productionSource, port),\n    stdio: ["ignore", "pipe", "pipe"],\n  });\n  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });\n  const url = \`http://127.0.0.1:\${port}/telegram/nico/action\`;\n  await waitForServer(url, child);\n  const response = await fetch(url, {\n    method: "POST",\n    headers: {\n      "content-type": "application/json",\n      "authorization": "Bearer test-only-secret-value-1234567890",\n      "x-sara-telegram-bridge-token": "test-only-secret-value-1234567890",\n      "x-telegram-user-id": "900000999",\n      "x-telegram-request-id": "tgreq_0123456789abcdef0123456789abcdef",\n    },\n    body: JSON.stringify({\n      request_id: "tgreq_0123456789abcdef0123456789abcdef",\n      action: "nico_assessment_status",\n      telegram_user_id: "900000999",\n      update_id: 990001,\n      message: { from: { id: 900000999 }, chat: { id: 900000999 }, text: "nico_assessment_status" },\n    }),\n  });\n  assert.notEqual(response.status, 404);\n  assert.notEqual(response.status, 500);\n  assert.ok([400, 401, 403, 405, 409, 423, 429].includes(response.status), \`unpaired action must fail closed at the mounted bridge, received HTTP \${response.status}\`);\n});\n`;

const originalServer = fs.readFileSync(serverPath, "utf8");
const wiredServer = wireServer(originalServer);
fs.writeFileSync(serverPath, wiredServer);
fs.writeFileSync(testPath, testSource);

const attempts = [];
for (const productionName of productionNames.slice(0, 8)) {
  for (const httpName of httpNames.slice(0, 8)) {
    fs.writeFileSync(bindingPath, bindingSource(productionName, httpName));
    const typecheck = spawnSync("npm", ["run", "typecheck"], { cwd: root, stdio: "ignore" });
    if (typecheck.status !== 0) continue;
    const focused = spawnSync(process.execPath, ["--import", "tsx", "--test", "tests/telegram-nico-server-wiring.test.ts"], { cwd: root, stdio: "ignore" });
    attempts.push({ productionName, httpName, passed: focused.status === 0 });
    if (focused.status === 0) {
      fs.writeFileSync(path.join(root, "docs/TELEGRAM_NICO_PRODUCTION_WIRING.json"), JSON.stringify({
        schema: "sara.telegram_nico.production_wiring.v1",
        route: "/telegram/nico/action",
        ordinary_luna_analysis_only: true,
        production_factory: productionName,
        http_factory: httpName,
        focused_test: "tests/telegram-nico-server-wiring.test.ts",
      }, null, 2) + "\n");
      process.exit(0);
    }
  }
}
fs.writeFileSync(serverPath, originalServer);
for (const target of [bindingPath, testPath]) if (fs.existsSync(target)) fs.unlinkSync(target);
throw new Error(`No exact production/HTTP factory pair passed the mounted-route test (${attempts.length} combinations checked).`);
