import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("registry startup reads each shared source identity once rather than once per capability", async () => {
  const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; const original=fs.readFile; const counts={}; fs.readFile=function(path,...args){if(path instanceof URL && path.href.endsWith('/src/kernel.ts')) counts[path.href]=(counts[path.href]??0)+1; return original.call(this,path,...args)}; syncBuiltinESMExports(); await import('./src/digital-capabilities/registry.ts'); console.log(JSON.stringify(counts));`;
  const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: process.cwd(), timeout: 20000 });
  const counts = Object.values(JSON.parse(result.stdout.trim())) as number[];
  assert.ok(counts.length > 0, "Source-identity reads must be observed, not skipped.");
  assert.ok(counts.every(count => count === 1), `Shared kernel source was read ${JSON.stringify(counts)} times during a single load.`);
});
