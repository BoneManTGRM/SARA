import { sha256 } from "./canonical.ts";

export const BASE_MAINNET_CHAIN_ID = 8453 as const;
export const BASE_USDC_CONTRACT = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
export const BASE_USDC_DECIMALS = 6 as const;
export const BASE_USDC_PAYMENT_AMOUNT_ATOMIC = 149_000_000n;
export const BASE_USDC_MINIMUM_CONFIRMATIONS = 12 as const;
export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

const ADDRESS = /^0x[a-f0-9]{40}$/i;
const HASH = /^0x[a-f0-9]{64}$/i;
const HEX = /^0x[0-9a-f]+$/i;

export type VerifiedUsdcPayment = {
  schemaVersion: 1;
  provider: "base-usdc-direct";
  chainId: 8453;
  tokenContract: typeof BASE_USDC_CONTRACT;
  transactionHash: string;
  transactionReferenceDigest: string;
  senderAddress: string;
  recipientAddress: string;
  amountAtomic: "149000000";
  amountUsd: 149;
  blockNumber: number;
  latestBlockNumber: number;
  confirmations: number;
  verifiedAt: string;
};

type JsonRpcResult = {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
  error?: unknown;
};

type ReceiptLog = {
  address?: unknown;
  topics?: unknown;
  data?: unknown;
};

type TransactionReceipt = {
  status?: unknown;
  blockNumber?: unknown;
  transactionHash?: unknown;
  logs?: unknown;
};

function normalizedAddress(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (!ADDRESS.test(normalized)) throw new Error(`${label} must be one 20-byte EVM address.`);
  return normalized;
}

function normalizedHash(value: string): string {
  const normalized = value.toLowerCase();
  if (!HASH.test(normalized)) throw new Error("Transaction hash must be one 32-byte hexadecimal value.");
  return normalized;
}

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !HEX.test(value)) throw new Error(`${label} is not a valid RPC quantity.`);
  return BigInt(value);
}

function topicAddress(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} is not a valid indexed EVM address.`);
  }
  return normalizedAddress(`0x${value.slice(-40)}`, label);
}

async function rpc(
  fetchImpl: typeof fetch,
  rpcUrl: string,
  method: "eth_getTransactionReceipt" | "eth_blockNumber",
  params: unknown[],
): Promise<unknown> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Base RPC request failed.");
  const body = await response.json() as JsonRpcResult;
  if (body.error || !("result" in body)) throw new Error("Base RPC returned an error.");
  return body.result;
}

export async function verifyBaseUsdcPayment(input: {
  transactionHash: string;
  recipientAddress: string;
  rpcUrl: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<VerifiedUsdcPayment> {
  const transactionHash = normalizedHash(input.transactionHash);
  const recipientAddress = normalizedAddress(input.recipientAddress, "Receiving wallet");
  const rpcUrl = new URL(input.rpcUrl);
  if (rpcUrl.protocol !== "https:" || rpcUrl.username || rpcUrl.password || rpcUrl.hash) {
    throw new Error("Base RPC URL must be a credential-free HTTPS endpoint.");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const [rawReceipt, rawLatestBlock] = await Promise.all([
    rpc(fetchImpl, rpcUrl.toString(), "eth_getTransactionReceipt", [transactionHash]),
    rpc(fetchImpl, rpcUrl.toString(), "eth_blockNumber", []),
  ]);
  if (!rawReceipt || typeof rawReceipt !== "object" || Array.isArray(rawReceipt)) {
    throw new Error("The transaction is not yet available on Base.");
  }
  const receipt = rawReceipt as TransactionReceipt;
  if (String(receipt.transactionHash).toLowerCase() !== transactionHash) {
    throw new Error("Base RPC returned a different transaction receipt.");
  }
  if (quantity(receipt.status, "Transaction status") !== 1n) {
    throw new Error("The Base transaction did not succeed.");
  }
  const block = quantity(receipt.blockNumber, "Receipt block number");
  const latest = quantity(rawLatestBlock, "Latest block number");
  if (latest < block) throw new Error("Base RPC returned an inconsistent block height.");
  const confirmations = latest - block + 1n;
  if (confirmations < BigInt(BASE_USDC_MINIMUM_CONFIRMATIONS)) {
    throw new Error(`The USDC payment needs ${BASE_USDC_MINIMUM_CONFIRMATIONS} Base confirmations.`);
  }
  if (!Array.isArray(receipt.logs)) throw new Error("The transaction receipt has no event log.");
  const matches = (receipt.logs as ReceiptLog[]).flatMap((log) => {
    if (typeof log.address !== "string" || log.address.toLowerCase() !== BASE_USDC_CONTRACT) return [];
    if (!Array.isArray(log.topics) || String(log.topics[0]).toLowerCase() !== ERC20_TRANSFER_TOPIC) return [];
    if (log.topics.length !== 3) return [];
    const recipient = topicAddress(log.topics[2], "Transfer recipient");
    if (recipient !== recipientAddress) return [];
    const amount = quantity(log.data, "Transfer amount");
    if (amount !== BASE_USDC_PAYMENT_AMOUNT_ATOMIC) return [];
    return [{ senderAddress: topicAddress(log.topics[1], "Transfer sender") }];
  });
  if (matches.length !== 1) {
    throw new Error("The transaction must contain exactly one 149 USDC transfer to the configured wallet.");
  }
  if (block > BigInt(Number.MAX_SAFE_INTEGER) || latest > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Base block height exceeds SARA's safe numeric range.");
  }
  return {
    schemaVersion: 1,
    provider: "base-usdc-direct",
    chainId: BASE_MAINNET_CHAIN_ID,
    tokenContract: BASE_USDC_CONTRACT,
    transactionHash,
    transactionReferenceDigest: sha256(transactionHash),
    senderAddress: matches[0]!.senderAddress,
    recipientAddress,
    amountAtomic: "149000000",
    amountUsd: 149,
    blockNumber: Number(block),
    latestBlockNumber: Number(latest),
    confirmations: Number(confirmations),
    verifiedAt: (input.now ?? new Date()).toISOString(),
  };
}
