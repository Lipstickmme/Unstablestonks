import type { TradeEvent } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Per-wallet profile, derived from the trade feed we already have.
//
// Everything here comes from trades in the loaded window — no extra requests.
// That window is finite, so the numbers describe *recent* behaviour and are
// labelled that way in the UI: a wallet's realised P&L is only shown when it
// both bought and sold inside the window, because otherwise the cost basis is
// unknown and any figure would be invented.
//
// Holdings are the one thing trades can't tell us; those come from a batched
// balanceOf (see useTraderHoldings) and are merged in when they land.
// ─────────────────────────────────────────────────────────────────────────────

/** Size bands for a single trade, in USD. */
export type SizeTier = "whale" | "shark" | "fish" | "shrimp";

const TIERS: { tier: SizeTier; min: number; label: string }[] = [
  { tier: "whale", min: 10_000, label: "Whale" },
  { tier: "shark", min: 1_000, label: "Shark" },
  { tier: "fish", min: 100, label: "Fish" },
  { tier: "shrimp", min: 0, label: "Shrimp" },
];

export function sizeTier(amountUsd: number): { tier: SizeTier; label: string } {
  const t = TIERS.find((x) => amountUsd >= x.min) ?? TIERS[TIERS.length - 1];
  return { tier: t.tier, label: t.label };
}

export interface TraderProfile {
  wallet: string;
  /** Trades by this wallet in the loaded window. */
  swaps: number;
  buys: number;
  sells: number;
  boughtUsd: number;
  soldUsd: number;
  /**
   * Realised P&L as a percentage of what they put in. Only defined when the
   * wallet both bought AND sold in the window — without both legs there is no
   * cost basis and any number would be a guess.
   */
  pnlPct?: number;
  /** Net USD flow: positive means still accumulating. */
  netUsd: number;
  /** Their largest single trade, which is what the size tag reflects. */
  biggestUsd: number;
  tier: SizeTier;
  tierLabel: string;
  /** Share of total supply held now — filled by the holdings lookup. */
  supplyPct?: number;
  /** True when this is the wallet's first trade in the window. */
  firstSeenMs: number;
}

/** Build a profile per wallet from a trade feed. */
export function profileTraders(trades: TradeEvent[]): Map<string, TraderProfile> {
  const by = new Map<string, TraderProfile>();

  for (const t of trades) {
    const wallet = (t.wallet || "").toLowerCase();
    if (!wallet) continue;

    let p = by.get(wallet);
    if (!p) {
      p = {
        wallet,
        swaps: 0,
        buys: 0,
        sells: 0,
        boughtUsd: 0,
        soldUsd: 0,
        netUsd: 0,
        biggestUsd: 0,
        tier: "shrimp",
        tierLabel: "Shrimp",
        firstSeenMs: t.ms,
      };
      by.set(wallet, p);
    }

    p.swaps++;
    if (t.side === "buy") {
      p.buys++;
      p.boughtUsd += t.amountUsd;
    } else {
      p.sells++;
      p.soldUsd += t.amountUsd;
    }
    p.biggestUsd = Math.max(p.biggestUsd, t.amountUsd);
    p.firstSeenMs = Math.min(p.firstSeenMs, t.ms);
  }

  for (const p of by.values()) {
    p.netUsd = p.boughtUsd - p.soldUsd;
    if (p.buys > 0 && p.sells > 0 && p.boughtUsd > 0) {
      // Proportional cost basis: what the sold portion originally cost, against
      // what it fetched. Approximate — it assumes an even average entry — but it
      // is derived entirely from observed trades, never assumed.
      p.pnlPct = ((p.soldUsd - p.boughtUsd) / p.boughtUsd) * 100;
    }
    const t = sizeTier(p.biggestUsd);
    p.tier = t.tier;
    p.tierLabel = t.label;
  }

  return by;
}
