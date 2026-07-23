// GeckoTerminal v2 public API — free, key-less DEX market data (price, 24h volume,
// price change, real buy/sell trades). Only queried for chains we've mapped to a
// GeckoTerminal network slug; new chains that aren't indexed yet simply return
// empty and the terminal falls back to explorer + RPC data. No fabrication.

import type { ChainConfig } from "@/config/chains";
import type { TradeEvent } from "../types";

const GT = "https://api.geckoterminal.com/api/v2";

async function gt<T>(path: string, timeoutMs = 12_000): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${GT}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json;version=20230302" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const n = (v: unknown) => {
  const x = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return isFinite(x) ? x : 0;
};

export interface TokenMarket {
  price: number;
  priceChange24h: number;
  volume24h: number;
  mcap: number;
  fdv: number;
  liquidityUsd: number;
}

interface GtTokenResp {
  data?: {
    attributes?: {
      price_usd?: string;
      fdv_usd?: string;
      market_cap_usd?: string | null;
      total_reserve_in_usd?: string;
      volume_usd?: { h24?: string };
      price_change_percentage?: { h24?: string };
    };
  };
}

export async function fetchTokenMarket(
  cfg: ChainConfig,
  address: string,
): Promise<TokenMarket | null> {
  if (!cfg.geckoterminalNetwork) return null;
  const data = await gt<GtTokenResp>(`/networks/${cfg.geckoterminalNetwork}/tokens/${address}`);
  const a = data?.data?.attributes;
  if (!a?.price_usd) return null;
  return {
    price: n(a.price_usd),
    priceChange24h: n(a.price_change_percentage?.h24),
    volume24h: n(a.volume_usd?.h24),
    mcap: n(a.market_cap_usd) || n(a.fdv_usd),
    fdv: n(a.fdv_usd),
    liquidityUsd: n(a.total_reserve_in_usd),
  };
}

interface GtPoolsResp {
  data?: {
    id?: string;
    attributes?: { address?: string };
    relationships?: { base_token?: { data?: { id?: string } } };
  }[];
}

/** First pool address for a token, needed to pull trades. */
export async function fetchTopPool(cfg: ChainConfig, address: string): Promise<string | null> {
  if (!cfg.geckoterminalNetwork) return null;
  const data = await gt<GtPoolsResp>(
    `/networks/${cfg.geckoterminalNetwork}/tokens/${address}/pools`,
  );
  return data?.data?.[0]?.attributes?.address ?? null;
}

interface GtTradesResp {
  data?: {
    id?: string;
    attributes?: {
      kind?: "buy" | "sell";
      volume_in_usd?: string;
      block_timestamp?: string;
      tx_hash?: string;
      tx_from_address?: string;
      price_to_in_usd?: string;
    };
  }[];
}

interface GtOhlcvResp {
  data?: { attributes?: { ohlcv_list?: number[][] } };
}

/** Real close-price series for a pool (oldest→newest). Empty when not indexed. */
export async function fetchOhlcv(
  cfg: ChainConfig,
  pool: string,
  timeframe: "minute" | "hour" | "day" = "hour",
): Promise<number[]> {
  if (!cfg.geckoterminalNetwork) return [];
  const data = await gt<GtOhlcvResp>(
    `/networks/${cfg.geckoterminalNetwork}/pools/${pool}/ohlcv/${timeframe}?limit=100`,
  );
  const list = data?.data?.attributes?.ohlcv_list;
  if (!list?.length) return [];
  // ohlcv row = [timestamp, open, high, low, close, volume]; take close, oldest→newest.
  return list
    .slice()
    .reverse()
    .map((row) => n(row[4]))
    .filter((v) => v > 0);
}

export async function fetchPoolTrades(
  cfg: ChainConfig,
  pool: string,
  symbol: string,
): Promise<TradeEvent[]> {
  if (!cfg.geckoterminalNetwork) return [];
  const data = await gt<GtTradesResp>(`/networks/${cfg.geckoterminalNetwork}/pools/${pool}/trades`);
  if (!data?.data?.length) return [];
  return data.data.slice(0, 40).map((tr, i) => {
    const a = tr.attributes ?? {};
    return {
      id: tr.id ?? `${a.tx_hash}-${i}`,
      tokenAddress: "",
      symbol,
      side: a.kind === "sell" ? "sell" : "buy",
      amountUsd: n(a.volume_in_usd),
      priceImpact: 0,
      wallet: a.tx_from_address ?? "",
      ms: a.block_timestamp ? new Date(a.block_timestamp).getTime() : Date.now() - i * 1000,
      txHash: a.tx_hash,
    };
  });
}
