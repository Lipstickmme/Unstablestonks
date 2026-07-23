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
import { fetchOhlcv, fetchPoolTrades, fetchTokenMarket, fetchTopPool } from "./geckoterminal";
import { getErc20Meta, getRpcHealth } from "./rpc";

const REFRESH = 20_000;

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

export function useTokens() {
  const { chain, chainKey } = useChain();
  return useQuery<TokenRow[]>({
    queryKey: ["tokens", chainKey],
    refetchInterval: REFRESH,
    queryFn: () => fetchTokens(chain),
  });
}

export interface TokenDetailData {
  token: TokenRow;
  holders: { address: string; amount: number; pct: number }[];
  trades: TradeEvent[];
  chart: number[];
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
      ageMinutes: 0,
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

  // 3. DEX market enrichment (price/volume/liquidity) when the chain is indexed.
  const market = await fetchTokenMarket(chain, addr).catch(() => null);
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

  // 4. Holders + trades in parallel.
  const decimals = token.decimals ?? 18;
  const [holders, transfers, pool] = await Promise.all([
    fetchTokenHolders(chain, addr, decimals, token.totalSupply ?? 0),
    fetchTokenTransfers(chain, addr, token.symbol, token.price),
    fetchTopPool(chain, addr).catch(() => null),
  ]);

  let trades = transfers;
  let chart: number[] = [];
  if (pool) {
    const [dexTrades, ohlcv] = await Promise.all([
      fetchPoolTrades(chain, pool, token.symbol).catch(() => []),
      fetchOhlcv(chain, pool).catch(() => []),
    ]);
    if (dexTrades.length) trades = dexTrades.map((t) => ({ ...t, tokenAddress: addr }));
    chart = ohlcv;
  }

  if (holders[0]) token.topHolderPct = holders[0].pct;

  return { token, holders, trades, chart };
}

/**
 * Recent trade/transfer activity for the home feed. Uses the top indexed token on
 * the active chain (best liquidity/holders) and returns its latest transfers.
 */
export function useRecentActivity(tokens: TokenRow[] | undefined) {
  const { chain, chainKey } = useChain();
  const top = tokens?.find((t) => t.indexed) ?? tokens?.[0];
  return useQuery<TradeEvent[]>({
    queryKey: ["recent-activity", chainKey, top?.address],
    enabled: Boolean(top?.address),
    refetchInterval: REFRESH,
    queryFn: async () => {
      if (!top) return [];
      const pool = await fetchTopPool(chain, top.address).catch(() => null);
      if (pool) {
        const dex = await fetchPoolTrades(chain, pool, top.symbol).catch(() => []);
        if (dex.length) return dex.map((t) => ({ ...t, tokenAddress: top.address }));
      }
      return fetchTokenTransfers(chain, top.address, top.symbol, top.price);
    },
  });
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
