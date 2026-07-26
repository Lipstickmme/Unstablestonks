import { useQuery } from "@tanstack/react-query";
import { useChain } from "@/lib/chain-context";
import type { ChainConfig, ChainKey } from "@/config/chains";
import type { ChainStats, TokenRow, TradeEvent } from "../types";
import {
  fetchChainStats,
  fetchTokenDetail,
  fetchTokenHolders,
  fetchTokens,
  fetchTokenTransfers,
} from "./blockscout";
import {
  fetchNetworkPools,
  fetchOhlcvCandles,
  fetchPoolTrades,
  fetchTokenInfo,
  fetchTokenMarket,
  fetchTokenPools,
  type Candle,
} from "./geckoterminal";
import { getErc20Meta, getRpcHealth } from "./rpc";
import { fetchDyorToken, fetchDyorTokens, type DyorTokenInfo } from "./dyor";
import { fetchExplorerStats } from "../explorer-stats";
import { readCache, writeCache } from "../persist";

// 30s keeps us comfortably under GeckoTerminal's free-tier rate limit
// (30 calls/min) with the pools + new_pools + stats calls per cycle.
const REFRESH = 30_000;

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
        gasPriceGwei: health.ok ? health.gasPriceGwei : explorer.gasPriceGwei,
        blockNumber: health.ok ? health.blockNumber : undefined,
        updatedAt: new Date(),
        live: Boolean(explorer.live) || health.ok || Boolean(scan?.ok),
      };
    },
  });
}

/**
 * Token universe for the active chain. Two real sources merged:
 *  - GeckoTerminal pools (DEX-indexed chains): live 5m/1h/24h volumes, price
 *    changes, buys/sells, pool age, venue/launchpad labels, sparklines.
 *  - Blockscout token registry: holders, icons, explorer prices — and the only
 *    source on chains GeckoTerminal doesn't index yet.
 * GT rows lead (they carry live market structure); explorer data fills holders
 * for overlaps and appends registry-only tokens after.
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
      // All three sources run in parallel and are UNIONED — a slow or failing
      // source can only ever contribute less, never remove rows others found.
      const [gtRows, bsRows, dyor] = await Promise.all([
        fetchNetworkPools(chain).catch(() => [] as TokenRow[]),
        fetchTokens(chain).catch(() => [] as TokenRow[]),
        fetchDyorTokens(chain).catch(() => ({}) as Record<string, DyorTokenInfo>),
      ]);

      const merged = new Map<string, TokenRow>();
      // 1. DEX pools lead — they carry live market structure.
      for (const t of gtRows) merged.set(t.address, t);
      // 2. Explorer registry fills gaps and appends registry-only tokens.
      for (const bs of bsRows) {
        const cur = merged.get(bs.address);
        if (cur) {
          cur.holders = cur.holders || bs.holders;
          cur.logoUrl = cur.logoUrl ?? bs.logoUrl;
          cur.totalSupply = cur.totalSupply ?? bs.totalSupply;
          cur.mcap = cur.mcap || bs.mcap;
          cur.vol24h = cur.vol24h || bs.vol24h;
        } else {
          merged.set(bs.address, bs);
        }
      }
      // 3. Launchpad tokens the other two haven't indexed yet still show up.
      for (const [addr, d] of Object.entries(dyor)) {
        const cur = merged.get(addr);
        if (cur) {
          if (d.holders && !cur.holders) cur.holders = d.holders;
          if (d.logoUrl && !cur.logoUrl) cur.logoUrl = d.logoUrl;
          if (d.createdAtMs && cur.ageMinutes < 0) {
            cur.ageMinutes = Math.max(0, (Date.now() - d.createdAtMs) / 60_000);
          }
        } else {
          merged.set(addr, dyorToRow(addr, d));
        }
      }

      const rows = [...merged.values()].sort((a, b) => b.vol24h - a.vol24h);
      if (rows.length) writeCache(cacheKey, rows);
      return rows;
    },
  });
}

/** A launchpad token the DEX indexer and explorer haven't picked up yet. */
function dyorToRow(address: string, d: DyorTokenInfo): TokenRow {
  const symbol = d.symbol ?? "?";
  return {
    address,
    name: d.name ?? symbol,
    symbol,
    logo: symbol.slice(0, 2).toUpperCase(),
    logoUrl: d.logoUrl,
    ageMinutes: d.createdAtMs ? Math.max(0, (Date.now() - d.createdAtMs) / 60_000) : -1,
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
    holders: d.holders ?? 0,
    topHolderPct: 0,
    deployer: "",
    status: d.createdAtMs && Date.now() - d.createdAtMs < 3_600_000 ? ["new"] : [],
    socialHeat: 0,
    lockedLiquidity: false,
    feeSplit: "70/30",
    socials: {},
    lastTradeMs: Date.now(),
    priceSource: "none",
    indexed: false,
    launchpadName: "DYOR Fun",
  };
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

/**
 * DYOR Fun V3 launchpad data for the active chain — the only source that knows
 * which tokens launched on a bonding curve, how far along it they are, and
 * whether they graduated. Works identically on Robinhood, Stable and Arc.
 */
export function useDyorTokens() {
  const { chain, chainKey } = useChain();
  return useQuery<Record<string, DyorTokenInfo>>({
    queryKey: ["dyor-tokens", chainKey],
    staleTime: 60_000,
    refetchInterval: 90_000,
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
