import type { WalletClient } from "viem";
import { CHAINS, type ChainKey } from "@/config/chains";

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
