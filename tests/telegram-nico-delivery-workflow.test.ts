import { productionPackage } from "./nico-production-package-fixture.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { TelegramNicoDeliveryOperator } from "../src/telegram-nico-delivery.ts";
import { GMAIL_REPORT_SENDER } from "../src/gmail-oauth-activation.ts";
import { GMAIL_REPORT_RECIPIENT } from "../src/gmail-verified-report-sender.ts";

const USER = "paired-owner";
const USER_DIGEST = createHash("sha256").update(USER).digest("hex");
const REPOSITORY = "https://github.com/sindresorhus/p-map";
const COMMIT = "22dda61ea29037ba85af25e84bc5efba77e62f44";
const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "sara-telegram-nico-workflow-"));
  temporaryDirectories.push(value);
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(options: { unresolved?: number; humanReviewed?: boolean; createFailureOnce?: boolean } = {}) {
  const report = new Uint8Array(Buffer.from("%PDF-1.7\nverified private automated report\n"));
  const digest = sha256(report);
  const unusedArtifact = {
    artifact_schema: "nico.authorized-automated-delivery.v1",
    artifact_id: "artifact-p-map-1",
    revision: 3,
    hash_and_size: { sha256: digest, size_bytes: report.byteLength },
  };
  let createAttempts = 0;
  const calls = { create: [] as string[], get: 0, continue: 0, package: 0, email: 0 };
  const nicoOperator = {
    createRun: async (input: unknown) => {
      createAttempts += 1;
      const runId = String((input as { runId?: unknown }).runId);
      calls.create.push(runId);
      if (options.createFailureOnce && createAttempts === 1) throw new Error("temporary NICO boundary failure");
      return { run_id: runId };
    },
    getRun: async (runId: unknown) => {
      calls.get += 1;
      return {
        run_id: String(runId),
        repository_url: REPOSITORY,
        commit_sha: COMMIT,
        status: "complete",
        terminal: true,
        human_reviewed: options.humanReviewed ?? false,
        artifact_identity: productionPackage(String(runId), COMMIT).identity,
        cost_usd: 0.25,
      };
    },
    continueRun: async (runId: unknown) => {
      calls.continue += 1;
      return {
        run_id: String(runId), repository_url: REPOSITORY, commit_sha: COMMIT,
        status: "complete", terminal: true, human_reviewed: false, artifact_identity: productionPackage(String(runId), COMMIT).identity, cost_usd: 0.25,
      };
    },
    getReviewQueue: async () => ({ unresolved_review_workload: options.unresolved ?? 0 }),
    getAutomatedDeliveryPackage: async (runId: string) => {
      calls.package += 1;
      return productionPackage(runId, COMMIT);
    },
  };
  const gmailSender = {
    verifyIdentity: async () => {},
    send: async (input: { reportDigest: string; sender: string; recipient: string }) => {
      calls.email += 1;
      assert.equal(input.reportDigest, productionPackage(calls.create[0]!, COMMIT).digest);
      assert.equal(input.sender, GMAIL_REPORT_SENDER);
      assert.equal(input.recipient, GMAIL_REPORT_RECIPIENT);
      return {
        status: "provider_accepted" as const,
        requestId: "email:request-00000001",
        sender: GMAIL_REPORT_SENDER as typeof GMAIL_REPORT_SENDER,
        recipient: GMAIL_REPORT_RECIPIENT as typeof GMAIL_REPORT_RECIPIENT,
        repository: "sindresorhus/p-map",
        commitSha: COMMIT,
        reportDigest: digest,
        contentType: "application/pdf" as const,
        providerDeliveryId: "gmail-message-1",
        acceptedAt: "2026-09-04T14:00:00.000Z",
      };
    },
  };
  return { nicoOperator, gmailSender, calls, digest };
}

function command(requestId = "request-00000001") {
  return {
    requestId,
    telegramUserId: USER,
    action: "nico_assessment_start",
    repository: REPOSITORY,
    commitSha: COMMIT,
    emailVerifiedReport: true,
    sender: GMAIL_REPORT_SENDER,
    recipient: GMAIL_REPORT_RECIPIENT,
  } as const;
}

function operator(stateDirectory: string, f: ReturnType<typeof fixture>) {
  return new TelegramNicoDeliveryOperator({
    stateDirectory,
    expectedTelegramUserIdSha256: USER_DIGEST,
    nicoOperator: f.nicoOperator,
    targetVerifier: { verify: async () => ({ repository: "sindresorhus/p-map", repositoryUrl: REPOSITORY, commitSha: COMMIT }) },
    authorize: async () => ({ allowed: true, code: "TEST", reason: "test" }),
    gmailSender: f.gmailSender,
    now: () => new Date("2026-09-04T14:00:00.000Z"),
  });
}

describe("Telegram NICO delivery workflow", () => {
  it("runs one exact assessment, independently verifies zero-review automated delivery, and returns provider acceptance", async () => {
    const stateDirectory = await directory();
    const f = fixture();
    const first = await operator(stateDirectory, f).submit(command());
    assert.equal(first.state, "provider_accepted");
    assert.equal(first.repositoryUrl, REPOSITORY);
    assert.equal(first.commitSha, COMMIT);
    assert.equal(first.unresolvedReviewWorkload, 0);
    assert.equal(first.automatedPackageAuthorized, true);
    assert.equal(first.reportDigest, productionPackage(first.runId, COMMIT).digest);
    assert.equal(first.delivery?.providerDeliveryId, "gmail-message-1");
    const replay = await operator(stateDirectory, f).submit(command());
    assert.deepEqual(replay, first);
    assert.equal(f.calls.create.length, 1);
    assert.equal(f.calls.package, 1);
    assert.equal(f.calls.email, 1);
  });

  it("refuses automatic replay after an uncertain create failure across restart", async () => {
    const stateDirectory = await directory();
    const f = fixture({ createFailureOnce: true });
    await assert.rejects(() => operator(stateDirectory, f).submit(command()), /temporary NICO boundary failure/);
    await assert.rejects(() => operator(stateDirectory, f).submit(command()), /temporary NICO boundary failure/);
    assert.equal(f.calls.create.length, 1);
  });

  it("fails closed on unresolved review work and never requests or emails a package", async () => {
    const stateDirectory = await directory();
    const f = fixture({ unresolved: 1 });
    await assert.rejects(() => operator(stateDirectory, f).submit(command("request-00000002")), /zero unresolved review workload; found 1/);
    assert.equal(f.calls.package, 0);
    assert.equal(f.calls.email, 0);
  });

  it("rejects stale target evidence, human-review claims, malformed commits, and credential-bearing payloads", async () => {
    const stateDirectory = await directory();
    const f = fixture({ humanReviewed: true });
    await assert.rejects(() => operator(stateDirectory, f).submit(command("request-00000003")), /human review/);
    const safe = fixture();
    await assert.rejects(() => operator(stateDirectory, safe).submit({ ...command("request-00000004"), commitSha: "main" }), /40-character/);
    await assert.rejects(() => operator(stateDirectory, safe).submit({ ...command("request-00000005"), ownerToken: "must-never-persist" } as never), /Credentials are not accepted/);
    const files: string[] = [];
    async function walk(path: string): Promise<void> {
      for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) await walk(child); else files.push(await readFile(child, "utf8").catch(() => ""));
      }
    }
    await walk(stateDirectory);
    assert.equal(files.some((value) => value.includes("must-never-persist")), false);
  });
});

it("exclusively admits a command across two operator instances", async () => {
  const stateDirectory = await directory();
  const f = fixture();
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const original = f.nicoOperator.createRun;
  f.nicoOperator.createRun = async input => { entered(); await held; return original(input); };
  const first = operator(stateDirectory, f).submit(command());
  await started;
  try { await assert.rejects(operator(stateDirectory, f).submit(command()), /in progress|recovery/); }
  finally { release(); }
  await first;
  assert.equal(f.calls.create.length, 1);
  assert.equal(f.calls.email, 1);
});

it("does not bypass the daily limit by retrying a rejected request", async () => {
  const stateDirectory = await directory();
  const f = fixture();
  const make = () => new TelegramNicoDeliveryOperator({stateDirectory, expectedTelegramUserIdSha256: USER_DIGEST,
    nicoOperator: f.nicoOperator, gmailSender: f.gmailSender, dailyActionLimit: 1,
    targetVerifier: {verify: async () => ({repository:"sindresorhus/p-map",repositoryUrl:REPOSITORY,commitSha:COMMIT})},
    authorize: async () => ({allowed:true,code:"TEST",reason:"test"})});
  await make().submit({...command(), emailVerifiedReport:false});
  await assert.rejects(make().submit(command("request-second-0001")), /daily action limit/);
  await assert.rejects(make().submit(command("request-second-0001")), /daily action limit/);
  assert.equal(f.calls.create.length, 1);
});

it("uses the actual NicoOperatorClient intake and package signatures", async () => {
  const { NicoOperatorClient } = await import("../src/nico-operator.ts");
  const stateDirectory = await directory();
  let id = "";
  let packages = 0;
  const client = new NicoOperatorClient({baseUrl:"https://app.nicoaudit.com/api/nico/",operatorPassword:"test-only-password",fetchImpl:async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("comprehensive-intake")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.repository,"sindresorhus/p-map");
      assert.equal(body.expected_commit_sha,COMMIT);
      assert.match(body.run_id,/^comprun_[0-9a-f]{32}$/);
      id = body.run_id;
      return Response.json({run_id:id});
    }
    const packaged = productionPackage(id,COMMIT);
    if (path.endsWith("automated-delivery-package")) {
      packages += 1;
      assert.deepEqual(JSON.parse(String(init?.body)).expected_artifact_identity,packaged.identity);
      return new Response(Buffer.from(packaged.body),{headers:{"content-type":"application/zip","x-nico-authorization-mode":"automated_policy","x-nico-human-reviewed":"false","x-nico-certified-package-sha256":packaged.digest}});
    }
    if (path.endsWith("review-queue")) return Response.json({unresolved_review_workload:0});
    return Response.json({identity:{run_id:id,repository:REPOSITORY,commit_sha:COMMIT},status:"review_required",terminal:true,artifact_identity:packaged.identity,cost_usd:0});
  }});
  const f=fixture();
  let sent=0;
  const op2 = new TelegramNicoDeliveryOperator({stateDirectory,expectedTelegramUserIdSha256:USER_DIGEST,nicoOperator:client,
    targetVerifier:{verify:async()=>({repository:"sindresorhus/p-map",repositoryUrl:REPOSITORY,commitSha:COMMIT})},
    authorize:async()=>({allowed:true,code:"TEST",reason:"test"}),gmailSender:{verifyIdentity:async()=>{},send:async input=>{sent++;return {status:"provider_accepted",requestId:input.requestId,sender:GMAIL_REPORT_SENDER,recipient:GMAIL_REPORT_RECIPIENT,repository:input.repository,commitSha:input.commitSha,reportDigest:input.reportDigest,contentType:"application/zip",providerDeliveryId:"test-message",acceptedAt:new Date().toISOString()};}}});
  const receipt=await op2.submit(command());
  assert.equal(receipt.state,"provider_accepted"); assert.equal(packages,1);assert.equal(sent,1);
});

it("checks Gmail identity before any assessment and honors revocation before package authorization", async () => {
 const stateDirectory=await directory(); const f=fixture(); let allowed=true;
 const op=new TelegramNicoDeliveryOperator({stateDirectory,expectedTelegramUserIdSha256:USER_DIGEST,nicoOperator:f.nicoOperator,
 targetVerifier:{verify:async()=>({repository:"sindresorhus/p-map",repositoryUrl:REPOSITORY,commitSha:COMMIT})},
 authorize:async()=>({allowed,code:"TEST",reason:"owner revoked"}),gmailSender:{...f.gmailSender,verifyIdentity:async()=>{throw new Error("wrong Gmail account");}}});
 await assert.rejects(op.submit(command()),/wrong Gmail account/); assert.equal(f.calls.create.length,0);
 const nextDir=await directory();const original=f.nicoOperator.getReviewQueue;
 f.nicoOperator.getReviewQueue=async()=>{allowed=false;return original();};
 const op2=new TelegramNicoDeliveryOperator({stateDirectory:nextDir,expectedTelegramUserIdSha256:USER_DIGEST,nicoOperator:f.nicoOperator,
 targetVerifier:{verify:async()=>({repository:"sindresorhus/p-map",repositoryUrl:REPOSITORY,commitSha:COMMIT})},authorize:async()=>({allowed,code:"TEST",reason:"owner revoked"}),gmailSender:f.gmailSender});
 await assert.rejects(op2.submit(command()),/owner revoked/); assert.equal(f.calls.package,0);assert.equal(f.calls.email,0);
});
