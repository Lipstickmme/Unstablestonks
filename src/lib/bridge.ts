import type { WalletClient } from "viem";
import { CHAINS, type ChainKey } from "@/config/chains";
import { cctpStatus } from "./cctp";

// ─────────────────────────────────────────────────────────────────────────────
// Cross-chain bridging via Relay (https://relay.link).
//
// Relay quotes a route and returns ready-to-sign steps. We deliberately keep the
// machinery invisible: the caller gets a single progress string ("Confirm in
// your wallet…", "Bridging…") and we sign whatever steps come back in order.
//
// Honest framing: this is NOT one atomic cross-chain transaction — no such thing
// exists. It's a source-chain transaction plus a relayer-settled destination
// leg. The user signs once per required step; we surface only those prompts.
// ─────────────────────────────────────────────────────────────────────────────

const RELAY_API = "https://api.relay.link";

// ─────────────────────────────────────────────────────────────────────────────
// Route availability, discovered at runtime.
//
// Arc launched days ago and its bridges are not open yet. Rather than hardcode
// "unsupported" (which would need a redeploy the day it opens) or hardcode
// "supported" (which would show a button that reverts), both rails are probed:
//
//   Relay — GET /chains lists every chain it routes. Cached for 10 minutes.
//   CCTP  — the contracts are checked for deployed code on both chains.
//
// The bridge lights up on its own the moment either rail adds the chain.
// ─────────────────────────────────────────────────────────────────────────────

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
  // Only cache a real answer; an empty set means "couldn't tell", and caching
  // that would suppress the route for ten minutes after a transient failure.
  if (ids.size) relayChains = { ids, ts: Date.now() };
  return ids;
}

/** True when Relay routes this chain. Unknown (API down) counts as yes — the
 *  quote itself is the real check and reports its own reason. */
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
 * preferred where both ends support it: it mints native USDC rather than a
 * wrapped asset, and on Arc that IS the gas token.
 */
export async function availableRails(from: ChainKey, to: ChainKey): Promise<BridgeRoutes> {
  const src = CHAINS[from];
  const dst = CHAINS[to];

  const [cctp, relayOk] = await Promise.all([
    cctpStatus({ key: from, cfg: src }, { key: to, cfg: dst }),
    relaySupports(dst.id).then((ok) => ok && relaySupports(src.id)),
  ]);

  const rails: BridgeRail[] = [];
  if (cctp.available) rails.push("cctp");
  if (relayOk) rails.push("relay");

  if (rails.length) return { rails };
  return {
    rails: [],
    reason:
      cctp.reason ??
      `No bridge route between ${src.name} and ${dst.name} yet — this opens automatically when one is live.`,
  };
}

/** Relay uses the zero address for a chain's native currency. */
export const NATIVE = "0x0000000000000000000000000000000000000000" as const;

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
  details?: {
    currencyIn?: { amount?: string; amountFormatted?: string; amountUsd?: string };
    currencyOut?: { amount?: string; amountFormatted?: string; amountUsd?: string };
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
  amountOutUsd?: string;
  /** Seconds Relay expects the route to take. */
  etaSeconds?: number;
  impactPercent?: string;
  steps: RelayStep[];
}

/**
 * Quote a bridge (optionally bridge+swap) from one chain to another.
 * `amount` is in the origin currency's smallest unit.
 */
export async function getBridgeQuote(params: {
  user: `0x${string}`;
  from: ChainKey;
  to: ChainKey;
  amount: string;
  originCurrency?: string;
  destinationCurrency?: string;
  recipient?: `0x${string}`;
}): Promise<BridgeQuote> {
  const originChainId = CHAINS[params.from].id;
  const destinationChainId = CHAINS[params.to].id;

  try {
    const res = await fetch(`${RELAY_API}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: params.user,
        recipient: params.recipient ?? params.user,
        originChainId,
        destinationChainId,
        originCurrency: params.originCurrency ?? NATIVE,
        destinationCurrency: params.destinationCurrency ?? NATIVE,
        amount: params.amount,
        tradeType: "EXACT_INPUT",
      }),
    });

    const body = (await res.json().catch(() => null)) as RelayQuoteResponse | null;
    if (!res.ok || !body?.steps?.length) {
      return {
        ok: false,
        reason:
          body?.message ??
          `No route from ${CHAINS[params.from].name} to ${CHAINS[params.to].name}.`,
        steps: [],
      };
    }

    return {
      ok: true,
      amountOut: body.details?.currencyOut?.amountFormatted,
      amountOutUsd: body.details?.currencyOut?.amountUsd,
      etaSeconds: body.details?.timeEstimate,
      impactPercent: body.details?.totalImpact?.percent,
      steps: body.steps,
    };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Bridge quote failed.",
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
 * Execute a quoted route. Signs each required step in order and reports simple
 * progress; the step plumbing never reaches the UI.
 */
export async function executeBridge(params: {
  quote: BridgeQuote;
  walletClient: WalletClient;
  account: `0x${string}`;
  from: ChainKey;
  onProgress?: (p: BridgeProgress) => void;
}): Promise<`0x${string}` | undefined> {
  const { quote, walletClient, account, from, onProgress } = params;
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

  void from;
  onProgress?.({ message: "Bridging — funds arrive shortly.", txHash: last, done: true });
  return last;
}
