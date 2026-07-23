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
  fetchOhlcv,
  fetchPoolTrades,
  fetchTokenMarket,
  fetchTokenPools,
} from "./geckoterminal";
import { getErc20Meta, getRpcHealth } from "./rpc";

// 30s keeps us comfortably under GeckoTerminal's free-tier rate limit
// (30 calls/min) with the pools + new_pools + stats calls per cycle.
const REFRESH = 30_000;

export function useChainStats() {
  const { chain, chainKey } = useChain();
  return useQuery<ChainStats>({
    queryKey: ["chain-stats", chainKey],
    refetchInterval: REFRESH,
    queryFn: async () => {
      const [explorer, health] = await Promise.all([
        fetchChainStats(chain),
        getRpcHealth(chainKey),
      ]);
      return {
        vol24h: explorer.vol24h ?? 0,
        launches24h: explorer.launches24h ?? 0,
        trades24h: explorer.trades24h ?? 0,
        totalTransactions: explorer.totalTransactions,
        totalAddresses: explorer.totalAddresses,
        gasPriceGwei: health.ok ? health.gasPriceGwei : explorer.gasPriceGwei,
        blockNumber: health.ok ? health.blockNumber : undefined,
        updatedAt: new Date(),
        live: Boolean(explorer.live) || health.ok,
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

  // 1. Explorer token record (name/symbol/holders/price if the chain has an oracle).
  let token = await fetchTokenDetail(chain, addr);

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

  // 3. DEX market enrichment + venue labels when the chain is indexed.
  const [market, pools] = await Promise.all([
    fetchTokenMarket(chain, addr).catch(() => null),
    fetchTokenPools(chain, addr).catch(() => []),
  ]);
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
  if (pools.length) {
    token.dexName = pools[0].dexName;
    const launchpadPool = pools.find((p) => p.isLaunchpad);
    const dexPool = pools.find((p) => !p.isLaunchpad);
    if (launchpadPool) {
      token.launchpadName = launchpadPool.dexName;
      token.graduated = Boolean(dexPool);
      token.graduationPct = token.graduated ? 100 : token.graduationPct;
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

/** Live close-price series for a pool at the chosen timeframe. */
export function useTokenOhlcv(pool: string | null, timeframe: ChartTimeframe) {
  const { chain, chainKey } = useChain();
  return useQuery<number[]>({
    queryKey: ["ohlcv", chainKey, pool, timeframe],
    enabled: Boolean(pool),
    refetchInterval: timeframe === "minute" ? REFRESH : 60_000,
    queryFn: () => (pool ? fetchOhlcv(chain, pool, timeframe) : Promise.resolve([])),
  });
}
