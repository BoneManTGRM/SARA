import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { compileCommercialTerms } from "../src/commercial-terms.ts";
import { SaraKernel } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";
import { BASE_USDC_CONTRACT, ERC20_TRANSFER_TOPIC } from "../src/usdc-payment.ts";

describe("public USDC checkout HTTP boundary", () => {
  const ownerToken = "http-commerce-owner-token";
  const ownerTokenHash = createHash("sha256").update(ownerToken).digest("hex");
  const recipient = `0x${"2".repeat(40)}`;
  const sender = `0x${"1".repeat(40)}`;
  const transactionHash = `0x${"a".repeat(64)}`;
  const topicAddress = (address: string) => `0x${"0".repeat(24)}${address.slice(2)}`;
  const terms = compileCommercialTerms({
    businessName: "Owner Test Business",
    contactEmail: "owner@example.com",
    governingLaw: "the laws selected by the owner",
  });
  let directory: string;
  let baseUrl: string;
  let server: ReturnType<typeof createSaraServer>;
  let intent: { id: string; jobId: string; clientSecret: string };

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "sara-http-commerce-"));
    const kernel = await SaraKernel.boot({
      stateDirectory: directory,
      ownerTokenSha256: ownerTokenHash,
      bootstrapRevenueCapabilities: true,
    });
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith("https://api.github.com/")) {
        return Response.json({
          private: false,
          archived: false,
          full_name: "example/project",
          pushed_at: new Date().toISOString(),
        });
      }
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === "eth_blockNumber") return Response.json({ jsonrpc: "2.0", id: 1, result: "0x70" });
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transactionHash,
          status: "0x1",
          blockNumber: "0x64",
          logs: [{
            address: BASE_USDC_CONTRACT,
            topics: [ERC20_TRANSFER_TOPIC, topicAddress(sender), topicAddress(recipient)],
            data: `0x${149_000_000n.toString(16).padStart(64, "0")}`,
          }],
        },
      });
    }) as typeof fetch;
    server = createSaraServer(kernel, {
      ownerTokenSha256: ownerTokenHash,
      stateDirectory: directory,
      commerce: {
        recipientAddress: recipient,
        rpcUrl: "https://mainnet.base.org",
        terms,
        publicOrigin: "https://saraseed.app",
        fetchImpl,
      },
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it("publishes only the configured fixed offer and rejects foreign browser origins", async () => {
    const offer = await fetch(`${baseUrl}/api/public/revenue-pilot/offer`, {
      headers: { origin: "https://saraseed.app" },
    });
    assert.equal(offer.status, 200);
    assert.equal(offer.headers.get("access-control-allow-origin"), "https://saraseed.app");
    assert.deepEqual(await offer.json(), {
      configured: true,
      service: "Public Repository Readiness Snapshot",
      amount: 149,
      currency: "USDC",
      network: "Base",
      chainId: 8453,
      tokenContract: BASE_USDC_CONTRACT,
      terms,
    });
    assert.equal((await fetch(`${baseUrl}/api/public/revenue-pilot/offer`, {
      headers: { origin: "https://attacker.example" },
    })).status, 403);
  });

  it("creates one exact terms-bound payment intent without recording revenue", async () => {
    const response = await fetch(`${baseUrl}/api/public/revenue-pilot/intents`, {
      method: "POST",
      headers: { origin: "https://saraseed.app", "content-type": "application/json" },
      body: JSON.stringify({
        customerReference: "customer@example.com",
        repoUrl: "https://github.com/example/project",
        primaryGoal: "release_readiness",
        repositoryOwnerPermissionConfirmed: true,
        requiresPrivateAccess: false,
        containsRegulatedOrPrivateData: false,
        requestsProductionChanges: false,
        requestsExploitValidation: false,
        termsAccepted: true,
        termsDigest: terms.digest,
      }),
    });
    assert.equal(response.status, 201);
    intent = await response.json() as typeof intent;
    assert.match(intent.clientSecret, /^[A-Za-z0-9_-]{43}$/u);
    const status = await fetch(`${baseUrl}/api/status`, { headers: { authorization: `Bearer ${ownerToken}` } });
    const owner = await status.json() as { realizedProfit: { collectedRevenueUsd: number }; revenuePaymentIntents: unknown[] };
    assert.equal(owner.realizedProfit.collectedRevenueUsd, 0);
    assert.equal(owner.revenuePaymentIntents.length, 1);
  });

  it("requires the client secret, verifies Base USDC, and still waits for owner approval", async () => {
    assert.equal((await fetch(`${baseUrl}/api/public/revenue-pilot/intents/${intent.id}`)).status, 403);
    const confirmed = await fetch(`${baseUrl}/api/public/revenue-pilot/intents/${intent.id}/payment`, {
      method: "POST",
      headers: { authorization: `Bearer ${intent.clientSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ transactionHash }),
    });
    assert.equal(confirmed.status, 200);
    assert.equal((await confirmed.json() as { status: string }).status, "confirmed");
    const status = await fetch(`${baseUrl}/api/status`, { headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal((await status.json() as { realizedProfit: { collectedRevenueUsd: number } }).realizedProfit.collectedRevenueUsd, 0);
  });

  it("queues fulfillment and records realized revenue only after the exact owner approval", async () => {
    assert.equal((await fetch(`${baseUrl}/api/revenue-pilot/jobs/${intent.jobId}/approve-fulfillment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentIntentId: intent.id }),
    })).status, 401);
    const approved = await fetch(`${baseUrl}/api/revenue-pilot/jobs/${intent.jobId}/approve-fulfillment`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ paymentIntentId: intent.id }),
    });
    assert.equal(approved.status, 200);
    const result = await approved.json() as { job: { status: string }; paymentIntent: { status: string } };
    assert.equal(result.job.status, "queued");
    assert.equal(result.paymentIntent.status, "authorized");
    const status = await fetch(`${baseUrl}/api/status`, { headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal((await status.json() as { realizedProfit: { collectedRevenueUsd: number } }).realizedProfit.collectedRevenueUsd, 149);
  });
});
