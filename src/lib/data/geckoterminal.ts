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

interface GtDexesResp {
  data?: { id?: string; attributes?: { name?: string } }[];
}

interface GtTokenInfoResp {
  data?: {
    attributes?: {
      image_url?: string | null;
      description?: string | null;
      websites?: string[];
      twitter_handle?: string | null;
      telegram_handle?: string | null;
      discord_url?: string | null;
      holders?: { count?: number | null } | null;
    };
  };
}

export interface TokenInfo {
  holders: number;
  logoUrl?: string;
  socials: { twitter?: string; telegram?: string; website?: string };
}

/** Holder count + socials from GeckoTerminal's token-info endpoint (fills gaps
 * on chains without a Blockscout token registry, e.g. Stable). */
export async function fetchTokenInfo(cfg: ChainConfig, address: string): Promise<TokenInfo | null> {
  if (!cfg.geckoterminalNetwork) return null;
  const data = await gt<GtTokenInfoResp>(
    `/networks/${cfg.geckoterminalNetwork}/tokens/${address}/info`,
  );
  const a = data?.data?.attributes;
  if (!a) return null;
  return {
    holders: n(a.holders?.count),
    logoUrl: a.image_url ?? undefined,
    socials: {
      twitter: a.twitter_handle ? `https://x.com/${a.twitter_handle.replace(/^@/, "")}` : undefined,
      telegram: a.telegram_handle
        ? `https://t.me/${a.telegram_handle.replace(/^@/, "")}`
        : undefined,
      website: a.websites?.[0],
    },
  };
}

/**
 * Bonding-curve launchpads. Deliberately STRICT: a generic AMM (Uniswap,
 * DYORswap's swap venue, etc.) is not a launchpad, and mislabelling one made
 * every pool read "on bonding curve". Only venues that actually run a curve
 * belong here.
 */
const LAUNCHPAD_RE =
  /(^|[-_])(pump|four|bags|boop|sunpump|moonshot)|\bfun\b|bonding|launchpad|(^|[-_])pad($|[-_])/i;

/**
 * Named launchpads that the generic pattern above cannot catch, because their
 * names say nothing about what they are. Robinhood Chain's wave is all like
 * this — "Noxa", "Bankr", "Virtuals", "Hoodit" are just words.
 *
 * Anchored to a word boundary on each side so a venue merely CONTAINING one of
 * these strings isn't swept up. Kept as a stopgap list rather than the primary
 * mechanism: the venue roster is fetched live (see fetchNetworkDexes), so a
 * launchpad whose name announces itself needs no entry here at all.
 */
const NAMED_LAUNCHPADS =
  /\b(noxa|bankr|virtuals|hoodit|clanker|flaunch|zora|apestore|believe)\b|\b(sushi|uniswap|pancake\w*)[\s._-]*(launch|pools)\b|\bpools\.trade\b/i;

/**
 * Is this venue a launchpad rather than a plain AMM?
 *
 * Checks the id AND the display name. Indexers are inconsistent about which one
 * carries the telling word: an id of "noxa-launchpad" says it outright, while
 * "Sushi Launch" only ever appears in the name — its id is just a slug.
 */
function isLaunchpadVenue(dexId: string, dexName?: string): boolean {
  const both = `${dexId} ${dexName ?? ""}`;
  return LAUNCHPAD_RE.test(both) || NAMED_LAUNCHPADS.test(both);
}

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
  /** Pool creation time (ms) — the token's real launch age. */
  createdAtMs: number;
  reserveUsd: number;
  vol5m: number;
  vol1h: number;
  vol6h: number;
  vol24h: number;
  buys24h: number;
  sells24h: number;
  priceChange24h: number;
  priceChange1h: number;
  priceChange5m: number;
  sparkline: number[];
}

/**
 * Pools a token trades in, best-liquidity first, with full market attributes.
 * This is how rows that the chain-wide pools page didn't include (explorer-only
 * tokens) get their venue, age, short-window volumes and trend backfilled.
 */
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
      const a = p.attributes!;
      const dexId = p.relationships?.dex?.data?.id ?? "";
      const dexName = dexNames.get(dexId) ?? prettyDex(dexId);
      const pc = a.price_change_percentage ?? {};
      const vol = a.volume_usd ?? {};
      const tx24 = a.transactions?.h24 ?? {};
      return {
        pool: a.address!,
        dexId,
        dexName,
        isLaunchpad: isLaunchpadVenue(dexId, dexName),
        createdAtMs: a.pool_created_at ? new Date(a.pool_created_at).getTime() : 0,
        reserveUsd: n(a.reserve_in_usd),
        vol5m: n(vol.m5),
        vol1h: n(vol.h1),
        vol6h: n(vol.h6),
        vol24h: n(vol.h24),
        buys24h: n(tx24.buys),
        sells24h: n(tx24.sells),
        priceChange24h: n(pc.h24),
        priceChange1h: n(pc.h1),
        priceChange5m: n(pc.m5),
        sparkline: sparklineFrom(pc),
      };
    })
    .sort((x, y) => y.reserveUsd - x.reserveUsd);
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
  // Two pages of each feed: one page of `pools` is only the top 20 by liquidity,
  // which on a young chain buries everything that launched today. `new_pools` is
  // the launch feed. Pages beyond the first simply come back empty on a small
  // chain, so this costs nothing where there's nothing to find.
  const responses = await Promise.all([
    gt<GtPoolsResp>(`/networks/${net}/pools?include=base_token%2Cdex&page=1`),
    gt<GtPoolsResp>(`/networks/${net}/pools?include=base_token%2Cdex&page=2`),
    gt<GtPoolsResp>(`/networks/${net}/new_pools?include=base_token%2Cdex&page=1`),
    gt<GtPoolsResp>(`/networks/${net}/new_pools?include=base_token%2Cdex&page=2`),
  ]);
  return rowsFromPoolPages(responses);
}

/**
 * Every DEX GeckoTerminal indexes on a network, newest list each time.
 *
 * Hardcoding venue ids was never going to hold. Robinhood Chain alone gained
 * Uniswap's Pools launchpad, Sushi Launch, Noxa, Bankr, Virtuals and Hoodit
 * inside a few weeks of mainnet, and any list written into this file is stale
 * the day someone deploys the next one. Asking the indexer which venues exist
 * means a launchpad that appears tomorrow is picked up without a release.
 *
 * Cached for an hour: venue rosters change on the scale of weeks, and this sits
 * behind a 30/min rate limit shared with every other feed.
 */
const dexCache = new Map<string, { ts: number; dexes: NetworkDex[] }>();
const DEX_TTL = 60 * 60_000;

export interface NetworkDex {
  id: string;
  name: string;
  isLaunchpad: boolean;
}

export async function fetchNetworkDexes(cfg: ChainConfig): Promise<NetworkDex[]> {
  const net = cfg.geckoterminalNetwork;
  if (!net) return [];
  const hit = dexCache.get(net);
  if (hit && Date.now() - hit.ts < DEX_TTL) return hit.dexes;

  const pages = await Promise.all([
    gt<GtDexesResp>(`/networks/${net}/dexes?page=1`),
    gt<GtDexesResp>(`/networks/${net}/dexes?page=2`),
  ]);
  const dexes: NetworkDex[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const d of page?.data ?? []) {
      const id = d.id ?? "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const name = d.attributes?.name ?? prettyDex(id);
      // Match on BOTH id and display name. Indexers are inconsistent about
      // which one carries the recognisable word — "noxa-launchpad" says it in
      // the id, "Sushi Launch" only in the name.
      dexes.push({ id, name, isLaunchpad: isLaunchpadVenue(id, name) });
    }
  }
  // A failed lookup must not be cached as "this chain has no venues", or the
  // per-venue sweep below would go quiet for an hour on one bad request.
  if (dexes.length) dexCache.set(net, { ts: Date.now(), dexes });
  return dexes;
}

/**
 * Top pools on EVERY venue, one page each.
 *
 * The network-wide `/pools` feed is a single ranking, so on a chain where one
 * venue does most of the volume — Uniswap V3 on Robinhood clears hundreds of
 * millions a day — the top pages are all that venue, and a launchpad doing real
 * but smaller numbers never appears at any page depth we can afford. Asking each
 * venue for its own top pools guarantees every one of them is represented,
 * which is the difference between "the chain's biggest pools" and "the chain".
 *
 * This belongs to the slow discovery lane, not the 30-second market lane: it
 * costs one request per venue and answers "what exists", which does not change
 * minute to minute.
 */
const MAX_VENUES = 14;

export async function fetchVenuePools(cfg: ChainConfig): Promise<TokenRow[]> {
  const net = cfg.geckoterminalNetwork;
  if (!net) return [];
  const dexes = await fetchNetworkDexes(cfg);
  if (!dexes.length) return [];

  // Launchpads first — they are the venues the global ranking buries, and the
  // reason this sweep exists at all.
  const ordered = [...dexes].sort((a, b) => Number(b.isLaunchpad) - Number(a.isLaunchpad));
  const responses = await Promise.all(
    ordered
      .slice(0, MAX_VENUES)
      .map((d) =>
        gt<GtPoolsResp>(
          `/networks/${net}/dexes/${encodeURIComponent(d.id)}/pools?include=base_token%2Cdex&page=1`,
          15_000,
        ),
      ),
  );
  return rowsFromPoolPages(responses);
}

/**
 * Fold a set of pool pages into one row per token.
 *
 * Shared by the network feed and the per-venue sweep so both produce identical
 * rows — the aggregation rules (liquidity sums, deepest pool prices, graduation
 * across venues) live in exactly one place.
 */
function rowsFromPoolPages(responses: (GtPoolsResp | null)[]): TokenRow[] {
  const tokensById = new Map<string, GtIncluded>();
  const dexNames = new Map<string, string>();
  for (const resp of responses) {
    for (const inc of resp?.included ?? []) {
      if (inc.type === "token" && inc.id) tokensById.set(inc.id, inc);
      if (inc.type === "dex" && inc.id)
        dexNames.set(inc.id, inc.attributes?.name ?? prettyDex(inc.id));
    }
  }

  const now = Date.now();
  const byAddress = new Map<
    string,
    TokenRow & { _reserve: number; _onCurve: boolean; _onDex: boolean }
  >();

  const pools = responses.flatMap((r) => r?.data ?? []);
  for (const p of pools) {
    const a = p.attributes ?? {};
    const baseId = p.relationships?.base_token?.data?.id ?? "";
    const base = tokensById.get(baseId);
    const address = (base?.attributes?.address ?? baseId.split("_")[1] ?? "").toLowerCase();
    if (!address) continue;

    const dexId = p.relationships?.dex?.data?.id ?? "";
    const dexName = dexNames.get(dexId) ?? prettyDex(dexId);
    const isLaunchpad = isLaunchpadVenue(dexId, dexName);
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
      if (isLaunchpad) {
        existing._onCurve = true;
        if (!existing.launchpadName) existing.launchpadName = dexName;
      } else {
        existing._onDex = true;
      }
      // Liquidity is a SUM over every pool, unconditionally. This used to sit
      // inside the "deeper pool wins" branch below, so a shallower pool seen
      // after a deeper one was silently dropped from the total — the reserve of
      // any second venue simply never counted.
      existing.liquidityUsd = (existing.liquidityUsd ?? 0) + reserve;
      existing.poolCount = (existing.poolCount ?? 1) + 1;

      // The deepest pool wins as the primary venue and pricing source. That IS
      // a "biggest wins" question — price comes from one pool, not from a sum.
      if (reserve > existing._reserve) {
        existing._reserve = reserve;
        existing.primaryPool = a.address ?? existing.primaryPool;
        existing.price = price || existing.price;
        existing.dexName = dexName;
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
      primaryPool: a.address,
      _onCurve: isLaunchpad,
      _onDex: !isLaunchpad,
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

  const rows = [...byAddress.values()].map(({ _reserve, _onCurve, _onDex, ...row }) => {
    void _reserve;
    // Graduated = it launched on a bonding curve AND now also trades on a
    // regular AMM. Still on the curve = launchpad pool only. Everything else is
    // a plain DEX listing and gets no curve/graduation label at all.
    if (_onCurve && _onDex) {
      row.graduated = true;
      row.graduationPct = 100;
      if (!row.status.includes("graduated")) row.status.push("graduated");
    } else if (_onCurve) {
      row.graduated = false;
      if (!row.status.includes("graduating")) row.status.push("graduating");
    } else {
      row.launchpadName = undefined;
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

export interface Candle {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Full OHLCV candles for a pool (oldest→newest) — powers the candlestick chart. */
export async function fetchOhlcvCandles(
  cfg: ChainConfig,
  pool: string,
  timeframe: "minute" | "hour" | "day" = "hour",
): Promise<Candle[]> {
  if (!cfg.geckoterminalNetwork) return [];
  const data = await gt<GtOhlcvResp>(
    `/networks/${cfg.geckoterminalNetwork}/pools/${pool}/ohlcv/${timeframe}?limit=150`,
  );
  const list = data?.data?.attributes?.ohlcv_list;
  if (!list?.length) return [];
  // ohlcv row = [timestamp, open, high, low, close, volume]; oldest→newest.
  return list
    .slice()
    .reverse()
    .map((r) => ({ t: n(r[0]), o: n(r[1]), h: n(r[2]), l: n(r[3]), c: n(r[4]), v: n(r[5]) }))
    .filter((k) => k.c > 0);
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
