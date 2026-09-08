import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { RepositoryCloudBroker } from "../src/repository-cloud-broker.ts";
import { createRepositoryCloudWorkerEngine, runRepositoryCloudWorker } from "../src/repository-cloud-worker.ts";
import type { RepositoryCloudIdentity } from "../src/repository-cloud-auth.ts";
import type { CloudAssignment, CloudCommand, CloudReply } from "../src/repository-cloud-protocol.ts";

const identity: RepositoryCloudIdentity = { authentication: "github_oidc_repository_worker", benchmarkId: "fixture",
  registrationDigest: "a".repeat(64), workflowRevision: "b".repeat(40), runId: "1234" };
const assignment: Omit<CloudAssignment, "id"> = { phase: "producer", attemptId: "attempt-0",
  task: { instanceId: "fixture", problemStatement: "public issue", arm: "conventional", runId: "fixture" },
  environment: { schemaVersion: 1, repository: "fixture/public", baseCommit: "a".repeat(40), image: `sha256:${"b".repeat(64)}`,
    publicTestCommand: ["true"], timeoutSeconds: 10 } };
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 2));
async function next(broker: RepositoryCloudBroker, workerId: string): Promise<CloudCommand> {
  const deadline = Date.now() + 2000;
  do { const r = await broker.worker(identity, { action: "poll", phase: "producer", workerId, busy: [] }) as { command?: CloudCommand };
    if (r.command) return r.command; await pause(); } while (Date.now() < deadline);
  throw Error("fixture command timeout");
}
test("cloud transport durably binds a session and reuses the real worker operations without a paid grant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloud-session-test-"));
  const broker = new RepositoryCloudBroker({ assertAuthority: async () => {}, commandTimeoutMilliseconds: 5000 });
  let starts = 0, closes = 0;
  try {
    await broker.begin(directory); await broker.openAssignment(assignment);
    const worker = runRepositoryCloudWorker({ phase: "producer", signal: AbortSignal.timeout(10000), pause,
      call: b => broker.worker(identity, b),
      async prepare(a) { return createRepositoryCloudWorkerEngine({ assignment: a, directory,
        startSession: async () => { starts++; let closed = false;
          return { async run() { return { exitCode: 0, output: "public output" }; }, async mustRun() { return { exitCode: 0, output: "" }; },
            async freezePatch() { return ""; }, async close() { if (!closed) closes++; closed = true; } }; } }); } });
    const session = await broker.startSession(assignment.environment);
    assert.equal((await session.run(["node", "test.cjs"])).output, "public output");
    assert.equal(await session.freezePatch(), ""); await session.close();
    // The verifier gets a second session, not the producer workspace.
    const verifier = await broker.startSession(assignment.environment); await verifier.close();
    await broker.finishAssignment(); await worker;
    assert.equal(starts, 2); assert.equal(closes, 2);
    const files = await readdir(directory);
    assert.equal(files.filter(f => f.startsWith("cloud-command-")).length, files.filter(f => f.startsWith("cloud-reply-")).length);
    const claim = JSON.parse(await readFile(join(directory, "cloud-github-run.json"), "utf8"));
    assert.deepEqual(claim.payload, identity);
  } finally { broker.end(); await rm(directory, { recursive: true, force: true }); }
});
test("duplicate delivery is idempotent; a changed reply or workflow run closes authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloud-replay-test-"));
  const broker = new RepositoryCloudBroker({ assertAuthority: async () => {}, commandTimeoutMilliseconds: 5000 });
  try {
    await broker.begin(directory); await broker.openAssignment(assignment);
    const workerId = randomUUID(); await broker.worker(identity, { action: "connect", workerId, phase: "producer" });
    await assert.rejects(broker.worker({ ...identity, runId: "999" }, { action: "connect", workerId, phase: "producer" }), /WORKFLOW_RUN_CHANGED/);
    const starting = broker.startSession(assignment.environment), command = await next(broker, workerId);
    assert.deepEqual(await next(broker, workerId), command, "lost poll response preserves command identity");
    const reply: CloudReply = { id: command.id, commandDigest: command.digest, value: { started: true }, error: null };
    const envelope = { action: "reply", workerId, phase: "producer", reply };
    await assert.rejects(broker.worker(identity, { ...envelope, reply: { ...reply, commandDigest: "c".repeat(64) } }), /REPLY_BINDING/);
    await broker.worker(identity, envelope); await starting;
    assert.deepEqual(await broker.worker(identity, envelope), { state: "accepted" });
    await assert.rejects(broker.worker(identity, { ...envelope, reply: { ...reply, value: { started: false } } }), /REPLY_SUBSTITUTION/);
    await assert.rejects(broker.assertActive(), /REPLY_SUBSTITUTION/);
  } finally { broker.end(); await rm(directory, { recursive: true, force: true }); }
});
test("missing execution, stopped authority, and grading before twenty frozen outcomes cannot pass", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloud-stop-test-")); let stopped = false;
  const broker = new RepositoryCloudBroker({ assertAuthority: async () => { if (stopped) throw Error("STOPPED"); }, commandTimeoutMilliseconds: 50 });
  try {
    await assert.rejects(broker.startSession(assignment.environment), /ENVIRONMENT/);
    await broker.begin(directory);
    await assert.rejects(broker.openAssignment({ ...assignment, phase: "judge", judge: { image: `swebench/fixture@sha256:${"d".repeat(64)}` } }), /PHASE/);
    await broker.openAssignment(assignment);
    const workerId = randomUUID();
    assert.deepEqual(await broker.worker(identity, { action: "connect", phase: "judge", workerId }), { state: "waiting" });
    await assert.rejects(broker.startSession(assignment.environment), /UNCERTAIN_NO_REPLAY/);
    await assert.rejects(broker.assertActive(), /UNCERTAIN_NO_REPLAY/);
    assert.ok((await readdir(directory)).some(f => f.startsWith("cloud-command-")), "uncertain command remains durable");
    stopped = true;
  } finally { broker.end(); await rm(directory, { recursive: true, force: true }); }
});
test("worker rejects host operations, replayed session ids and judge commands during production", async () => {
  const a = { ...assignment, id: randomUUID() };
  const engine = createRepositoryCloudWorkerEngine({ assignment: a, directory: "/unused",
    startSession: async () => ({ async run() { return { exitCode: 0, output: "" }; }, async mustRun() { return { exitCode: 0, output: "" }; }, async freezePatch() { return ""; }, async close() {} }) });
  const make = (operation: unknown) => { const body = { id: randomUUID(), assignmentId: a.id, operation }; return { ...body, digest: sha256(canonicalJson(body)) } as CloudCommand; };
  await assert.rejects(engine.execute(make({ kind: "docker", args: ["run", "--privileged"] })), /CLOUD_/);
  await assert.rejects(engine.execute(make({ kind: "judge", request: {} })), /PHASE/);
  await assert.rejects(engine.execute(make({ kind: "run", session: randomUUID(), command: ["true"], mount: "/" })), /FIELDS/);
  const session = randomUUID(); await engine.execute(make({ kind: "start", session }));
  await engine.execute(make({ kind: "close", session }));
  await assert.rejects(engine.execute(make({ kind: "start", session })), /REPLAY_OR_OVERLAP/);
  await engine.close();
});
test("a stop blocks queued delivery and a late reply cannot complete execution after closure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloud-stop-delivery-")); let stopped = false;
  const broker = new RepositoryCloudBroker({ assertAuthority: async () => { if (stopped) throw Error("STOPPED"); }, commandTimeoutMilliseconds: 5000 });
  try {
    await broker.begin(directory); await broker.openAssignment(assignment);
    const workerId = randomUUID(); await broker.worker(identity, { action: "connect", workerId, phase: "producer" });
    const starting = broker.startSession(assignment.environment); void starting.catch(() => {});
    const command = await next(broker, workerId); stopped = true;
    await assert.rejects(next(broker, workerId), /STOPPED/);
    await assert.rejects(broker.worker(identity, { action: "reply", workerId, phase: "producer",
      reply: { id: command.id, commandDigest: command.digest, value: { started: true }, error: null } }), /STOPPED/);
    broker.end(); await assert.rejects(starting, /EXECUTION_CLOSED/);
    stopped = false; await assert.rejects(broker.assertActive(), /EXECUTION_CLOSED/);
  } finally { broker.end(); await rm(directory, { recursive: true, force: true }); }
});
