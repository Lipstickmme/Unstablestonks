import type { WalletClient } from "viem";
import { FEE_RECIPIENT, PLATFORM_FEE_BPS } from "@/config/chains";
import { bridgeChain, type BridgeChain } from "@/config/bridge-chains";
import { cctpStatus } from "./cctp";

// ─────────────────────────────────────────────────────────────────────────────
// Cross-chain transfers.
//
// Two rails, chosen at runtime:
//
//   Relay  — a solver network that quotes a route for almost any pair and
//            settles it. Handles native assets and chains CCTP doesn't cover.
//   CCTP   — Circle's burn-and-mint for native USDC. No wrapped asset, no
//            pooled liquidity, no relayer holding funds. Preferred where both
//            ends support it, and the first-party path in and out of Arc.
//
// Honest framing: neither is one atomic cross-chain transaction — no such thing
// exists. Both are a source-chain transaction plus a destination-side
// settlement. The user signs only what's required; the machinery stays hidden.
//
// The platform fee rides on Relay's own appFees mechanism — basis points on the
// input, accrued to an EVM claim address — so a Relay transfer stays a single
// signature and the quote shown is already net of the fee. CCTP has no such
// hook, so that path takes the fee as its own transfer (see cctp.ts).
// ─────────────────────────────────────────────────────────────────────────────

const RELAY_API = "https://api.relay.link";

/** Relay uses the zero address for a chain's native currency. */
export const NATIVE = "0x0000000000000000000000000000000000000000" as const;

// ── Route availability, discovered at runtime ────────────────────────────────
// Chains launch, and rails add support, without asking us. Hardcoding
// "unsupported" needs a redeploy the day it opens; hardcoding "supported" shows
// a button that reverts. So both rails are probed:
//   Relay — GET /chains lists every chain it routes. Cached for 10 minutes.
//   CCTP  — the contracts are checked for deployed code on both chains.

let relayChains: { ids: Set<number>; ts: number } | null = null;
const RELAY_CHAINS_TTL = 10 * 60_000;

async function relaySupportedChainIds(): Promise<Set<number>> {
  if (relayChains && Date.now() - relayChains.ts < RELAY_CHAINS_TTL) return relayChains.ids;
  const ids = new Set<number>();
  try {
    const res = await fetch(`${RELAY_API}/chains`);
    if (res.ok) {
      const body = (await res.json()) as { chains?: { id?: number }[] };
      for (const c of body.chains ?? []) if (typeof c.id === "number") ids.add(c.id);
    }
  } catch {
    /* unreachable — treat as unknown, see relaySupports */
  }
  // Only cache a real answer. An empty set means "couldn't tell", and caching
  // that would suppress the route for ten minutes after a transient failure.
  if (ids.size) relayChains = { ids, ts: Date.now() };
  return ids;
}

/**
 * True when Relay routes this chain. Unknown (API unreachable) counts as yes —
 * the quote itself is the real check and reports its own reason, so an outage
 * can't silently hide a working route.
 */
export async function relaySupports(chainId: number): Promise<boolean> {
  const ids = await relaySupportedChainIds();
  return ids.size === 0 || ids.has(chainId);
}

export type BridgeRail = "relay" | "cctp";

export interface BridgeRoutes {
  /** Rails that can carry this pair right now, best first. */
  rails: BridgeRail[];
  /** Why nothing is available, when rails is empty. */
  reason?: string;
}

/**
 * Which rails can move funds between two chains at this moment. CCTP is
 * preferred where both ends support it: it mints the real asset rather than a
 * wrapped claim on one, and on Arc and Stable that asset IS the gas token.
 */
export async function availableRails(from: string, to: string): Promise<BridgeRoutes> {
  const src = bridgeChain(from);
  const dst = bridgeChain(to);
  if (!src || !dst) return { rails: [], reason: "Unknown chain." };
  if (src.id === dst.id) return { rails: [], reason: "Pick two different chains." };

  const [cctp, relayOk] = await Promise.all([
    cctpStatus(src, dst),
    Promise.all([relaySupports(src.id), relaySupports(dst.id)]).then(([a, b]) => a && b),
  ]);

  const rails: BridgeRail[] = [];
  if (cctp.available) rails.push("cctp");
  if (relayOk) rails.push("relay");

  if (rails.length) return { rails };
  return {
    rails: [],
    reason:
      cctp.reason ??
      `No route between ${src.name} and ${dst.name} yet — this opens automatically when one is live.`,
  };
}

// ── Relay ────────────────────────────────────────────────────────────────────

interface RelayStepItem {
  status?: string;
  data?: {
    to?: `0x${string}`;
    data?: `0x${string}`;
    value?: string;
    chainId?: number;
    from?: `0x${string}`;
  };
}

interface RelayStep {
  id?: string;
  action?: string;
  description?: string;
  kind?: "transaction" | "signature";
  items?: RelayStepItem[];
}

interface RelayQuoteResponse {
  steps?: RelayStep[];
  fees?: {
    app?: { amountFormatted?: string; amountUsd?: string };
    relayer?: { amountFormatted?: string; amountUsd?: string };
  };
  details?: {
    currencyIn?: { amount?: string; amountFormatted?: string; amountUsd?: string };
    currencyOut?: {
      amount?: string;
      amountFormatted?: string;
      amountUsd?: string;
      currency?: { symbol?: string };
    };
    totalImpact?: { percent?: string };
    timeEstimate?: number;
  };
  message?: string;
}

export interface BridgeQuote {
  ok: boolean;
  reason?: string;
  /** Human-readable amount that lands on the destination chain. */
  amountOut?: string;
  amountOutSymbol?: string;
  amountOutUsd?: string;
  /** Seconds Relay expects the route to take. */
  etaSeconds?: number;
  impactPercent?: string;
  /** Platform fee Relay is collecting on this quote, in input units. */
  appFeeFormatted?: string;
  steps: RelayStep[];
}

/**
 * Quote a transfer through Relay.
 *
 * `amount` is in the origin currency's smallest unit. The platform fee is
 * attached as an appFee, so Relay takes PLATFORM_FEE_BPS of the input and
 * accrues it to FEE_RECIPIENT: no extra transaction, and the amount quoted to
 * the user is already net of it.
 */
export async function getBridgeQuote(params: {
  user: `0x${string}`;
  from: string;
  to: string;
  amount: string;
  originCurrency?: string;
  destinationCurrency?: string;
  recipient?: `0x${string}`;
}): Promise<BridgeQuote> {
  const src = bridgeChain(params.from);
  const dst = bridgeChain(params.to);
  if (!src || !dst) return { ok: false, reason: "Unknown chain.", steps: [] };

  try {
    const res = await fetch(`${RELAY_API}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: params.user,
        recipient: params.recipient ?? params.user,
        originChainId: src.id,
        destinationChainId: dst.id,
        originCurrency: params.originCurrency ?? NATIVE,
        destinationCurrency: params.destinationCurrency ?? NATIVE,
        amount: params.amount,
        tradeType: "EXACT_INPUT",
        referrer: "unstablestonks",
        appFees: [{ recipient: FEE_RECIPIENT, fee: String(PLATFORM_FEE_BPS) }],
      }),
    });

    const body = (await res.json().catch(() => null)) as RelayQuoteResponse | null;
    if (!res.ok || !body?.steps?.length) {
      return {
        ok: false,
        reason: body?.message ?? `No route from ${src.name} to ${dst.name}.`,
        steps: [],
      };
    }

    return {
      ok: true,
      amountOut: body.details?.currencyOut?.amountFormatted,
      amountOutSymbol: body.details?.currencyOut?.currency?.symbol,
      amountOutUsd: body.details?.currencyOut?.amountUsd,
      etaSeconds: body.details?.timeEstimate,
      impactPercent: body.details?.totalImpact?.percent,
      appFeeFormatted: body.fees?.app?.amountFormatted,
      steps: body.steps,
    };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Quote failed.",
      steps: [],
    };
  }
}

export interface BridgeProgress {
  /** Short, user-facing status — the only thing the UI shows. */
  message: string;
  txHash?: `0x${string}`;
  done?: boolean;
}

/**
 * Execute a quoted Relay route. Signs each required step in order and reports
 * simple progress; the step plumbing never reaches the UI.
 */
export async function executeBridge(params: {
  quote: BridgeQuote;
  walletClient: WalletClient;
  account: `0x${string}`;
  from: BridgeChain;
  onProgress?: (p: BridgeProgress) => void;
}): Promise<`0x${string}` | undefined> {
  const { quote, walletClient, account, onProgress } = params;
  const chain = walletClient.chain;

  // Only transaction steps need a wallet prompt; Relay handles the rest.
  const txItems = quote.steps
    .filter((s) => s.kind !== "signature")
    .flatMap((s) => s.items ?? [])
    .filter((i) => i.data?.to && i.status !== "complete");

  if (txItems.length === 0) {
    throw new Error("Nothing to sign for this route.");
  }

  let last: `0x${string}` | undefined;
  for (let i = 0; i < txItems.length; i++) {
    const d = txItems[i].data!;
    onProgress?.({
      message:
        txItems.length > 1
          ? `Confirm in your wallet (${i + 1}/${txItems.length})…`
          : "Confirm in your wallet…",
    });

    last = await walletClient.sendTransaction({
      account,
      chain,
      to: d.to!,
      data: d.data,
      value: d.value ? BigInt(d.value) : undefined,
    });
  }

  onProgress?.({ message: "Bridging — funds arrive shortly.", txHash: last, done: true });
  return last;
}
