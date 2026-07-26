// On-chain new-token discovery.
//
// Every third-party indexer (GeckoTerminal, DexScreener, Blockscout's token
// registry) lags a young chain, and some don't cover it at all — which is why
// Stable's list never showed anything that launched today. The chain itself
// never lags: a token becomes tradable the moment a pool is created for it, and
// that emits a log.
//
// So we read the DEX factories' own pool-creation events straight off the
// chain's public RPC:
//   Uniswap V3  PoolCreated(token0, token1, fee, tickSpacing, pool)
//   Uniswap V2  PairCreated(token0, token1, pair, uint)
// Both index token0/token1, so the counterparty of a base asset IS a newly
// listed token. Metadata comes from the ERC-20 itself. No API key, no indexer,
// no third party.
//
// Which factories? Not a hardcoded list — that goes stale the moment a chain
// gets a new venue, and it was the flaw in the first cut of this file: it
// watched only `router.factory()`, i.e. Uniswap's, while Stable's launches
// happen on DYORswap. Instead the factories are derived from the pools the
// terminal is already displaying (see getFactories), so discovery follows
// whatever DEX the chain actually uses.
//
// Prices/volumes are deliberately NOT invented here: a row discovered this way
// arrives unpriced (indexed:false) and the GeckoTerminal/DexScreener enrichment
// fills market data if and when either starts covering it.

import { parseAbiItem, toEventSelector, type Address, type Log } from "viem";
import type { ChainConfig, ChainKey } from "@/config/chains";
import type { TokenRow } from "../types";
import { getErc20Meta, getPublicClient } from "./rpc";
import { scanFactoryLaunches } from "../launch-scan";

const POOL_CREATED = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
);
const PAIR_CREATED = parseAbiItem(
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairsLength)",
);

const FACTORY_ABI = [
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

/** How far back to look, and how big a slice each getLogs call may ask for. */
const MAX_BLOCKS = 40_000n;
const CHUNK = 10_000n; // most public RPCs cap a getLogs range around here
/** Metadata is 4 reads per token, so cap how many we resolve per scan. */
const MAX_TOKENS = 24;

/** Factories seen per chain, cached for the session. */
const factoryCache = new Map<ChainKey, Address[]>();

async function readFactory(key: ChainKey, contract: Address): Promise<Address | null> {
  try {
    const addr = (await getPublicClient(key).readContract({
      address: contract,
      abi: FACTORY_ABI,
      functionName: "factory",
    })) as Address;
    return /^0x0{40}$/i.test(addr) ? null : addr;
  } catch {
    return null;
  }
}

/**
 * Every DEX factory actually in use on this chain.
 *
 * Resolving only `router.factory()` was the flaw in the first version: the
 * configured router is Uniswap's, but Stable's launches happen on DYORswap, so
 * the scan watched a factory nothing was being created in. Rather than hardcode
 * a factory per DEX per chain — a list that goes stale the moment a new venue
 * launches — we ask the pools the terminal is *already showing*: both Uniswap V2
 * pairs and V3 pools expose `factory()`, so the live pool set tells us which
 * factories matter, whoever deployed them.
 */
async function getFactories(
  key: ChainKey,
  cfg: ChainConfig,
  poolHints: string[],
): Promise<Address[]> {
  const cached = factoryCache.get(key);
  if (cached?.length) return cached;

  const candidates = await Promise.all([
    cfg.router ? readFactory(key, cfg.router.address) : Promise.resolve(null),
    ...poolHints
      .filter((p): p is string => /^0x[0-9a-fA-F]{40}$/.test(p))
      .slice(0, 8)
      .map((p) => readFactory(key, p as Address)),
  ]);

  const seen = new Map<string, Address>();
  for (const c of candidates) {
    if (c) seen.set(c.toLowerCase(), c);
  }
  const factories = [...seen.values()];
  if (factories.length) factoryCache.set(key, factories);
  return factories;
}

/** Assets that are the *quote* side of a pool, never the launch. */
function baseAssets(cfg: ChainConfig): Set<string> {
  const set = new Set<string>();
  for (const a of [cfg.wrappedNative, cfg.stablecoin?.address, cfg.intermediary?.address]) {
    if (a) set.add(a.toLowerCase());
  }
  return set;
}

interface Discovered {
  address: Address;
  blockNumber: bigint;
  /** Creation time in ms when the source supplied it (0 = look it up). */
  createdMs: number;
}

/**
 * Newly created pools in the recent block window, newest first, as the token
 * that isn't the base asset.
 */
async function scanFactoryLogs(
  key: ChainKey,
  cfg: ChainConfig,
  poolHints: string[],
): Promise<Discovered[]> {
  const factories = await getFactories(key, cfg, poolHints);
  if (!factories.length) return [];

  const client = getPublicClient(key);
  const head = await client.getBlockNumber();
  const floor = head > MAX_BLOCKS ? head - MAX_BLOCKS : 0n;
  const bases = baseAssets(cfg);
  const found = new Map<string, Discovered>();

  const take = (t: Address, blockNumber: bigint, createdMs: number) => {
    const lower = t.toLowerCase();
    if (bases.has(lower) || found.has(lower)) return;
    found.set(lower, { address: t, blockNumber, createdMs });
  };

  // Newest slice first, so a range-limited RPC still yields the freshest data.
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let to = head; to > floor; to -= CHUNK) {
    const from = to - CHUNK > floor ? to - CHUNK : floor;
    ranges.push({ from, to });
  }

  outer: for (const range of ranges) {
    for (const factory of factories) {
      let logs: Log[] = [];
      try {
        // Both events at once: we don't know (and don't need to know) whether a
        // given factory is a V2 or V3 deployment.
        logs = (await client.getLogs({
          address: factory,
          events: [POOL_CREATED, PAIR_CREATED],
          fromBlock: range.from,
          toBlock: range.to,
        })) as Log[];
      } catch {
        // Range rejected or the node doesn't serve logs — try the next.
        continue;
      }

      for (const log of logs) {
        const args = (log as { args?: { token0?: Address; token1?: Address } }).args;
        if (!args?.token0 || !args?.token1) continue;
        take(args.token0, log.blockNumber ?? 0n, 0);
        take(args.token1, log.blockNumber ?? 0n, 0);
      }
      if (found.size >= MAX_TOKENS) break outer;
    }
  }

  // Public RPCs commonly refuse eth_getLogs outright. Fall back to the explorer
  // API (server-side, key-authenticated), which also returns each log's
  // timestamp so we skip the per-block lookups entirely.
  if (found.size === 0) {
    const topics = [toEventSelector(POOL_CREATED), toEventSelector(PAIR_CREATED)];
    for (const factory of factories) {
      for (const topic0 of topics) {
        const scanned = await scanFactoryLaunches({
          data: { chainId: cfg.id, factory, topic0, fromBlock: Number(floor) },
        }).catch(() => []);
        for (const s of scanned) {
          take(s.token0 as Address, BigInt(s.blockNumber), s.ts);
          take(s.token1 as Address, BigInt(s.blockNumber), s.ts);
        }
        if (found.size >= MAX_TOKENS) break;
      }
      if (found.size >= MAX_TOKENS) break;
    }
  }

  return [...found.values()].sort((a, b) => Number(b.blockNumber - a.blockNumber));
}

/**
 * Tokens whose first pool appeared in the recent block window. Rows carry real
 * name/symbol/supply read from the contract and a real age from the block
 * timestamp; everything market-related stays empty until a pricing source
 * covers them.
 */
// A full scan is ~4 getLogs plus 4 contract reads per token, so it runs on its
// own slow cadence and the list reuses the last result in between. Token
// metadata is immutable, so it's cached for the life of the session.
const SCAN_TTL_MS = 180_000;
const scanCache = new Map<ChainKey, { ts: number; rows: TokenRow[] }>();
const metaCache = new Map<string, Awaited<ReturnType<typeof getErc20Meta>>>();
let inFlightScan: Promise<TokenRow[]> | null = null;

export async function fetchNewLaunches(
  key: ChainKey,
  cfg: ChainConfig,
  /** Live pool addresses, used to discover which DEX factories this chain uses. */
  poolHints: string[] = [],
): Promise<TokenRow[]> {
  const hit = scanCache.get(key);
  if (hit && Date.now() - hit.ts < SCAN_TTL_MS) return hit.rows;
  // Collapse concurrent callers onto one scan.
  if (inFlightScan) return inFlightScan;

  inFlightScan = runScan(key, cfg, poolHints).finally(() => {
    inFlightScan = null;
  });
  const rows = await inFlightScan;
  scanCache.set(key, { ts: Date.now(), rows });
  return rows;
}

async function runScan(key: ChainKey, cfg: ChainConfig, poolHints: string[]): Promise<TokenRow[]> {
  const discovered = (await scanFactoryLogs(key, cfg, poolHints).catch(() => [])).slice(
    0,
    MAX_TOKENS,
  );
  if (!discovered.length) return [];

  const client = getPublicClient(key);
  const now = Date.now();

  // One timestamp lookup per distinct block, shared across tokens from it —
  // skipped entirely for entries whose source already supplied a timestamp.
  const blockTimes = new Map<string, number>();
  for (const d of discovered) {
    if (d.createdMs > 0) blockTimes.set(d.blockNumber.toString(), d.createdMs);
  }
  await Promise.all(
    [...new Set(discovered.map((d) => d.blockNumber.toString()))]
      .filter((bn) => !blockTimes.has(bn))
      .map(async (bn) => {
        try {
          const block = await client.getBlock({ blockNumber: BigInt(bn) });
          blockTimes.set(bn, Number(block.timestamp) * 1000);
        } catch {
          /* leave unknown — the row reports age as unknown rather than guessing */
        }
      }),
  );

  const rows = await Promise.all(
    discovered.map(async (d) => {
      const cacheKey = `${key}:${d.address.toLowerCase()}`;
      let meta = metaCache.get(cacheKey);
      if (meta === undefined) {
        meta = await getErc20Meta(key, d.address).catch(() => null);
        metaCache.set(cacheKey, meta);
      }
      if (!meta || meta.symbol === "?") return null;

      const createdMs = blockTimes.get(d.blockNumber.toString()) ?? 0;
      const ageMinutes = createdMs > 0 ? Math.max(0, (now - createdMs) / 60_000) : -1;

      const row: TokenRow = {
        address: d.address.toLowerCase(),
        name: meta.name,
        symbol: meta.symbol,
        logo: meta.symbol.slice(0, 2).toUpperCase(),
        ageMinutes,
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
        status: ageMinutes >= 0 && ageMinutes < 24 * 60 ? ["new"] : [],
        socialHeat: 0,
        lockedLiquidity: false,
        feeSplit: "90/10",
        socials: {},
        lastTradeMs: createdMs,
        priceSource: "none",
        indexed: false,
        totalSupply: meta.totalSupply,
        decimals: meta.decimals,
      };
      return row;
    }),
  );

  return rows.filter((r): r is TokenRow => r !== null);
}
