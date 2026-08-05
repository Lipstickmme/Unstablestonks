// DexScreener token orders — "is the DEX paid?".
//
// When a team buys DexScreener's Enhanced Token Info (or a boost/ad), the order
// is public at:
//   https://api.dexscreener.com/orders/v1/{chain}/{tokenAddress}
// It returns an array of { type, status, paymentTimestamp }. A token counts as
// "DEX paid" once at least one order reads status "approved".
//
// The chain must be one DexScreener indexes. As of now its published chain list
// covers neither Stable, Robinhood nor Arc, so `dexscreenerSlug` is unset for
// all three and these calls are skipped entirely instead of 404ing every cycle.
//
// When a slug IS configured we still probe once and remember the answer: a 404
// means the chain isn't listed after all, and there's no point re-asking on
// every token. The UI reports "unsupported" rather than "unpaid" — the team
// can't have skipped a listing that isn't offered.

import type { ChainConfig } from "@/config/chains";
import type { TokenRow } from "../types";
import { proxiedFetchJson } from "../net";

export interface DexPaidStatus {
  /** true = an approved paid order exists. false = none. undefined = unknown. */
  paid?: boolean;
  /** Order kinds seen, e.g. ["tokenProfile", "tokenAd"]. */
  types: string[];
  /** Set when the chain isn't on DexScreener, so the UI can say why. */
  unsupported?: boolean;
}

/** Chains that answered 404 — asked once, then never again this session. */
const unsupportedChains = new Set<string>();

interface DsOrder {
  type?: string;
  status?: string;
  paymentTimestamp?: number;
}

const cache = new Map<string, { ts: number; data: DexPaidStatus }>();
const TTL = 10 * 60_000; // paid status changes rarely

// ─────────────────────────────────────────────────────────────────────────────
// Discovering the DexScreener chain slug instead of being told it.
//
// This is why the paid checker never returned anything. The orders endpoint is
// /orders/v1/{chainSlug}/{token}, and `dexscreenerSlug` is unset for all three
// chains — nobody knew what DexScreener calls them, so the function returned
// "unsupported" on its first line and no request was ever made. The column read
// as "not indexed" whether or not that was true.
//
// DexScreener will tell us. /latest/dex/tokens/{address} takes a bare token
// address with no chain at all, and every pair it returns carries its own
// `chainId` — which IS the slug the orders endpoint wants. So one lookup either
// yields the slug or proves DexScreener has never seen the chain. Learned once
// per chain and cached, since it can only change if DexScreener adds support,
// and a reload picks that up.
// ─────────────────────────────────────────────────────────────────────────────

const learnedSlugs = new Map<string, string | null>();

async function resolveSlug(cfg: ChainConfig, address: string): Promise<string | null> {
  if (cfg.dexscreenerSlug) return cfg.dexscreenerSlug;

  const known = learnedSlugs.get(cfg.key);
  if (known !== undefined) return known;

  const body = await proxiedFetchJson<{ pairs?: DsPair[] | null }>(
    `https://api.dexscreener.com/latest/dex/tokens/${address}`,
    { timeoutMs: 8_000, headers: { Accept: "application/json" } },
  );
  const slug = body?.pairs?.find((p) => p.chainId)?.chainId ?? null;

  // Only remember a POSITIVE answer. A null here means this one token isn't
  // indexed, which is not the same as the chain being absent — the next token
  // asked gets a fresh chance.
  if (slug) learnedSlugs.set(cfg.key, slug);
  return slug;
}

export async function fetchDexPaid(cfg: ChainConfig, address: string): Promise<DexPaidStatus> {
  const slug = await resolveSlug(cfg, address);
  if (!slug) return { types: [], unsupported: true };
  if (unsupportedChains.has(slug)) return { types: [], unsupported: true };

  const key = `${slug}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const body = await proxiedFetchJson<DsOrder[]>(
    `https://api.dexscreener.com/orders/v1/${slug}/${address}`,
    { timeoutMs: 8_000, headers: { Accept: "application/json" } },
  );
  if (!Array.isArray(body)) {
    // A non-array answer for a configured slug means the chain isn't listed.
    // Remember it so the rest of the list doesn't repeat the same 404.
    unsupportedChains.add(slug);
    return { types: [], unsupported: true };
  }

  const approved = body.filter((o) => o.status === "approved");
  const data: DexPaidStatus = {
    paid: approved.length > 0,
    types: [...new Set(approved.map((o) => o.type ?? "").filter(Boolean))],
  };
  cache.set(key, { ts: Date.now(), data });
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// DexScreener as a market source.
//
// Two free, key-less endpoints:
//   /latest/dex/search?q=<address>   every pair containing that token
//   /latest/dex/tokens/<a,b,c…>      pairs for up to 30 token addresses
//
// Searching for the chain's own quote asset (USDT0 on Stable, WETH on Robinhood)
// returns the chain's pairs, which makes this a second full token list wherever
// DexScreener indexes the chain. Results are filtered by `chainId` so a search
// that matches a same-named token elsewhere can never leak another chain's rows.
// ─────────────────────────────────────────────────────────────────────────────

interface DsToken {
  address?: string;
  name?: string;
  symbol?: string;
}

interface DsPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: DsToken;
  quoteToken?: DsToken;
  priceUsd?: string;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { url?: string }[];
    socials?: { type?: string; url?: string }[];
  };
}

const num = (v: unknown) => {
  const x = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return isFinite(x) ? x : 0;
};

/** Fold a chain's DexScreener pairs into one row per base token. */
function rowsFromPairs(cfg: ChainConfig, pairs: DsPair[]): TokenRow[] {
  const slug = cfg.dexscreenerSlug;
  const now = Date.now();
  const quotes = new Set(
    [cfg.wrappedNative, cfg.stablecoin?.address, cfg.intermediary?.address]
      .filter(Boolean)
      .map((a) => (a as string).toLowerCase()),
  );

  const byAddress = new Map<string, TokenRow & { _liq: number }>();
  for (const p of pairs) {
    if (slug && p.chainId && p.chainId !== slug) continue;
    const base = p.baseToken;
    const address = (base?.address ?? "").toLowerCase();
    if (!address || quotes.has(address)) continue;

    const liq = num(p.liquidity?.usd);
    const createdMs = p.pairCreatedAt ?? 0;
    const ageMinutes = createdMs > 0 ? Math.max(0, (now - createdMs) / 60_000) : -1;
    const symbol = base?.symbol ?? "?";

    const existing = byAddress.get(address);
    if (existing) {
      // Multiple pools for one token: volumes add up, deepest pool prices it.
      existing.vol5m += num(p.volume?.m5);
      existing.vol1h += num(p.volume?.h1);
      existing.vol6h += num(p.volume?.h6);
      existing.vol24h += num(p.volume?.h24);
      existing.buys24h += num(p.txns?.h24?.buys);
      existing.sells24h += num(p.txns?.h24?.sells);
      existing.liquidityUsd = (existing.liquidityUsd ?? 0) + liq;
      if (liq > existing._liq) {
        existing._liq = liq;
        existing.price = num(p.priceUsd) || existing.price;
        existing.priceChange24h = num(p.priceChange?.h24);
        existing.priceChange1h = num(p.priceChange?.h1);
        existing.priceChange5m = num(p.priceChange?.m5);
        existing.dexName = p.dexId ?? existing.dexName;
      }
      if (ageMinutes >= 0 && (existing.ageMinutes < 0 || ageMinutes > existing.ageMinutes)) {
        existing.ageMinutes = ageMinutes;
      }
      continue;
    }

    const status: TokenRow["status"] = [];
    if (ageMinutes >= 0 && ageMinutes < 60) status.push("new");
    if (num(p.priceChange?.h24) >= 25 && num(p.volume?.h24) > 1000) status.push("trending");

    byAddress.set(address, {
      _liq: liq,
      address,
      name: base?.name ?? symbol,
      symbol,
      logo: symbol.slice(0, 2).toUpperCase(),
      logoUrl: p.info?.imageUrl,
      ageMinutes,
      price: num(p.priceUsd),
      priceChange1h: num(p.priceChange?.h1),
      priceChange24h: num(p.priceChange?.h24),
      priceChange5m: num(p.priceChange?.m5),
      mcap: num(p.marketCap) || num(p.fdv),
      fdv: num(p.fdv),
      vol5m: num(p.volume?.m5),
      vol1h: num(p.volume?.h1),
      vol6h: num(p.volume?.h6),
      vol24h: num(p.volume?.h24),
      buys24h: num(p.txns?.h24?.buys),
      sells24h: num(p.txns?.h24?.sells),
      liquidityEth: 0,
      liquidityUsd: liq,
      graduationPct: 0,
      holders: 0,
      topHolderPct: 0,
      deployer: "",
      status,
      socialHeat: 0,
      lockedLiquidity: false,
      feeSplit: "90/10",
      socials: {
        website: p.info?.websites?.[0]?.url,
        twitter: p.info?.socials?.find((s) => s.type === "twitter")?.url,
        telegram: p.info?.socials?.find((s) => s.type === "telegram")?.url,
      },
      lastTradeMs: 0,
      priceSource: "dexscreener",
      indexed: num(p.priceUsd) > 0,
      dexName: p.dexId,
    });
  }

  return [...byAddress.values()].map(({ _liq, ...row }) => {
    void _liq;
    return row;
  });
}

/**
 * The chain's token list according to DexScreener, discovered by searching for
 * its quote assets. Empty (never an error) when the chain isn't indexed.
 */
export async function fetchDexScreenerTokens(cfg: ChainConfig): Promise<TokenRow[]> {
  // No slug = DexScreener doesn't index this chain; skip the request entirely.
  if (!cfg.dexscreenerSlug) return [];
  const quotes = [cfg.intermediary?.address, cfg.wrappedNative, cfg.stablecoin?.address].filter(
    (a, i, arr) => a && arr.indexOf(a) === i,
  ) as string[];
  if (!quotes.length) return [];

  const results = await Promise.all(
    quotes
      .slice(0, 2)
      .map((q) =>
        proxiedFetchJson<{ pairs?: DsPair[] }>(
          `https://api.dexscreener.com/latest/dex/search?q=${q}`,
          { timeoutMs: 9_000, headers: { Accept: "application/json" } },
        ),
      ),
  );
  const pairs = results.flatMap((r) => r?.pairs ?? []);
  return pairs.length ? rowsFromPairs(cfg, pairs) : [];
}

/**
 * Market data for specific tokens (up to 30 per call) — used to price rows that
 * GeckoTerminal doesn't cover.
 */
export async function fetchDexScreenerMarkets(
  cfg: ChainConfig,
  addresses: string[],
): Promise<TokenRow[]> {
  if (!addresses.length || !cfg.dexscreenerSlug) return [];
  const batch = addresses.slice(0, 30).join(",");
  const body = await proxiedFetchJson<{ pairs?: DsPair[] }>(
    `https://api.dexscreener.com/latest/dex/tokens/${batch}`,
    { timeoutMs: 9_000, headers: { Accept: "application/json" } },
  );
  return body?.pairs?.length ? rowsFromPairs(cfg, body.pairs) : [];
}
