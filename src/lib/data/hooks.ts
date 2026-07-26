import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChain } from "@/lib/chain-context";
import type { ChainConfig, ChainKey } from "@/config/chains";
import type { ChainStats, TokenRow, TradeEvent } from "../types";
import {
  fetchAddressCreator,
  fetchChainStats,
  fetchTokenDetail,
  fetchTokenHolders,
  fetchTokens,
  fetchTokenTransfers,
} from "./blockscout";
import {
  fetchDexPaid,
  fetchDexScreenerMarkets,
  fetchDexScreenerTokens,
  type DexPaidStatus,
} from "./dexscreener";
import { fetchNewLaunches } from "./discovery";
import { fetchExplorerTokens } from "./explorer-tokens";
import {
  fetchNetworkPools,
  fetchOhlcvCandles,
  fetchPoolTrades,
  fetchTokenInfo,
  fetchTokenMarket,
  fetchTokenPools,
  type Candle,
} from "./geckoterminal";
import { getErc20Balance, getErc20Meta, getRpcHealth } from "./rpc";
import { fetchDyorToken, fetchDyorTokens, type DyorTokenInfo } from "./dyor";
import { fetchExplorerStats } from "../explorer-stats";
import { readCache, writeCache } from "../persist";

// 30s keeps us comfortably under GeckoTerminal's free-tier rate limit
// (30 calls/min) with the pools + new_pools + stats calls per cycle.
const REFRESH = 30_000;

/** DYOR's public JSON API is unconfirmed — opt in explicitly. */
const DYOR_ENABLED =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_DYOR_API === "1";

export function useChainStats() {
  const { chain, chainKey } = useChain();
  return useQuery<ChainStats>({
    queryKey: ["chain-stats", chainKey],
    refetchInterval: REFRESH,
    queryFn: async () => {
      const [explorer, health, scan] = await Promise.all([
        fetchChainStats(chain),
        getRpcHealth(chainKey),
        // Network totals, server-side: Blockscout /stats where available, else a
        // scrape of the Etherscan-style explorer (Stable). Applies to all chains.
        fetchExplorerStats({ data: { chain: chainKey } }).catch(() => null),
      ]);
      return {
        vol24h: explorer.vol24h ?? 0,
        launches24h: explorer.launches24h ?? 0,
        trades24h: scan?.transactions24h ?? explorer.trades24h ?? 0,
        totalTransactions: scan?.totalTransactions ?? explorer.totalTransactions,
        totalAddresses: scan?.totalAddresses ?? explorer.totalAddresses,
        newAddresses24h: scan?.newAddresses24h,
        tokensTotal: scan?.tokensTotal,
        contractsTotal: scan?.contractsTotal,
        gasPriceGwei: health.ok
          ? health.gasPriceGwei
          : (explorer.gasPriceGwei ?? scan?.gasPriceGwei),
        blockNumber: health.ok ? health.blockNumber : scan?.blockNumber,
        updatedAt: new Date(),
        live: Boolean(explorer.live) || health.ok || Boolean(scan?.ok),
        statSources: scan?.sources,
      };
    },
  });
}

/**
 * How many rows each source contributed on the last refresh, per chain. Surfaced
 * in the terminal so an empty list can be diagnosed from the screen instead of
 * guessed at — "geckoterminal 24 · explorer 0" says exactly which hop is dead.
 */
export interface SourceCounts {
  geckoterminal: number;
  dexscreener: number;
  blockscout: number;
  explorer: number;
  onchain: number;
  note?: string;
}

const sourceCounts = new Map<ChainKey, SourceCounts>();
const sourceListeners = new Set<() => void>();

function recordSources(key: ChainKey, counts: SourceCounts) {
  sourceCounts.set(key, counts);
  for (const l of sourceListeners) l();
}

/** Live per-source row counts for the active chain. */
export function useSourceCounts(): SourceCounts | undefined {
  const { chainKey } = useChain();
  return useSyncExternalStore(
    (cb) => {
      sourceListeners.add(cb);
      return () => sourceListeners.delete(cb);
    },
    () => sourceCounts.get(chainKey),
    () => undefined,
  );
}

/**
 * Fold `extra` into `into`, keeping whichever value is actually known. Market
 * figures are taken from the source that has them; a zero never overwrites a
 * real number, and identity fields (name/symbol/logo) prefer what's already set.
 */
function foldRow(into: TokenRow, extra: TokenRow): void {
  const better = (a: number, b: number) => (a > 0 ? a : b);

  into.price = better(into.price, extra.price);
  into.mcap = better(into.mcap, extra.mcap);
  into.fdv = better(into.fdv, extra.fdv);
  into.vol5m = better(into.vol5m, extra.vol5m);
  into.vol1h = better(into.vol1h, extra.vol1h);
  into.vol6h = better(into.vol6h, extra.vol6h);
  into.vol24h = better(into.vol24h, extra.vol24h);
  into.buys24h = better(into.buys24h, extra.buys24h);
  into.sells24h = better(into.sells24h, extra.sells24h);
  into.holders = better(into.holders, extra.holders);
  into.liquidityUsd = better(into.liquidityUsd ?? 0, extra.liquidityUsd ?? 0) || undefined;
  into.totalSupply = into.totalSupply ?? extra.totalSupply;
  into.decimals = into.decimals ?? extra.decimals;
  into.logoUrl = into.logoUrl ?? extra.logoUrl;
  into.dexName = into.dexName ?? extra.dexName;
  into.launchpadName = into.launchpadName ?? extra.launchpadName;
  into.sparkline = into.sparkline ?? extra.sparkline;
  if (into.priceChange24h === 0) into.priceChange24h = extra.priceChange24h;
  if (into.priceChange1h === 0) into.priceChange1h = extra.priceChange1h;
  if (into.ageMinutes < 0 && extra.ageMinutes >= 0) into.ageMinutes = extra.ageMinutes;
  if (!into.indexed && extra.indexed) {
    into.indexed = true;
    into.priceSource = extra.priceSource;
  }
  if (into.symbol === "?" && extra.symbol !== "?") {
    into.symbol = extra.symbol;
    into.name = extra.name;
    into.logo = extra.logo;
  }
  for (const s of extra.status) if (!into.status.includes(s)) into.status.push(s);
  if (!into.socials.website) into.socials.website = extra.socials.website;
  if (!into.socials.twitter) into.socials.twitter = extra.socials.twitter;
  if (!into.socials.telegram) into.socials.telegram = extra.socials.telegram;
}

/**
 * Token universe for the active chain — the union of five independent sources,
 * in priority order. Every one is optional: a source that fails or doesn't cover
 * the chain contributes nothing, and can never remove a row another source found.
 * Each one's row count is recorded for the on-screen source readout.
 *
 *  1. GeckoTerminal pools + new_pools (2 pages each) — the richest market data
 *     where the chain is indexed: 5m/1h/24h volumes, buys/sells, venue, trend.
 *  2. DexScreener — a second full list, found by searching the chain's own quote
 *     assets. Fills chains and tokens GeckoTerminal is behind on.
 *  3. Blockscout token registry — holders and icons, where a Blockscout instance
 *     exists for the chain at all.
 *  4. Explorer token scan — ERC-20 transfers through the DEX router, from the
 *     Etherscan-family API with the configured key. One request returns every
 *     token actually traded on the chain, newest first, with its metadata. This
 *     is the source that covers chains with no Blockscout and no DEX indexer.
 *  5. On-chain factory logs — pool-creation events read straight off the RPC.
 *     The only source that cannot lag, so it catches launches from minutes ago.
 *
 * Sources 4 and 5 arrive unpriced and pick up market data from 1/2 as indexers
 * catch up — an unpriced row is shown as "—", never as a fabricated zero.
 */
export function useTokens() {
  const { chain, chainKey } = useChain();
  const cacheKey = `tokens.${chainKey}`;
  return useQuery<TokenRow[]>({
    queryKey: ["tokens", chainKey],
    refetchInterval: REFRESH,
    // Paint immediately from the last good list, then refresh in the background.
    initialData: () => readCache<TokenRow[]>(cacheKey),
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      const [gtRows, dsRows, bsRows, explorerScan] = await Promise.all([
        fetchNetworkPools(chain).catch(() => [] as TokenRow[]),
        fetchDexScreenerTokens(chain).catch(() => [] as TokenRow[]),
        fetchTokens(chain).catch(() => [] as TokenRow[]),
        fetchExplorerTokens(chain).catch(() => ({ rows: [] as TokenRow[], note: "threw" })),
      ]);

      // The live pools tell the scanner which DEX factories this chain actually
      // uses, so launches are found on whatever venue they happen on.
      const poolHints = gtRows
        .map((r) => r.primaryPool)
        .filter((p): p is string => Boolean(p))
        .slice(0, 8);
      const freshRows = await fetchNewLaunches(chainKey, chain, poolHints).catch(
        () => [] as TokenRow[],
      );

      recordSources(chainKey, {
        geckoterminal: gtRows.length,
        dexscreener: dsRows.length,
        blockscout: bsRows.length,
        explorer: explorerScan.rows.length,
        onchain: freshRows.length,
        note: explorerScan.note,
      });

      const merged = new Map<string, TokenRow>();
      // Order matters: the first source to introduce an address owns its market
      // figures, later ones only fill blanks.
      for (const group of [gtRows, dsRows, bsRows, explorerScan.rows, freshRows]) {
        for (const row of group) {
          const cur = merged.get(row.address);
          if (cur) foldRow(cur, row);
          else merged.set(row.address, row);
        }
      }

      // Price whatever is still unpriced through DexScreener's batch endpoint —
      // one call covers 30 addresses, so this is cheap even on a full list.
      const unpriced = [...merged.values()].filter((t) => !t.indexed).map((t) => t.address);
      if (unpriced.length) {
        const priced = await fetchDexScreenerMarkets(chain, unpriced).catch(() => [] as TokenRow[]);
        for (const p of priced) {
          const cur = merged.get(p.address);
          if (cur) foldRow(cur, p);
        }
      }

      // Volume ranks the list, but a brand-new launch has none yet — so tokens
      // discovered in the last 24h sort by age at the top of the untraded tail.
      const rows = [...merged.values()].sort((a, b) => {
        if (a.vol24h !== b.vol24h) return b.vol24h - a.vol24h;
        const aNew = a.ageMinutes >= 0 && a.ageMinutes < 1440;
        const bNew = b.ageMinutes >= 0 && b.ageMinutes < 1440;
        if (aNew !== bNew) return aNew ? -1 : 1;
        return a.ageMinutes - b.ageMinutes;
      });

      if (rows.length) {
        writeCache(cacheKey, rows);
        return rows;
      }
      // Everything upstream failed — keep showing the last good list instead of
      // blanking the terminal.
      return readCache<TokenRow[]>(cacheKey, 60 * 60_000) ?? [];
    },
  });
}

/**
 * Merge DYOR launchpad facts onto a row: real bonding-curve progress and
 * graduation state, plus holders/logo where the row lacks them. When DYOR
 * reports no explicit progress we estimate it from liquidity against the
 * documented target and flag it as an estimate so the UI can say so.
 */
export function applyDyor(token: TokenRow, d: DyorTokenInfo): TokenRow {
  // Curve progress / graduation are deliberately NOT applied: they can't be
  // tracked consistently across all three chains, so we only take the facts
  // DYOR reports reliably — venue, holders, logo and launch time.
  token.launchpadName = token.launchpadName ?? "DYOR Fun";
  if (d.holders && !token.holders) token.holders = d.holders;
  if (d.logoUrl && !token.logoUrl) token.logoUrl = d.logoUrl;
  if (d.createdAtMs && token.ageMinutes < 0) {
    token.ageMinutes = Math.max(0, (Date.now() - d.createdAtMs) / 60_000);
  }
  return token;
}

export interface RowEnrichment {
  holders?: number;
  dexName?: string;
  launchpadName?: string;
  ageMinutes?: number;
  vol5m?: number;
  vol1h?: number;
  vol6h?: number;
  buys24h?: number;
  sells24h?: number;
  priceChange24h?: number;
  sparkline?: number[];
}

/**
 * Backfills rows the chain-wide pools page didn't cover — explorer-registry
 * tokens arrive with no venue, age, short-window volumes or trend (the "—"
 * cells). For the top rows by 24h volume we pull their own pools + token-info
 * and fill those gaps. Bounded and staggered to respect the free rate limit.
 */
export function useRowEnrichment(tokens: TokenRow[] | undefined) {
  const { chain, chainKey } = useChain();
  const targets = (tokens ?? [])
    .filter((t) => !t.dexName || !t.holders || t.ageMinutes < 0)
    .sort((a, b) => b.vol24h - a.vol24h)
    .slice(0, 12)
    .map((t) => t.address);
  const key = targets.join(",");
  return useQuery<Record<string, RowEnrichment>>({
    queryKey: ["row-enrichment", chainKey, key],
    enabled: targets.length > 0,
    staleTime: 120_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const out: Record<string, RowEnrichment> = {};
      const now = Date.now();
      for (let i = 0; i < targets.length; i += 3) {
        const batch = targets.slice(i, i + 3);
        await Promise.all(
          batch.map(async (addr) => {
            const [pools, info] = await Promise.all([
              fetchTokenPools(chain, addr).catch(() => []),
              fetchTokenInfo(chain, addr).catch(() => null),
            ]);
            const e: RowEnrichment = {};
            if (info?.holders) e.holders = info.holders;
            if (pools.length) {
              const top = pools[0];
              const curve = pools.find((p) => p.isLaunchpad);
              const dex = pools.find((p) => !p.isLaunchpad);
              e.dexName = top.dexName;
              if (curve) e.launchpadName = curve.dexName;
              void dex;
              // Oldest pool = the token's real launch age.
              const oldest = pools.reduce(
                (m, p) => (p.createdAtMs > 0 && (m === 0 || p.createdAtMs < m) ? p.createdAtMs : m),
                0,
              );
              if (oldest > 0) e.ageMinutes = Math.max(0, (now - oldest) / 60_000);
              e.vol5m = pools.reduce((s, p) => s + p.vol5m, 0);
              e.vol1h = pools.reduce((s, p) => s + p.vol1h, 0);
              e.vol6h = pools.reduce((s, p) => s + p.vol6h, 0);
              e.buys24h = pools.reduce((s, p) => s + p.buys24h, 0);
              e.sells24h = pools.reduce((s, p) => s + p.sells24h, 0);
              e.priceChange24h = top.priceChange24h;
              e.sparkline = top.sparkline;
            }
            if (Object.keys(e).length) out[addr] = e;
          }),
        );
      }
      return out;
    },
  });
}

export interface TokenInsight {
  /** Deployer's balance as a % of supply. */
  devHoldingPct?: number;
  /** Combined share of the ten largest holders. */
  top10Pct?: number;
  /** DexScreener paid listing — undefined when the chain isn't indexed there. */
  dexPaid?: boolean;
}

/**
 * Distribution + listing intel for the busiest rows: how much the deployer still
 * holds, how concentrated the top ten are, and whether the team paid DexScreener
 * for enhanced token info.
 *
 * Dev holding is read straight off the chain — the creator address from the
 * explorer, then a live `balanceOf` — rather than looked up in a top-N holders
 * page, so a deployer sitting outside the top ten is still counted correctly.
 * Runs on its own slow cycle over the top 8 rows so it never competes with the
 * market data feed.
 */
export function useTokenInsights(tokens: TokenRow[] | undefined) {
  const { chain, chainKey } = useChain();
  const targets = (tokens ?? [])
    .filter((t) => t.totalSupply && t.totalSupply > 0)
    .sort((a, b) => b.vol24h - a.vol24h)
    .slice(0, 8)
    .map((t) => ({
      address: t.address,
      decimals: t.decimals ?? 18,
      totalSupply: t.totalSupply as number,
    }));
  const key = targets.map((t) => t.address).join(",");

  return useQuery<Record<string, TokenInsight>>({
    queryKey: ["token-insights", chainKey, key],
    enabled: targets.length > 0,
    staleTime: 300_000,
    refetchInterval: 300_000,
    retry: 0,
    queryFn: async () => {
      const out: Record<string, TokenInsight> = {};
      await Promise.all(
        targets.map(async (t) => {
          const [holders, creator, paid] = await Promise.all([
            fetchTokenHolders(chain, t.address, t.decimals, t.totalSupply, 10).catch(() => []),
            fetchAddressCreator(chain, t.address).catch(() => ""),
            fetchDexPaid(chain, t.address).catch((): DexPaidStatus => ({ types: [] })),
          ]);

          const insight: TokenInsight = { dexPaid: paid.paid };

          if (holders.length) {
            const sum = holders.reduce((s, h) => s + h.pct, 0);
            if (sum > 0) insight.top10Pct = Math.min(100, sum);
          }

          if (creator && /^0x[0-9a-fA-F]{40}$/.test(creator)) {
            const bal = await getErc20Balance(
              chainKey,
              t.address as `0x${string}`,
              creator as `0x${string}`,
              t.decimals,
            ).catch(() => 0);
            if (bal >= 0 && t.totalSupply > 0) {
              insight.devHoldingPct = Math.min(100, (bal / t.totalSupply) * 100);
            }
          }

          out[t.address] = insight;
        }),
      );
      return out;
    },
  });
}

/**
 * DYOR Fun V3 launchpad data for the active chain — the only source that knows
 * which tokens launched on a bonding curve, how far along it they are, and
 * whether they graduated. Works identically on Robinhood, Stable and Arc.
 */
export function useDyorTokens() {
  const { chain, chainKey } = useChain();
  return useQuery<Record<string, DyorTokenInfo>>({
    queryKey: ["dyor-tokens", chainKey],
    // The DYOR site renders via React Server Components — there is no confirmed
    // public JSON endpoint — so this stays OFF by default and never blocks or
    // degrades the main list. Enable with VITE_DYOR_API=1 once a real route is known.
    enabled: DYOR_ENABLED && Boolean(chain.dyorSlug),
    staleTime: 300_000,
    refetchInterval: false,
    retry: 0,
    queryFn: () => fetchDyorTokens(chain),
  });
}

/**
 * Chain-wide recent swaps: the real trades feed for the busiest pools, merged
 * and newest-first. Powers whale watch + per-token bundle detection.
 */
export function useChainTrades(tokens: TokenRow[] | undefined) {
  const { chain, chainKey } = useChain();
  const top = (tokens ?? [])
    .filter((t) => t.indexed && t.vol24h > 0)
    .slice(0, 8)
    .map((t) => ({ address: t.address, symbol: t.symbol }));
  const key = top.map((t) => t.address).join(",");
  return useQuery<TradeEvent[]>({
    queryKey: ["chain-trades", chainKey, key],
    enabled: top.length > 0,
    refetchInterval: REFRESH,
    queryFn: async () => {
      const perToken = await Promise.all(
        top.map(async (t) => {
          const pools = await fetchTokenPools(chain, t.address).catch(() => []);
          const pool = pools[0]?.pool;
          if (!pool) return [] as TradeEvent[];
          const trades = await fetchPoolTrades(chain, pool, t.symbol).catch(
            () => [] as TradeEvent[],
          );
          return trades.map((x) => ({ ...x, tokenAddress: t.address }));
        }),
      );
      return perToken.flat().sort((a, b) => b.ms - a.ms);
    },
  });
}

export interface TokenDetailData {
  token: TokenRow;
  holders: { address: string; amount: number; pct: number }[];
  trades: TradeEvent[];
  /** Primary (deepest) pool address, when DEX-indexed — feeds the live chart. */
  pool: string | null;
}

async function loadTokenDetail(
  chain: ChainConfig,
  chainKey: ChainKey,
  address: string,
): Promise<TokenDetailData> {
  const addr = address.toLowerCase() as `0x${string}`;

  // 1. Fire the explorer record AND the GeckoTerminal calls concurrently — they
  //    only need the address, so there's no reason to wait for the explorer first.
  //    (Halves the time-to-first-paint on the token page.)
  const [detailRaw, market, pools, info, dyor] = await Promise.all([
    fetchTokenDetail(chain, addr),
    fetchTokenMarket(chain, addr).catch(() => null),
    fetchTokenPools(chain, addr).catch(() => []),
    fetchTokenInfo(chain, addr).catch(() => null),
    fetchDyorToken(chain, addr).catch(() => null),
  ]);
  let token = detailRaw;

  // 2. RPC fallback for metadata when the explorer doesn't know the token yet.
  if (!token) {
    const meta = await getErc20Meta(chainKey, addr);
    if (!meta) {
      throw new Error("Token not found on-chain");
    }
    token = {
      address: addr,
      name: meta.name,
      symbol: meta.symbol,
      logo: meta.symbol.slice(0, 2).toUpperCase(),
      ageMinutes: -1,
      price: 0,
      priceChange1h: 0,
      priceChange24h: 0,
      mcap: 0,
      fdv: 0,
      vol5m: 0,
      vol1h: 0,
      vol6h: 0,
      vol24h: 0,
      buys24h: 0,
      sells24h: 0,
      liquidityEth: 0,
      graduationPct: 0,
      holders: 0,
      topHolderPct: 0,
      deployer: "",
      status: [],
      socialHeat: 0,
      lockedLiquidity: false,
      feeSplit: "70/30",
      socials: {},
      lastTradeMs: Date.now(),
      priceSource: "none",
      indexed: false,
      totalSupply: meta.totalSupply,
      decimals: meta.decimals,
    };
  }

  // 3. Apply the DEX market + venue + token-info enrichment gathered above.
  if (market) {
    token.price = market.price || token.price;
    token.priceChange24h = market.priceChange24h;
    token.vol24h = market.volume24h || token.vol24h;
    token.mcap = market.mcap || token.mcap;
    token.fdv = market.fdv || token.fdv;
    token.liquidityUsd = market.liquidityUsd;
    token.priceSource = "geckoterminal";
    token.indexed = true;
  }
  if (info) {
    // Fill gaps left by the explorer (esp. Stable, which has no Blockscout list).
    if (!token.holders && info.holders) token.holders = info.holders;
    if (!token.logoUrl && info.logoUrl) token.logoUrl = info.logoUrl;
    if (info.socials.twitter || info.socials.telegram || info.socials.website) {
      token.socials = { ...token.socials, ...info.socials };
    }
  }
  if (pools.length) {
    token.dexName = pools[0].dexName;
    const launchpadPool = pools.find((p) => p.isLaunchpad);
    const dexPool = pools.find((p) => !p.isLaunchpad);
    // Only claim curve/graduation when the token actually trades on a
    // bonding-curve launchpad; a plain AMM listing gets no such label.
    if (launchpadPool) {
      token.launchpadName = launchpadPool.dexName;
    }
    void dexPool;
  }
  // DYOR is authoritative for curve progress + graduation on all three chains.
  if (dyor) applyDyor(token, dyor);

  // 4. Holders + trades in parallel.
  const decimals = token.decimals ?? 18;
  const pool = pools[0]?.pool ?? null;
  const [holders, transfers, dexTrades] = await Promise.all([
    fetchTokenHolders(chain, addr, decimals, token.totalSupply ?? 0),
    fetchTokenTransfers(chain, addr, token.symbol, token.price),
    pool
      ? fetchPoolTrades(chain, pool, token.symbol).catch(() => [] as TradeEvent[])
      : Promise.resolve([] as TradeEvent[]),
  ]);

  const trades = dexTrades.length
    ? dexTrades.map((t) => ({ ...t, tokenAddress: addr }))
    : transfers;

  if (holders[0]) token.topHolderPct = holders[0].pct;

  return { token, holders, trades, pool };
}

export function useTokenDetail(address: string) {
  const { chain, chainKey } = useChain();
  return useQuery<TokenDetailData>({
    queryKey: ["token-detail", chainKey, address.toLowerCase()],
    refetchInterval: REFRESH,
    retry: 1,
    queryFn: () => loadTokenDetail(chain, chainKey, address),
  });
}

export type ChartTimeframe = "minute" | "hour" | "day";

/** Live OHLC candles for a pool at the chosen timeframe (line + candlestick). */
export function useTokenCandles(pool: string | null, timeframe: ChartTimeframe) {
  const { chain, chainKey } = useChain();
  return useQuery<Candle[]>({
    queryKey: ["candles", chainKey, pool, timeframe],
    enabled: Boolean(pool),
    refetchInterval: timeframe === "minute" ? REFRESH : 60_000,
    queryFn: () => (pool ? fetchOhlcvCandles(chain, pool, timeframe) : Promise.resolve([])),
  });
}
