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
import { fetchExplorerStats } from "../explorer-stats";

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
  return useQuery<TokenRow[]>({
    queryKey: ["tokens", chainKey],
    refetchInterval: REFRESH,
    queryFn: async () => {
      const [gtRows, bsRows] = await Promise.all([
        fetchNetworkPools(chain).catch(() => []),
        fetchTokens(chain).catch(() => []),
      ]);

      if (gtRows.length === 0) return bsRows;

      const byAddr = new Map(gtRows.map((t) => [t.address, t]));
      const rest: TokenRow[] = [];
      for (const bs of bsRows) {
        const gt = byAddr.get(bs.address);
        if (gt) {
          // Enrich the DEX row with registry facts the pools API lacks.
          gt.holders = bs.holders || gt.holders;
          gt.logoUrl = gt.logoUrl ?? bs.logoUrl;
          gt.totalSupply = gt.totalSupply ?? bs.totalSupply;
          gt.mcap = gt.mcap || bs.mcap;
        } else {
          rest.push(bs);
        }
      }
      return [...gtRows, ...rest];
    },
  });
}

export interface RowEnrichment {
  holders?: number;
  dexName?: string;
  launchpadName?: string;
  graduated?: boolean;
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
              if (curve) {
                e.launchpadName = curve.dexName;
                e.graduated = Boolean(dex);
              }
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
 * Chain-wide recent swaps: the real trades feed for the busiest pools, merged
 * and newest-first. Powers whale watch + bundle detection on the terminal list.
 */
export function useChainTrades(tokens: TokenRow[] | undefined) {
  const { chain, chainKey } = useChain();
  const top = (tokens ?? [])
    .filter((t) => t.indexed && t.vol24h > 0)
    .slice(0, 3)
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
  const [detailRaw, market, pools, info] = await Promise.all([
    fetchTokenDetail(chain, addr),
    fetchTokenMarket(chain, addr).catch(() => null),
    fetchTokenPools(chain, addr).catch(() => []),
    fetchTokenInfo(chain, addr).catch(() => null),
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
      token.graduated = Boolean(dexPool);
      token.graduationPct = token.graduated ? 100 : 0;
      token.status = [...token.status, token.graduated ? "graduated" : "graduating"];
    }
  }

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
