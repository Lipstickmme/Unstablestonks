// DexScreener token orders — "is the DEX paid?".
//
// When a team buys DexScreener's Enhanced Token Info (or a boost/ad), the order
// is public at:
//   https://api.dexscreener.com/orders/v1/{chain}/{tokenAddress}
// It returns an array of { type, status, paymentTimestamp }. A token counts as
// "DEX paid" once at least one order reads status "approved".
//
// The chain must be one DexScreener indexes. For a chain it doesn't cover the
// call 404s and we report `undefined` — unknown, not "unpaid". The UI shows "—"
// in that case rather than implying the team skipped it.

import type { ChainConfig } from "@/config/chains";
import { proxiedFetchJson } from "../net";

export interface DexPaidStatus {
  /** true = an approved paid order exists. false = none. undefined = unknown. */
  paid?: boolean;
  /** Order kinds seen, e.g. ["tokenProfile", "tokenAd"]. */
  types: string[];
}

interface DsOrder {
  type?: string;
  status?: string;
  paymentTimestamp?: number;
}

const cache = new Map<string, { ts: number; data: DexPaidStatus }>();
const TTL = 10 * 60_000; // paid status changes rarely

export async function fetchDexPaid(cfg: ChainConfig, address: string): Promise<DexPaidStatus> {
  const slug = cfg.dexscreenerSlug;
  if (!slug) return { types: [] };

  const key = `${slug}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const body = await proxiedFetchJson<DsOrder[]>(
    `https://api.dexscreener.com/orders/v1/${slug}/${address}`,
    { timeoutMs: 8_000, headers: { Accept: "application/json" } },
  );
  // null = the chain isn't indexed or the request failed: unknown, not "unpaid".
  if (!Array.isArray(body)) return { types: [] };

  const approved = body.filter((o) => o.status === "approved");
  const data: DexPaidStatus = {
    paid: approved.length > 0,
    types: [...new Set(approved.map((o) => o.type ?? "").filter(Boolean))],
  };
  cache.set(key, { ts: Date.now(), data });
  return data;
}
