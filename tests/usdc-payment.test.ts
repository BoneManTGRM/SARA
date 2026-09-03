import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASE_USDC_CONTRACT,
  ERC20_TRANSFER_TOPIC,
  verifyBaseUsdcPayment,
} from "../src/usdc-payment.ts";

const tx = `0x${"a".repeat(64)}`;
const sender = `0x${"1".repeat(40)}`;
const recipient = `0x${"2".repeat(40)}`;
const addressTopic = (address: string) => `0x${"0".repeat(24)}${address.slice(2)}`;
const amountData = `0x${149_000_000n.toString(16).padStart(64, "0")}`;

function rpcFetch(options: {
  status?: string;
  recipient?: string;
  amount?: string;
  contract?: string;
  receiptBlock?: string;
  latestBlock?: string;
  duplicate?: boolean;
} = {}): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string };
    if (request.method === "eth_blockNumber") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: options.latestBlock ?? "0x70" });
    }
    const log = {
      address: options.contract ?? BASE_USDC_CONTRACT,
      topics: [ERC20_TRANSFER_TOPIC, addressTopic(sender), addressTopic(options.recipient ?? recipient)],
      data: options.amount ?? amountData,
    };
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: {
        transactionHash: tx,
        status: options.status ?? "0x1",
        blockNumber: options.receiptBlock ?? "0x64",
        logs: options.duplicate ? [log, log] : [log],
      },
    });
  }) as typeof fetch;
}

describe("direct Base USDC payment verification", () => {
  it("accepts exactly one confirmed 149 USDC transfer to the configured owner wallet", async () => {
    const payment = await verifyBaseUsdcPayment({
      transactionHash: tx,
      recipientAddress: recipient,
      rpcUrl: "https://mainnet.base.org",
      fetchImpl: rpcFetch(),
      now: new Date("2026-09-03T12:00:00.000Z"),
    });
    assert.equal(payment.amountUsd, 149);
    assert.equal(payment.amountAtomic, "149000000");
    assert.equal(payment.confirmations, 13);
    assert.equal(payment.senderAddress, sender);
    assert.match(payment.transactionReferenceDigest, /^[a-f0-9]{64}$/u);
  });

  it("rejects failed, under-confirmed, wrong-token, wrong-recipient, wrong-amount, and duplicate transfers", async () => {
    for (const options of [
      { status: "0x0" },
      { latestBlock: "0x6a" },
      { contract: `0x${"3".repeat(40)}` },
      { recipient: `0x${"4".repeat(40)}` },
      { amount: `0x${148_000_000n.toString(16)}` },
      { duplicate: true },
    ]) {
      await assert.rejects(() => verifyBaseUsdcPayment({
        transactionHash: tx,
        recipientAddress: recipient,
        rpcUrl: "https://mainnet.base.org",
        fetchImpl: rpcFetch(options),
      }));
    }
  });

  it("rejects malformed identifiers and credential-bearing RPC URLs before network use", async () => {
    await assert.rejects(() => verifyBaseUsdcPayment({
      transactionHash: "not-a-hash",
      recipientAddress: recipient,
      rpcUrl: "https://mainnet.base.org",
      fetchImpl: rpcFetch(),
    }), /transaction hash/iu);
    await assert.rejects(() => verifyBaseUsdcPayment({
      transactionHash: tx,
      recipientAddress: recipient,
      rpcUrl: "https://user:secret@example.com",
      fetchImpl: rpcFetch(),
    }), /credential-free/iu);
  });
});
