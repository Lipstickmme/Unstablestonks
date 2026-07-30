import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  pad,
  type PublicClient,
  type WalletClient,
} from "viem";
import { FEE_RECIPIENT, PLATFORM_FEE_BPS } from "@/config/chains";
import type { BridgeChain } from "@/config/bridge-chains";

// ─────────────────────────────────────────────────────────────────────────────
// Circle CCTP v2 — native USDC bridging (burn on the source, mint on the
// destination). No wrapped assets, no liquidity pool, no third-party relayer
// holding funds.
//
// This is the rail Arc will bridge on: Arc is Circle's own chain and its gas
// asset IS USDC, so CCTP is the first-party path in and out of it.
//
// Flow:
//   1. approve USDC to TokenMessengerV2 on the source chain
//   2. depositForBurn(...)                     → burns USDC, emits a message
//   3. poll Circle's attestation API for that transaction's message + signature
//   4. receiveMessage(message, attestation) on the destination MessageTransmitter
//
// IMPORTANT — availability is probed, never assumed. Arc's bridge was not open
// at the time of writing, and hardcoding "supported" would have shown users a
// button that reverts. `cctpStatus()` checks for deployed contract code on both
// chains, so the route appears by itself on the day Circle turns it on, with no
// code change and no redeploy.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CCTP v2 uses the same deterministic addresses on every EVM domain (verified
 * identical on Ethereum, Arbitrum, Base and Linea). Overridable per chain in
 * case Circle deploys Arc elsewhere.
 */
export const TOKEN_MESSENGER_V2 = "0x28b5A0e9C621a5BadaA536219b3a228C8168cf5d" as const;
export const MESSAGE_TRANSMITTER_V2 = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as const;

/** Circle's attestation service. Sandbox serves the testnet domains. */
const IRIS_MAINNET = "https://iris-api.circle.com";
const IRIS_SANDBOX = "https://iris-api-sandbox.circle.com";

/**
 * A read client for any bridge chain, including ones the terminal doesn't
 * trade on (Ethereum, Base, Arbitrum). Cached per chain id.
 */
const clients = new Map<number, PublicClient>();
export function clientFor(c: BridgeChain): PublicClient {
  const hit = clients.get(c.id);
  if (hit) return hit;
  const client = createPublicClient({
    chain: defineChain({
      id: c.id,
      name: c.name,
      nativeCurrency: c.nativeCurrency,
      rpcUrls: { default: { http: c.rpcUrls } },
    }),
    transport: fallback(c.rpcUrls.map((u) => http(u, { timeout: 12_000 }))),
  }) as PublicClient;
  clients.set(c.id, client);
  return client;
}

const TOKEN_MESSENGER_ABI = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

const MESSAGE_TRANSMITTER_ABI = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Finality thresholds CCTP v2 accepts: 1000 = fast, 2000 = hard finality. */
const FAST_FINALITY = 1000;

export interface CctpStatus {
  /** True when both chains have live CCTP contracts and a USDC token address. */
  available: boolean;
  /** Human explanation when it isn't — shown verbatim in the UI. */
  reason?: string;
}

/** Does the chain expose a CCTP domain, a USDC address, and deployed contracts? */
async function contractsLive(c: BridgeChain): Promise<boolean> {
  if (c.cctpDomain == null) return false;
  try {
    const client = clientFor(c);
    const [messenger, transmitter] = await Promise.all([
      client.getCode({ address: TOKEN_MESSENGER_V2 }),
      client.getCode({ address: MESSAGE_TRANSMITTER_V2 }),
    ]);
    return Boolean(messenger && messenger !== "0x" && transmitter && transmitter !== "0x");
  } catch {
    return false;
  }
}

const statusCache = new Map<string, { ts: number; status: CctpStatus }>();
const STATUS_TTL = 5 * 60_000;

/**
 * Whether a CCTP transfer is possible between two chains right now. Cached
 * briefly so the bridge panel can call it on every keystroke.
 */
export async function cctpStatus(from: BridgeChain, to: BridgeChain): Promise<CctpStatus> {
  const cacheKey = `${from.key}>${to.key}`;
  const hit = statusCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < STATUS_TTL) return hit.status;

  let status: CctpStatus;
  if (from.cctpDomain == null || to.cctpDomain == null) {
    const missing = from.cctpDomain == null ? from.name : to.name;
    status = { available: false, reason: `${missing} is not a Circle CCTP domain.` };
  } else if (!from.usdc || !to.usdc) {
    const missing = from.usdc ? to.name : from.name;
    status = { available: false, reason: `No USDC contract known for ${missing}.` };
  } else {
    const [srcLive, dstLive] = await Promise.all([contractsLive(from), contractsLive(to)]);
    status =
      srcLive && dstLive
        ? { available: true }
        : {
            available: false,
            reason: `Circle's CCTP contracts aren't live on ${
              srcLive ? to.name : from.name
            } yet — this route opens automatically when they are.`,
          };
  }

  statusCache.set(cacheKey, { ts: Date.now(), status });
  return status;
}

/** An EVM address as the bytes32 CCTP expects. */
function toBytes32(addr: `0x${string}`): `0x${string}` {
  return pad(addr, { size: 32 });
}

export interface CctpProgress {
  message: string;
  txHash?: `0x${string}`;
  done?: boolean;
}

interface AttestationResponse {
  messages?: {
    message?: `0x${string}`;
    attestation?: `0x${string}`;
    status?: string;
  }[];
}

/**
 * Poll Circle for the attestation covering a burn transaction. Circle signs only
 * after the source chain reaches the requested finality, so this legitimately
 * takes from seconds (fast transfer) to ~15 minutes (hard finality).
 */
async function waitForAttestation(
  sourceDomain: number,
  txHash: `0x${string}`,
  testnet: boolean,
  onProgress?: (p: CctpProgress) => void,
  timeoutMs = 20 * 60_000,
): Promise<{ message: `0x${string}`; attestation: `0x${string}` } | null> {
  const base = testnet ? IRIS_SANDBOX : IRIS_MAINNET;
  const url = `${base}/v2/messages/${sourceDomain}?transactionHash=${txHash}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as AttestationResponse;
        const m = body.messages?.[0];
        if (m?.status === "complete" && m.message && m.attestation) {
          return { message: m.message, attestation: m.attestation };
        }
      }
    } catch {
      /* transient — keep polling */
    }
    onProgress?.({ message: "Waiting for Circle's attestation…" });
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return null;
}

/**
 * Burn USDC on the source chain and mint it on the destination.
 *
 * `amount` is the GROSS amount the user entered. CCTP has no fee hook of its
 * own — unlike Relay's appFees — so the platform fee is taken here as a plain
 * ERC-20 transfer before the burn, and only the remainder is bridged. That
 * costs one extra signature, which is why Relay is preferred when both rails
 * are available.
 */
export async function bridgeViaCctp(params: {
  from: BridgeChain;
  to: BridgeChain;
  /** Gross amount in USDC's smallest unit; the fee is deducted from it. */
  amount: bigint;
  account: `0x${string}`;
  sourceWallet: WalletClient;
  /** Called to obtain a wallet client on the destination chain for the mint. */
  destinationWallet: () => Promise<WalletClient | null>;
  onProgress?: (p: CctpProgress) => void;
}): Promise<`0x${string}` | undefined> {
  const { from, to, amount, account, sourceWallet, destinationWallet, onProgress } = params;

  const usdc = from.usdc?.address;
  if (!usdc) throw new Error(`No USDC contract known for ${from.name}.`);
  if (to.cctpDomain == null) throw new Error(`${to.name} is not a CCTP domain.`);

  const client = clientFor(from);
  const chain = sourceWallet.chain;

  // Burning is irreversible, so confirm the wallet is actually on the source
  // chain before anything is signed. Signing a burn against the wrong network
  // sends USDC to whatever contract sits at the TokenMessenger address there.
  const connected = await sourceWallet.getChainId().catch(() => 0);
  if (connected !== from.id) {
    throw new Error(`Your wallet is on the wrong network. Switch to ${from.name} and try again.`);
  }

  const fee = (amount * BigInt(PLATFORM_FEE_BPS)) / 10_000n;
  const bridged = amount - fee;
  if (bridged <= 0n) throw new Error("Amount too small to bridge.");

  // How many wallet prompts this run needs, so the progress text can count them.
  const allowance = (await client.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, TOKEN_MESSENGER_V2],
  })) as bigint;
  const needsApproval = allowance < bridged;
  const total = 1 + (fee > 0n ? 1 : 0) + (needsApproval ? 1 : 0);
  let step = 0;
  const prompt = () => onProgress?.({ message: `Confirm in your wallet (${++step}/${total})…` });

  // 1. Platform fee → treasury.
  if (fee > 0n) {
    prompt();
    const feeHash = await sourceWallet.writeContract({
      account,
      chain,
      address: usdc,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [FEE_RECIPIENT, fee],
    });
    await client.waitForTransactionReceipt({ hash: feeHash });
  }

  // 2. Approve the burner for the remainder if needed.
  //
  // Reset a stale non-zero allowance first: USDC's own contract doesn't require
  // it, but this same path carries USDT-lineage tokens on Stable, whose approve
  // reverts outright when the current allowance is non-zero. The approval is for
  // the exact amount rather than unlimited.
  if (needsApproval) {
    if (allowance > 0n) {
      prompt();
      const zeroHash = await sourceWallet.writeContract({
        account,
        chain,
        address: usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [TOKEN_MESSENGER_V2, 0n],
      });
      await client.waitForTransactionReceipt({ hash: zeroHash });
    }
    prompt();
    const approveHash = await sourceWallet.writeContract({
      account,
      chain,
      address: usdc,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [TOKEN_MESSENGER_V2, bridged],
    });
    await client.waitForTransactionReceipt({ hash: approveHash });
  }

  // 3. Burn on the source chain.
  prompt();
  const burnHash = await sourceWallet.writeContract({
    account,
    chain,
    address: TOKEN_MESSENGER_V2,
    abi: TOKEN_MESSENGER_ABI,
    functionName: "depositForBurn",
    args: [
      bridged,
      to.cctpDomain,
      toBytes32(account),
      usdc,
      // Zero destinationCaller = anyone may deliver the mint.
      toBytes32("0x0000000000000000000000000000000000000000"),
      // maxFee 0 with the fast threshold: Circle falls back to standard finality
      // rather than charging, so the transfer never costs more than quoted.
      0n,
      FAST_FINALITY,
    ],
  });
  await client.waitForTransactionReceipt({ hash: burnHash });

  // 4. Circle attests once the burn is final.
  onProgress?.({ message: "Waiting for Circle's attestation…", txHash: burnHash });
  const attested = await waitForAttestation(
    from.cctpDomain!,
    burnHash,
    // Circle's sandbox attestation service serves the testnet domains.
    from.key === "arc" && from.id !== 5042,
    onProgress,
  );
  if (!attested) {
    throw new Error(
      "Circle hasn't attested the burn yet. Your funds are safe — reopen the bridge to finish the mint.",
    );
  }

  // 5. Mint on the destination chain.
  onProgress?.({ message: `Switch to ${to.name} and confirm…` });
  const destWallet = await destinationWallet();
  if (!destWallet) {
    throw new Error(`Switch your wallet to ${to.name} to receive the funds.`);
  }

  // Same check on the receiving side. The attestation is already signed and the
  // funds are recoverable, so a wrong-network mint is not a loss — but it does
  // burn gas calling an unrelated contract, and the error it produces is
  // unreadable. Better to say what's wrong.
  const destConnected = await destWallet.getChainId().catch(() => 0);
  if (destConnected !== to.id) {
    throw new Error(
      `Switch your wallet to ${to.name} to receive the funds. Your USDC is safe — reopen the bridge to finish.`,
    );
  }

  const mintHash = await destWallet.writeContract({
    account,
    chain: destWallet.chain,
    address: MESSAGE_TRANSMITTER_V2,
    abi: MESSAGE_TRANSMITTER_ABI,
    functionName: "receiveMessage",
    args: [attested.message, attested.attestation],
  });

  onProgress?.({ message: "Bridged — funds are in your wallet.", txHash: mintHash, done: true });
  return mintHash;
}
