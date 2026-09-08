import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RepositoryCommandError, RepositorySession } from "../src/repository-executor.ts";

test("command timeouts and output limits retain bounded diagnostics and close the session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-command-diagnostics-"));
  const oldPath = process.env.PATH;
  const cleanup = join(directory, "cleanup");
  try {
    await writeFile(join(directory, "docker"), `#!${process.execPath}
const fs=require('fs'),args=process.argv.slice(2);
if(args[0]==='rm')fs.appendFileSync(${JSON.stringify(cleanup)},'closed\\n');
else if(args.includes('rev-parse'))console.log('a'.repeat(40));
else if(args.includes('rev-list'))console.log('1');
else if(args.includes('stall')){process.stdout.write('BEFORE_TIMEOUT\\n');setInterval(()=>{},1000);}
else if(args.includes('overflow')){process.stdout.write('BEFORE_LIMIT\\n');setTimeout(()=>process.stdout.write('x'.repeat(3*1024*1024)),40);}
`, { mode: 0o755 });
    process.env.PATH = directory;
    for (const [command, reason, marker] of [
      ["stall", "REPOSITORY_COMMAND_TIMEOUT", "BEFORE_TIMEOUT"],
      ["overflow", "REPOSITORY_OUTPUT_LIMIT", "BEFORE_LIMIT"],
    ]) {
      const session = await RepositorySession.start({ schemaVersion: 1, repository: "example/public",
        baseCommit: "a".repeat(40), image: `sha256:${"b".repeat(64)}`,
        publicTestCommand: [command], timeoutSeconds: 1 });
      await assert.rejects(session.run([command]), error => {
        assert(error instanceof RepositoryCommandError);
        assert.equal(error.message, reason);
        assert(error.output.startsWith(marker));
        assert(Buffer.byteLength(error.output) <= 2 * 1024 * 1024);
        return true;
      });
      await assert.rejects(session.run(["late"]), /REPOSITORY_SESSION_COMMAND/);
      await session.close();
    }
    assert.equal(await readFile(cleanup, "utf8"), "closed\nclosed\n");
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    await rm(directory, { recursive: true, force: true });
  }
});
