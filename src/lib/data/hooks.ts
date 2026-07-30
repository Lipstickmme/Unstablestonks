import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChain } from "@/lib/chain-context";
import { getIntermediary, type ChainConfig, type ChainKey } from "@/config/chains";
import type { ChainStats, TokenRow, TradeEvent } from "../types";
import {
  fetchAddressCreator,
  fetchChainStats,
  fetchTokenDetail,
  fetchTokenHolders,
  fetchTokens,
  fetchTokenTransfers,
  fetchWalletTransfers,
  type WalletTransfer,
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
import { getErc20Balance, getErc20Meta, getNativeBalance, getRpcHealth } from "./rpc";
import { fetchDyorToken, fetchDyorTokens, type DyorTokenInfo } from "./dyor";
import { deriveTopHolders } from "./holders";
import { fetchContractCreator } from "../launch-scan";
import { fetchExplorerStats } from "../explorer-stats";
import { readCache, writeCache } from "../persist";
import { readLogos, readSnapshot, writeLogos, writeSnapshot } from "../store";

// 30s keeps us comfortably under GeckoTerminal's free-tier rate limit
// (30 calls/min) with the pools + new_pools + stats calls per cycle.
const REFRESH = 30_000;

/**
 * The token directory — which tokens exist, their metadata, new launches — is
 * refreshed far less often than prices. Splitting the two is what keeps a tick
 * down to four requests instead of ten.
 */
const DIRECTORY_REFRESH = 5 * 60_000;

/**
 * GeckoTerminal's free tier allows ~30 calls/min and these three feeds share it:
 * the pool lists (4 per REFRESH), the trade feeds (one per pool per TRADES_REFRESH)
 * and the row backfill (two per token per ENRICH_REFRESH). At these intervals the
 * total sits around 25/min — enough headroom that a slow response never pushes a
 * cycle over the limit, which is what used to surface as rows losing their data.
 */
const TRADES_REFRESH = 45_000;
const ENRICH_REFRESH = 180_000;

/** Balances fetched per trade feed — one multicall, but still a bounded one. */
const MAX_TRADER_BALANCES = 24;

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

  // ── Fast lane: live market structure ───────────────────────────────────────
  // Prices, volumes and buy/sell counts are the only things that meaningfully
  // change minute to minute, and GeckoTerminal is the one source that carries
  // them. Four calls, every REFRESH.
  const marketQ = useQuery<TokenRow[]>({
    queryKey: ["tokens-market", chainKey],
    refetchInterval: REFRESH,
    staleTime: REFRESH / 2,
    queryFn: () => fetchNetworkPools(chain).catch(() => [] as TokenRow[]),
  });

  // Shared snapshot of the last good list. A visitor with no localStorage —
  // first visit, new device, cleared cache — paints real rows straight away
  // instead of watching the indexers resolve, and logos arrive attached to the
  // row rather than after an enrichment pass. Resolves to null when no store is
  // configured, in which case nothing below changes.
  const snapshotQ = useQuery<TokenRow[] | null>({
    queryKey: ["tokens-snapshot", chainKey],
    enabled: !readCache<TokenRow[]>(cacheKey)?.length,
    staleTime: 5 * 60_000,
    refetchInterval: false,
    retry: 0,
    queryFn: async () => {
      const snap = await readSnapshot({ data: { chain: chainKey } }).catch(() => null);
      if (!snap?.json) return null;
      try {
        return JSON.parse(snap.json) as TokenRow[];
      } catch {
        return null;
      }
    },
  });

  // Every token logo the terminal has ever resolved on this chain, address →
  // URL. Unlike the snapshot this survives for weeks, so artwork is attached to
  // a row on the very first paint instead of arriving with the enrichment pass —
  // the actual reason new Stable launches showed as blank tiles.
  const logosQ = useQuery<Record<string, string>>({
    queryKey: ["token-logos", chainKey],
    staleTime: 30 * 60_000,
    refetchInterval: false,
    retry: 0,
    queryFn: async () => {
      const res = await readLogos({ data: { chain: chainKey } }).catch(() => null);
      if (!res?.json) return {};
      try {
        return JSON.parse(res.json) as Record<string, string>;
      } catch {
        return {};
      }
    },
  });

  // ── Slow lane: what exists on the chain ────────────────────────────────────
  // Which tokens exist, their names, decimals and icons — plus discovery of new
  // launches. None of it changes on a 30s scale, and together it was six extra
  // network calls per tick. Once every DIRECTORY_REFRESH is plenty, and it keeps
  // the fast lane comfortably inside GeckoTerminal's rate limit.
  const directoryQ = useQuery<TokenRow[]>({
    queryKey: ["tokens-directory", chainKey],
    refetchInterval: DIRECTORY_REFRESH,
    staleTime: DIRECTORY_REFRESH,
    queryFn: async () => {
      const [dsRows, bsRows, explorerScan] = await Promise.all([
        fetchDexScreenerTokens(chain).catch(() => [] as TokenRow[]),
        fetchTokens(chain).catch(() => [] as TokenRow[]),
        fetchExplorerTokens(chain).catch(() => ({ rows: [] as TokenRow[], note: "threw" })),
      ]);

      // The live pools tell the scanner which DEX factories this chain actually
      // uses, so launches are found on whatever venue they happen on.
      const poolHints = (marketQ.data ?? [])
        .map((r) => r.primaryPool)
        .filter((p): p is string => Boolean(p))
        .slice(0, 8);
      const freshRows = await fetchNewLaunches(chainKey, chain, poolHints).catch(
        () => [] as TokenRow[],
      );

      const rows = [...dsRows, ...bsRows, ...explorerScan.rows, ...freshRows];

      // Price anything the directory found that no market source covers. One
      // call covers 30 addresses, so this stays cheap even on a full list.
      const unpriced = rows.filter((t) => !t.indexed).map((t) => t.address);
      const priced = unpriced.length
        ? await fetchDexScreenerMarkets(chain, unpriced).catch(() => [] as TokenRow[])
        : [];

      recordSources(chainKey, {
        geckoterminal: marketQ.data?.length ?? 0,
        dexscreener: dsRows.length,
        blockscout: bsRows.length,
        explorer: explorerScan.rows.length,
        onchain: freshRows.length,
        note: explorerScan.note,
      });

      return [...rows, ...priced];
    },
  });

  // Merge is pure and cheap, so it re-runs on either lane landing rather than
  // being another query with its own cache entry.
  return useMemo(() => {
    const market = marketQ.data ?? [];
    const directory = directoryQ.data ?? [];
    const snapshot = snapshotQ.data ?? [];

    const merged = new Map<string, TokenRow>();
    // Order matters: the first source to introduce an address owns its market
    // figures, later ones only fill blanks. Live data leads; the snapshot is
    // last, so it can only fill gaps and never overwrite a fresh figure.
    for (const group of [market, directory, snapshot]) {
      for (const row of group) {
        const cur = merged.get(row.address);
        if (cur) foldRow(cur, row);
        else merged.set(row.address, { ...row });
      }
    }

    // Attach known artwork to anything that arrived without it, and note what
    // this pass learned so the next cold visitor starts with it too.
    const knownLogos = logosQ.data ?? {};
    const freshLogos: Record<string, string> = {};
    for (const row of merged.values()) {
      const addr = row.address.toLowerCase();
      if (row.logoUrl) {
        if (knownLogos[addr] !== row.logoUrl) freshLogos[addr] = row.logoUrl;
      } else if (knownLogos[addr]) {
        row.logoUrl = knownLogos[addr];
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
      // Publish for the next cold visitor. Only when the live sources actually
      // answered — echoing a snapshot back would keep it alive forever.
      if (market.length) {
        void writeSnapshot({
          data: { chain: chainKey, json: JSON.stringify(rows.slice(0, 120)) },
        }).catch(() => {});
      }
      // Only when something is actually new — re-publishing the same map every
      // merge would spend the store's command budget on nothing.
      if (Object.keys(freshLogos).length) {
        void writeLogos({
          data: { chain: chainKey, json: JSON.stringify(freshLogos) },
        }).catch(() => {});
      }
      return {
        data: rows,
        isLoading: false,
        isError: marketQ.isError && directoryQ.isError,
      };
    }
    // Nothing upstream yet — paint the last good list rather than an empty
    // terminal, exactly as the single-query version did.
    return {
      data: readCache<TokenRow[]>(cacheKey, 60 * 60_000) ?? [],
      isLoading: marketQ.isLoading || directoryQ.isLoading,
      isError: marketQ.isError && directoryQ.isError,
    };
  }, [
    marketQ.data,
    marketQ.isLoading,
    marketQ.isError,
    directoryQ.data,
    directoryQ.isLoading,
    directoryQ.isError,
    snapshotQ.data,
    logosQ.data,
    cacheKey,
    chainKey,
  ]);
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
    staleTime: ENRICH_REFRESH,
    refetchInterval: ENRICH_REFRESH,
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

/** A holder counts as a whale once their stake in the token is worth this much. */
export const WHALE_HOLDER_USD = 5_000;

export interface TokenInsight {
  /** Deployer's balance as a % of supply. */
  devHoldingPct?: number;
  /**
   * Holders whose stake is worth WHALE_HOLDER_USD or more. Counted from the
   * holders page we already fetch, so it costs nothing extra — but it is a
   * FLOOR, not a total: it can only see the holders that page returns.
   */
  whaleHolders?: number;
  /** Combined share of the ten largest holders. */
  top10Pct?: number;
  /** DexScreener paid listing — undefined when the chain isn't indexed there. */
  dexPaid?: boolean;
  /** True when DexScreener doesn't cover this chain at all. */
  dexUnsupported?: boolean;
}

/**
 * Distribution + listing intel for the busiest rows: how much the deployer still
 * holds, how concentrated the top ten are, and whether the team paid DexScreener
 * for enhanced token info.
 *
 * Every figure has two routes to it, because on these chains the first one is
 * regularly missing and a single source meant a permanently blank column:
 *
 *   supply    the row's, else read from the contract. This was the silent
 *             killer — the whole hook used to skip any token without a supply
 *             figure, and GeckoTerminal (the source most rows come from) does
 *             not report one, so most of the list was never even attempted.
 *   deployer  Blockscout's creator field, else the explorer's contract module.
 *   holders   Blockscout's holders page, else derived from the token's own
 *             Transfer logs with balances read on chain (see holders.ts).
 *
 * Dev holding is always a live `balanceOf` on the deployer rather than a lookup
 * in a top-N page, so a deployer sitting outside the top ten is still counted.
 * Runs on its own slow cycle so it never competes with the market data feed.
 */
const MAX_INSIGHT_TOKENS = 12;

export function useTokenInsights(tokens: TokenRow[] | undefined) {
  const { chain, chainKey } = useChain();
  const targets = (tokens ?? [])
    .sort((a, b) => b.vol24h - a.vol24h)
    .slice(0, MAX_INSIGHT_TOKENS)
    .map((t) => ({
      address: t.address,
      decimals: t.decimals ?? 18,
      totalSupply: t.totalSupply ?? 0,
      price: t.price,
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
          // Supply gates both distribution figures, so resolve it first. The
          // contract is authoritative and the read is cached for the session.
          let supply = t.totalSupply;
          if (supply <= 0) {
            const meta = await getErc20Meta(chainKey, t.address as `0x${string}`).catch(() => null);
            supply = meta?.totalSupply ?? 0;
          }

          const [bsHolders, creator, paid] = await Promise.all([
            // 50 rather than 10: the whale count is only as good as the slice
            // it can see, and this is the same single request either way.
            supply > 0
              ? fetchTokenHolders(chain, t.address, t.decimals, supply, 50).catch(() => [])
              : Promise.resolve([]),
            fetchAddressCreator(chain, t.address)
              .catch(() => "")
              .then((c) =>
                /^0x[0-9a-fA-F]{40}$/.test(c)
                  ? c
                  : fetchContractCreator({
                      data: { chainId: chain.id, address: t.address },
                    }).catch(() => ""),
              ),
            fetchDexPaid(chain, t.address).catch((): DexPaidStatus => ({ types: [] })),
          ]);

          const insight: TokenInsight = { dexPaid: paid.paid, dexUnsupported: paid.unsupported };

          // Explorer first; the chain itself when the explorer has nothing.
          const holders = bsHolders.length
            ? bsHolders
            : supply > 0
              ? await deriveTopHolders(chainKey, chain, t.address, t.decimals, supply, 50).catch(
                  () => [],
                )
              : [];

          if (holders.length) {
            const sum = holders.slice(0, 10).reduce((s, h) => s + h.pct, 0);
            if (sum > 0) insight.top10Pct = Math.min(100, sum);
            if (t.price > 0) {
              insight.whaleHolders = holders.filter(
                (h) => h.amount * t.price >= WHALE_HOLDER_USD,
              ).length;
            }
          }

          if (creator && /^0x[0-9a-fA-F]{40}$/.test(creator) && supply > 0) {
            const bal = await getErc20Balance(
              chainKey,
              t.address as `0x${string}`,
              creator as `0x${string}`,
              t.decimals,
            ).catch(() => 0);
            insight.devHoldingPct = Math.min(100, (bal / supply) * 100);
          }

          out[t.address] = insight;
        }),
      );
      return out;
    },
  });
}

/**
 * Current holdings for the wallets visible in a trade feed, as a share of
 * supply.
 *
 * The trade feed says what a wallet did; only the chain says what it still
 * holds. Every balance is one balanceOf, but the public client batches them
 * into a single multicall, so a screenful of wallets costs one round trip.
 * Capped at MAX_TRADER_BALANCES so a busy feed can't turn into a storm.
 */
export function useTraderHoldings(
  wallets: string[],
  token: string | undefined,
  decimals: number,
  totalSupply: number,
) {
  const { chainKey } = useChain();
  const targets = wallets.slice(0, MAX_TRADER_BALANCES);
  const key = targets.join(",");

  return useQuery<Record<string, number>>({
    queryKey: ["trader-holdings", chainKey, token ?? "", key],
    enabled: Boolean(token) && totalSupply > 0 && targets.length > 0,
    staleTime: 120_000,
    refetchInterval: 120_000,
    retry: 0,
    queryFn: async () => {
      const out: Record<string, number> = {};
      const balances = await Promise.all(
        targets.map((w) =>
          getErc20Balance(chainKey, token as `0x${string}`, w as `0x${string}`, decimals).catch(
            () => 0,
          ),
        ),
      );
      targets.forEach((w, i) => {
        const bal = balances[i];
        if (bal > 0) out[w.toLowerCase()] = (bal / totalSupply) * 100;
      });
      return out;
    },
  });
}

/**
 * USD value of each wallet's holding of the token it traded.
 *
 * Whale-by-wallet needs a dollar figure, not a share of supply, so this reads
 * balanceOf and prices it with the row's own price. Trades can span several
 * tokens on the chain-wide feed, so balances are grouped by token — one
 * multicall per token rather than one call per trade.
 */
export function useTraderBalances(wallets: string[], trades: TradeEvent[]) {
  const { chainKey } = useChain();
  const tokensQ = useTokens();

  // wallet → the token they traded, and what a unit of it is worth.
  const pairs = useMemo(() => {
    const priceOf = new Map(
      (tokensQ.data ?? []).map((t) => [
        t.address.toLowerCase(),
        { price: t.price, decimals: t.decimals ?? 18 },
      ]),
    );
    const out = new Map<string, { token: string; price: number; decimals: number }>();
    for (const t of trades) {
      const w = (t.wallet || "").toLowerCase();
      const token = (t.tokenAddress || "").toLowerCase();
      if (!w || !token || out.has(w)) continue;
      const meta = priceOf.get(token);
      if (!meta || meta.price <= 0) continue;
      out.set(w, { token, price: meta.price, decimals: meta.decimals });
    }
    return out;
  }, [trades, tokensQ.data]);

  const targets = wallets.filter((w) => pairs.has(w)).slice(0, MAX_TRADER_BALANCES);
  const key = targets.join(",");

  return useQuery<Record<string, number>>({
    queryKey: ["trader-balances", chainKey, key],
    enabled: targets.length > 0,
    staleTime: 120_000,
    refetchInterval: 120_000,
    retry: 0,
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all(
        targets.map(async (w) => {
          const p = pairs.get(w);
          if (!p) return;
          const bal = await getErc20Balance(
            chainKey,
            p.token as `0x${string}`,
            w as `0x${string}`,
            p.decimals,
          ).catch(() => 0);
          if (bal > 0) out[w] = bal * p.price;
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
    .map((t) => ({ address: t.address, symbol: t.symbol, pool: t.primaryPool }));
  const key = top.map((t) => t.address).join(",");
  return useQuery<TradeEvent[]>({
    queryKey: ["chain-trades", chainKey, key],
    enabled: top.length > 0,
    refetchInterval: TRADES_REFRESH,
    staleTime: TRADES_REFRESH / 2,
    queryFn: async () => {
      const perToken = await Promise.all(
        top.map(async (t) => {
          // The list already carries each token's deepest pool, so the extra
          // pools lookup per token is skipped — it was doubling this hook's
          // request count and starving the trade feed that whale watch and
          // bundle detection read from.
          const pool = t.pool ?? (await fetchTokenPools(chain, t.address).catch(() => []))[0]?.pool;
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

/**
 * Tokens balance-checked for the connected wallet. viem batches these into
 * multicalls, so the cost is a few round trips rather than one call per token —
 * but the list can run to hundreds on a busy chain, so it is still bounded.
 */
const MAX_PORTFOLIO_TOKENS = 80;

export interface PortfolioPosition {
  token: TokenRow;
  balance: number;
  valueUsd: number;
  /** Share of the wallet's total value on this chain. */
  weightPct: number;
  /** Share of the token's supply this wallet holds, when supply is known. */
  supplyPct?: number;
}

export interface Portfolio {
  positions: PortfolioPosition[];
  /** Gas-asset balance. USD only when the native asset can be priced. */
  native: { symbol: string; balance: number; valueUsd?: number };
  /** Positions + native, where priced. */
  totalUsd: number;
  /** Value-weighted 24h move over the positions whose change is known. */
  change24hPct?: number;
  change24hUsd: number;
  best?: PortfolioPosition;
  worst?: PortfolioPosition;
  /** How many tokens were actually checked — the rest were past the cap. */
  scanned: number;
}

/**
 * What the connected wallet holds on the active chain.
 *
 * Balances come off the chain (balanceOf per token, batched) and are priced with
 * the list's own live prices, so a position is only valued when the terminal can
 * actually price the token. Nothing here is inferred from the trade feed — that
 * feed is a finite window and would understate anyone who bought before it.
 *
 * This is the heaviest read in the app — up to MAX_PORTFOLIO_TOKENS balanceOf
 * calls — so its caller only mounts on the portfolio tab. `enabled` is there for
 * anywhere that needs to hold it back without unmounting.
 */
export function useWalletPortfolio(
  wallet: string | null | undefined,
  tokens: TokenRow[] | undefined,
  enabled = true,
) {
  const { chain, chainKey } = useChain();

  /**
   * On Stable and Arc the gas asset and a listed ERC-20 are the SAME funds seen
   * two ways — native USDT0/USDC at 18 decimals, and the predeploy at 6. Counting
   * both would double every balance, so the ERC-20 view is dropped and the native
   * reading stands for it.
   */
  const gasTwin =
    chain.stablecoin && chain.stablecoin.symbol === chain.nativeCurrency.symbol
      ? chain.stablecoin.address?.toLowerCase()
      : undefined;

  // Deepest markets first: if the cap bites, it should bite on the tokens least
  // likely to be held.
  const targets = useMemo(
    () =>
      [...(tokens ?? [])]
        .filter((t) => t.address.toLowerCase() !== gasTwin)
        .sort((a, b) => b.vol24h - a.vol24h || b.mcap - a.mcap)
        .slice(0, MAX_PORTFOLIO_TOKENS),
    [tokens, gasTwin],
  );

  const key = targets.map((t) => t.address).join(",");

  return useQuery<Portfolio>({
    queryKey: ["portfolio", chainKey, wallet ?? "", key],
    enabled: enabled && Boolean(wallet) && targets.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 0,
    queryFn: async () => {
      const owner = wallet as `0x${string}`;

      const [nativeBalance, balances] = await Promise.all([
        getNativeBalance(chainKey, owner).catch(() => 0),
        Promise.all(
          targets.map((t) =>
            getErc20Balance(chainKey, t.address as `0x${string}`, owner, t.decimals ?? 18).catch(
              () => 0,
            ),
          ),
        ),
      ]);

      const positions: PortfolioPosition[] = [];
      for (let i = 0; i < targets.length; i++) {
        const balance = balances[i];
        if (balance <= 0) continue;
        const token = targets[i];
        positions.push({
          token,
          balance,
          valueUsd: token.price > 0 ? balance * token.price : 0,
          weightPct: 0,
          supplyPct:
            token.totalSupply && token.totalSupply > 0
              ? (balance / token.totalSupply) * 100
              : undefined,
        });
      }

      // The gas asset is a stablecoin on Stable (USDT0) and Arc (USDC), so it
      // prices at $1. Elsewhere it is priced only if its wrapped form trades on
      // the chain — never guessed from an off-chain quote.
      const wrapped = getIntermediary(chain)?.address?.toLowerCase();
      const wrappedRow = wrapped
        ? targets.find((t) => t.address.toLowerCase() === wrapped && t.price > 0)
        : undefined;
      const nativePrice =
        chain.stablecoin?.symbol === chain.nativeCurrency.symbol ? 1 : wrappedRow?.price;

      const nativeUsd = nativePrice != null ? nativeBalance * nativePrice : undefined;
      const totalUsd = positions.reduce((s, p) => s + p.valueUsd, 0) + (nativeUsd ?? 0);

      for (const p of positions) {
        p.weightPct = totalUsd > 0 ? (p.valueUsd / totalUsd) * 100 : 0;
      }
      positions.sort((a, b) => b.valueUsd - a.valueUsd || b.balance - a.balance);

      // Weighted 24h move across priced positions only. The gas asset is left
      // out: on two of three chains it is a dollar and never moves.
      const priced = positions.filter((p) => p.valueUsd > 0 && p.token.priceChange24h !== 0);
      const pricedValue = priced.reduce((s, p) => s + p.valueUsd, 0);
      const change24hUsd = priced.reduce(
        (s, p) => s + p.valueUsd * (p.token.priceChange24h / 100),
        0,
      );
      const ranked = [...priced].sort((a, b) => b.token.priceChange24h - a.token.priceChange24h);

      return {
        positions,
        native: {
          symbol: chain.nativeCurrency.symbol,
          balance: nativeBalance,
          valueUsd: nativeUsd,
        },
        totalUsd,
        change24hPct: pricedValue > 0 ? (change24hUsd / pricedValue) * 100 : undefined,
        change24hUsd,
        best: ranked[0],
        worst: ranked.length > 1 ? ranked[ranked.length - 1] : undefined,
        scanned: targets.length,
      };
    },
  });
}

/**
 * The connected wallet's own token movements on this chain, straight off the
 * explorer. Independent of the pool trade feed, which only watches the busiest
 * eight pools and would leave most wallets looking inactive.
 */
export function useWalletActivity(wallet: string | null | undefined, enabled = true) {
  const { chain, chainKey } = useChain();
  return useQuery<WalletTransfer[]>({
    queryKey: ["wallet-activity", chainKey, wallet ?? ""],
    enabled: enabled && Boolean(wallet),
    staleTime: 45_000,
    refetchInterval: 60_000,
    retry: 0,
    queryFn: () => fetchWalletTransfers(chain, wallet as string),
  });
}

export interface TokenHolder {
  address: string;
  amount: number;
  pct: number;
}

export interface TokenDetailData {
  token: TokenRow;
  holders: TokenHolder[];
  trades: TradeEvent[];
  /** Primary (deepest) pool address, when DEX-indexed — feeds the live chart. */
  pool: string | null;
}

async function loadTokenCore(
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

  // 4. Done — holders and trades load separately so this resolves as early as
  //    possible and the page can paint.
  return { token, holders: [], trades: [], pool: pools[0]?.pool ?? null };
}

/**
 * Token page data, split in two so the page paints as soon as it can.
 *
 * The core query resolves once identity + market data are known; holders and the
 * trade feed load behind it in `useTokenActivity`. Previously both were awaited
 * in the same query, so the whole page waited on the slowest explorer call even
 * though the header, stats and chart only need the core.
 *
 * It also starts from the row the terminal list already has cached, so opening a
 * token from the table renders instantly with real values and then sharpens.
 */
export function useTokenDetail(address: string) {
  const { chain, chainKey } = useChain();
  const addr = address.toLowerCase();
  return useQuery<TokenDetailData>({
    queryKey: ["token-detail", chainKey, addr],
    refetchInterval: REFRESH,
    staleTime: 15_000,
    retry: 1,
    initialData: () => {
      const cached = readCache<TokenRow[]>(`tokens.${chainKey}`, 60 * 60_000);
      const row = cached?.find((t) => t.address.toLowerCase() === addr);
      return row
        ? { token: row, holders: [], trades: [], pool: row.primaryPool ?? null }
        : undefined;
    },
    initialDataUpdatedAt: 0,
    queryFn: () => loadTokenCore(chain, chainKey, address),
  });
}

/** Holders + live trades for the token page — loaded after the core paints. */
export function useTokenActivity(
  address: string,
  token: TokenRow | undefined,
  pool: string | null,
) {
  const { chain, chainKey } = useChain();
  const addr = address.toLowerCase();
  return useQuery<{ holders: TokenHolder[]; trades: TradeEvent[] }>({
    queryKey: ["token-activity", chainKey, addr, pool ?? ""],
    enabled: Boolean(token),
    refetchInterval: REFRESH,
    queryFn: async () => {
      const decimals = token?.decimals ?? 18;
      const [holders, transfers, dexTrades] = await Promise.all([
        fetchTokenHolders(chain, addr, decimals, token?.totalSupply ?? 0, 10).catch(() => []),
        fetchTokenTransfers(chain, addr, token?.symbol ?? "?", token?.price ?? 0).catch(
          () => [] as TradeEvent[],
        ),
        pool
          ? fetchPoolTrades(chain, pool, token?.symbol ?? "?").catch(() => [] as TradeEvent[])
          : Promise.resolve([] as TradeEvent[]),
      ]);
      const trades = dexTrades.length
        ? dexTrades.map((t) => ({ ...t, tokenAddress: addr }))
        : transfers;
      return { holders, trades };
    },
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
