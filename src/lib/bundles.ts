import type { TradeEvent } from "./types";

export interface BundleStats {
  /** Number of same-block clusters (≥3 swaps landing together). */
  count: number;
  /** Share of the sampled swaps that were part of a cluster, 0..100. */
  pct: number;
  /** Biggest cluster size seen. */
  largest: number;
  /** USD traded inside clusters. */
  bundledUsd: number;
  /** How many swaps were analysed. */
  sample: number;
  risk: "low" | "elevated" | "high" | "none";
}

export const EMPTY_BUNDLE: BundleStats = {
  count: 0,
  pct: 0,
  largest: 0,
  bundledUsd: 0,
  sample: 0,
  risk: "none",
};

/**
 * Bundle detection over a real swap feed. Swaps sharing a block timestamp are
 * almost certainly coordinated (sniper/MEV/launch bundle); clusters of 3+ are
 * flagged. Shared by the token panel and the terminal list so both agree.
 */
export function analyzeBundles(trades: TradeEvent[]): BundleStats {
  if (!trades.length) return EMPTY_BUNDLE;

  const groups = new Map<number, TradeEvent[]>();
  for (const t of trades) {
    const sec = Math.floor(t.ms / 1000);
    const arr = groups.get(sec);
    if (arr) arr.push(t);
    else groups.set(sec, [t]);
  }

  const bundles = [...groups.values()].filter((g) => g.length >= 3);
  const bundledTrades = bundles.reduce((s, g) => s + g.length, 0);
  const largest = bundles.reduce((m, g) => Math.max(m, g.length), 0);
  const bundledUsd = bundles.reduce((s, g) => s + g.reduce((x, t) => x + t.amountUsd, 0), 0);
  const pct = (bundledTrades / trades.length) * 100;

  return {
    count: bundles.length,
    pct,
    largest,
    bundledUsd,
    sample: trades.length,
    risk: pct >= 40 ? "high" : pct >= 15 ? "elevated" : "low",
  };
}

/** Group a mixed feed by token, then analyse each token's swaps separately. */
export function analyzeBundlesByToken(trades: TradeEvent[]): Record<string, BundleStats> {
  const byToken = new Map<string, TradeEvent[]>();
  for (const t of trades) {
    if (!t.tokenAddress) continue;
    const arr = byToken.get(t.tokenAddress);
    if (arr) arr.push(t);
    else byToken.set(t.tokenAddress, [t]);
  }
  const out: Record<string, BundleStats> = {};
  for (const [addr, list] of byToken) out[addr] = analyzeBundles(list);
  return out;
}
