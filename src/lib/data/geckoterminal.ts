// GeckoTerminal v2 public API — free, key-less DEX market data (price, 24h volume,
// price change, real buy/sell trades). Only queried for chains we've mapped to a
// GeckoTerminal network slug; new chains that aren't indexed yet simply return
// empty and the terminal falls back to explorer + RPC data. No fabrication.

import type { ChainConfig } from "@/config/chains";
import type { TokenRow, TradeEvent } from "../types";

import { proxiedFetchJson } from "../net";

const GT = "https://api.geckoterminal.com/api/v2";

async function gt<T>(path: string, timeoutMs = 12_000): Promise<T | null> {
  return proxiedFetchJson<T>(`${GT}${path}`, {
    timeoutMs,
    headers: { Accept: "application/json;version=20230302" },
  });
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

interface GtPool {
  id?: string;
  attributes?: {
    address?: string;
    name?: string;
    pool_created_at?: string;
    base_token_price_usd?: string;
    reserve_in_usd?: string;
    fdv_usd?: string;
    market_cap_usd?: string | null;
    price_change_percentage?: { m5?: string; h1?: string; h6?: string; h24?: string };
    transactions?: { h24?: { buys?: number; sells?: number } };
    volume_usd?: { m5?: string; h1?: string; h6?: string; h24?: string };
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
}

interface GtIncluded {
  id?: string;
  type?: string;
  attributes?: {
    address?: string;
    name?: string;
    symbol?: string;
    image_url?: string | null;
    decimals?: number;
  };
}

interface GtPoolsResp {
  data?: GtPool[];
  included?: GtIncluded[];
}

/** Heuristic: DEX ids/names that identify bonding-curve launchpads vs regular DEXs. */
const LAUNCHPAD_RE = /fun|pump|bags|launch|curve|pons|moon/i;

function prettyDex(id: string): string {
  return id
    .replace(/[-_]/g, " ")
    .replace(/\b(v[0-9])\b/gi, (m) => m.toUpperCase())
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Rebuild a real 5-point trend [-24h,-6h,-1h,-5m,now] from pct changes. */
function sparklineFrom(pc: { m5?: string; h1?: string; h6?: string; h24?: string }): number[] {
  const back = (chg: number) => (chg > -99.9 ? 1 / (1 + chg / 100) : 1);
  return [back(n(pc.h24)), back(n(pc.h6)), back(n(pc.h1)), back(n(pc.m5)), 1];
}

export interface TokenPoolInfo {
  pool: string;
  dexId: string;
  dexName: string;
  isLaunchpad: boolean;
}

/** Pools (with venue labels) a token trades in, best-liquidity first. */
export async function fetchTokenPools(cfg: ChainConfig, address: string): Promise<TokenPoolInfo[]> {
  if (!cfg.geckoterminalNetwork) return [];
  const data = await gt<GtPoolsResp>(
    `/networks/${cfg.geckoterminalNetwork}/tokens/${address}/pools?include=dex`,
  );
  if (!data?.data?.length) return [];
  const dexNames = new Map(
    (data.included ?? [])
      .filter((i) => i.type === "dex")
      .map((i) => [i.id ?? "", i.attributes?.name ?? prettyDex(i.id ?? "")]),
  );
  return data.data
    .filter((p) => p.attributes?.address)
    .map((p) => {
      const dexId = p.relationships?.dex?.data?.id ?? "";
      return {
        pool: p.attributes!.address!,
        dexId,
        dexName: dexNames.get(dexId) ?? prettyDex(dexId),
        isLaunchpad: LAUNCHPAD_RE.test(dexId),
      };
    });
}

/** Back-compat helper: first (deepest) pool address for a token. */
export async function fetchTopPool(cfg: ChainConfig, address: string): Promise<string | null> {
  const pools = await fetchTokenPools(cfg, address);
  return pools[0]?.pool ?? null;
}

/**
 * The DEX-indexed token universe for a chain: top pools + newest pools, merged
 * and deduped by base token. Provides REAL 5m/1h/24h volumes, price changes,
 * buy/sell counts, pool age, liquidity, and the venue (DEX or launchpad) each
 * token trades on — including graduation (launchpad pool + regular DEX pool).
 */
export async function fetchNetworkPools(cfg: ChainConfig): Promise<TokenRow[]> {
  if (!cfg.geckoterminalNetwork) return [];
  const net = cfg.geckoterminalNetwork;
  const [top, fresh] = await Promise.all([
    gt<GtPoolsResp>(`/networks/${net}/pools?include=base_token%2Cdex&page=1`),
    gt<GtPoolsResp>(`/networks/${net}/new_pools?include=base_token%2Cdex&page=1`),
  ]);

  const tokensById = new Map<string, GtIncluded>();
  const dexNames = new Map<string, string>();
  for (const resp of [top, fresh]) {
    for (const inc of resp?.included ?? []) {
      if (inc.type === "token" && inc.id) tokensById.set(inc.id, inc);
      if (inc.type === "dex" && inc.id)
        dexNames.set(inc.id, inc.attributes?.name ?? prettyDex(inc.id));
    }
  }

  const now = Date.now();
  const byAddress = new Map<string, TokenRow & { _reserve: number }>();

  const pools = [...(top?.data ?? []), ...(fresh?.data ?? [])];
  for (const p of pools) {
    const a = p.attributes ?? {};
    const baseId = p.relationships?.base_token?.data?.id ?? "";
    const base = tokensById.get(baseId);
    const address = (base?.attributes?.address ?? baseId.split("_")[1] ?? "").toLowerCase();
    if (!address) continue;

    const dexId = p.relationships?.dex?.data?.id ?? "";
    const dexName = dexNames.get(dexId) ?? prettyDex(dexId);
    const isLaunchpad = LAUNCHPAD_RE.test(dexId);
    const reserve = n(a.reserve_in_usd);
    const price = n(a.base_token_price_usd);
    const pc = a.price_change_percentage ?? {};
    const vol = a.volume_usd ?? {};
    const tx24 = a.transactions?.h24 ?? {};
    const createdMs = a.pool_created_at ? new Date(a.pool_created_at).getTime() : 0;
    const ageMinutes = createdMs > 0 ? Math.max(0, (now - createdMs) / 60_000) : -1;
    const symbol = base?.attributes?.symbol ?? a.name?.split("/")[0]?.trim() ?? "?";

    const existing = byAddress.get(address);
    if (existing) {
      // Aggregate volumes across pools; track graduation across venues.
      existing.vol5m += n(vol.m5);
      existing.vol1h += n(vol.h1);
      existing.vol6h += n(vol.h6);
      existing.vol24h += n(vol.h24);
      existing.buys24h += n(tx24.buys);
      existing.sells24h += n(tx24.sells);
      if (isLaunchpad && !existing.launchpadName) existing.launchpadName = dexName;
      if (!isLaunchpad && existing.launchpadName) existing.graduated = true;
      if (isLaunchpad && existing.dexName && !LAUNCHPAD_RE.test(existing.dexName))
        existing.graduated = true;
      // Deeper pool wins as the primary venue/pricing source.
      if (reserve > existing._reserve) {
        existing._reserve = reserve;
        existing.price = price || existing.price;
        existing.dexName = dexName;
        existing.liquidityUsd = (existing.liquidityUsd ?? 0) + reserve;
        existing.sparkline = sparklineFrom(pc);
        existing.priceChange24h = n(pc.h24);
        existing.priceChange1h = n(pc.h1);
        existing.priceChange5m = n(pc.m5);
      }
      if (ageMinutes >= 0 && (existing.ageMinutes < 0 || ageMinutes > existing.ageMinutes)) {
        existing.ageMinutes = ageMinutes; // oldest pool = launch age
      }
      continue;
    }

    const status: TokenRow["status"] = [];
    if (ageMinutes >= 0 && ageMinutes < 60) status.push("new");
    if (n(pc.h24) >= 25 && n(vol.h24) > 1000) status.push("trending");

    byAddress.set(address, {
      _reserve: reserve,
      address,
      name: base?.attributes?.name ?? symbol,
      symbol,
      logo: symbol.slice(0, 2).toUpperCase(),
      logoUrl: base?.attributes?.image_url ?? undefined,
      ageMinutes,
      price,
      priceChange1h: n(pc.h1),
      priceChange24h: n(pc.h24),
      priceChange5m: n(pc.m5),
      mcap: n(a.market_cap_usd) || n(a.fdv_usd),
      fdv: n(a.fdv_usd),
      vol5m: n(vol.m5),
      vol1h: n(vol.h1),
      vol6h: n(vol.h6),
      vol24h: n(vol.h24),
      buys24h: n(tx24.buys),
      sells24h: n(tx24.sells),
      liquidityEth: 0,
      liquidityUsd: reserve,
      graduationPct: 0,
      holders: 0,
      topHolderPct: 0,
      deployer: "",
      status,
      socialHeat: 0,
      lockedLiquidity: false,
      feeSplit: "70/30",
      socials: {},
      lastTradeMs: now,
      priceSource: "geckoterminal",
      indexed: true,
      decimals: base?.attributes?.decimals,
      dexName,
      launchpadName: isLaunchpad ? dexName : undefined,
      sparkline: sparklineFrom(pc),
    });
  }

  const rows = [...byAddress.values()].map(({ _reserve, ...row }) => {
    void _reserve;
    if (row.graduated) {
      row.graduationPct = 100;
      if (!row.status.includes("graduated")) row.status.push("graduated");
    } else if (row.launchpadName) {
      if (!row.status.includes("graduating")) row.status.push("graduating");
    }
    return row;
  });

  return rows.sort((x, y) => y.vol24h - x.vol24h);
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
