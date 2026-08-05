// Top-holder derivation, straight off the chain.
//
// Blockscout's /tokens/{addr}/holders is the easy source, and where it answers
// we use it. It doesn't answer on these chains often enough to rely on: Stable
// and Arc are new, their explorers are partial, and the holders endpoint is one
// of the last things a young Blockscout deployment turns on. That silence is
// what left the dev-holding and top-10 columns permanently blank — the terminal
// had no second way to find out who holds a token.
//
// The chain always knows. Every balance change emits Transfer(from, to, value),
// both parties indexed, so a scan of recent Transfer logs yields the set of
// addresses that have touched the token. Balances are then READ, not summed:
// reconstructing a balance from a partial log window would drift, whereas
// balanceOf on each candidate is exact as of this block.
//
// The candidate set is what's approximate, not the numbers. An address that
// received tokens before the scan window and has been dormant since won't be in
// it. For launchpad tokens — days old, all their transfers inside the window —
// that gap is nil, and it degrades gracefully for older ones: a holder that big
// and that quiet is rare, and every figure shown is still a real balance.

import { parseAbiItem, type Address, type Log } from "viem";
import type { ChainConfig, ChainKey } from "@/config/chains";
import { getErc20Balance, getPublicClient } from "./rpc";
import { fetchTokenHolders } from "./blockscout";
import { scanTransferLogs } from "../launch-scan";

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

// ─────────────────────────────────────────────────────────────────────────────
// How far back to look — measured in TIME, not blocks.
//
// This is why the distribution columns stayed blank on Stable. A flat 30,000
// blocks is a week of history on Ethereum and about three HOURS on Stable, which
// finalises sub-second and is already past block 34,000,000. Robinhood is worse:
// ~100ms blocks make 30,000 blocks fifty minutes. So a token that launched two
// days ago had every one of its transfers outside the window, the scan found no
// candidate addresses, and dev holding and top-10 reported nothing — on the
// chains where the on-chain route is the ONLY route, because their explorers
// don't serve a holders endpoint.
//
// The window is now derived from the chain's own measured block time, so it
// means the same thing everywhere.
// ─────────────────────────────────────────────────────────────────────────────

/** History worth scanning. Longer than any launchpad token has been alive. */
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
/** Ceiling on the span, so a chain reporting a nonsense block time can't run away. */
const MAX_BLOCKS = 2_000_000n;
/** Floor, so a slow chain still gets a usable window. */
const MIN_BLOCKS = 30_000n;
const CHUNK = 10_000n;
/** Chunks per scan. Bounds the work regardless of how wide the window is. */
const MAX_CHUNKS = 6;

/** Measured block time per chain, in ms. Cached — it doesn't change. */
const blockTimeMs = new Map<ChainKey, number>();

/**
 * How many blocks ago LOOKBACK_MS was, on this chain.
 *
 * Sampled from two real blocks rather than assumed: two headers, once per
 * session, and every consumer of the window gets it right on any chain.
 */
async function lookbackBlocks(key: ChainKey, head: bigint): Promise<bigint> {
  let ms = blockTimeMs.get(key);
  if (ms == null) {
    try {
      const client = getPublicClient(key);
      const back = head > 5_000n ? head - 5_000n : 0n;
      const [a, b] = await Promise.all([
        client.getBlock({ blockNumber: back }),
        client.getBlock({ blockNumber: head }),
      ]);
      const spanMs = Number(b.timestamp - a.timestamp) * 1000;
      const blocks = Number(head - back);
      ms = blocks > 0 && spanMs > 0 ? spanMs / blocks : 2_000;
    } catch {
      ms = 2_000; // conservative default; the clamps below keep it sane
    }
    blockTimeMs.set(key, ms);
  }
  const span = BigInt(Math.floor(LOOKBACK_MS / Math.max(ms, 1)));
  return span > MAX_BLOCKS ? MAX_BLOCKS : span < MIN_BLOCKS ? MIN_BLOCKS : span;
}

/** Balance reads are batched into multicalls, but the batch is still bounded. */
const MAX_CANDIDATES = 90;

/** Holder sets move slowly; a scan is expensive. Reuse it. */
const TTL_MS = 10 * 60_000;

export interface DerivedHolder {
  address: string;
  amount: number;
  pct: number;
}

const cache = new Map<string, { ts: number; holders: DerivedHolder[] }>();
const inFlight = new Map<string, Promise<DerivedHolder[]>>();

const BURN = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

/**
 * Addresses that have moved this token recently, newest blocks first.
 * Returns an empty list when neither the RPC nor the explorer will serve logs.
 */
async function candidateAddresses(
  key: ChainKey,
  cfg: ChainConfig,
  token: Address,
): Promise<string[]> {
  const client = getPublicClient(key);
  const seen = new Set<string>();

  const take = (a?: string) => {
    if (!a) return;
    const lower = a.toLowerCase();
    if (BURN.has(lower) || lower === token.toLowerCase()) return;
    seen.add(lower);
  };

  let head = 0n;
  try {
    head = await client.getBlockNumber();
  } catch {
    return [];
  }
  const span = await lookbackBlocks(key, head);
  const floor = head > span ? head - span : 0n;

  // The window can now be millions of blocks wide on a fast chain, so the
  // chunk stride is sized to cover it in MAX_CHUNKS requests rather than
  // walking it 10k at a time — which would be hundreds of calls. Nodes that
  // refuse a wide range just fail that chunk and the next one is tried.
  const stride = (() => {
    const even = (head - floor) / BigInt(MAX_CHUNKS);
    return even > CHUNK ? even : CHUNK;
  })();

  // Newest slice first, so a range-limited node still yields the freshest set.
  let chunks = 0;
  for (
    let to = head;
    to > floor && seen.size < MAX_CANDIDATES && chunks < MAX_CHUNKS;
    to -= stride
  ) {
    chunks++;
    const from = to - stride > floor ? to - stride : floor;
    let logs: Log[] = [];
    try {
      logs = (await client.getLogs({
        address: token,
        event: TRANSFER,
        fromBlock: from,
        toBlock: to,
      })) as Log[];
    } catch {
      // Range rejected, or the node doesn't serve logs at all.
      continue;
    }
    for (const log of logs) {
      const args = (log as { args?: { from?: string; to?: string } }).args;
      take(args?.from);
      take(args?.to);
      if (seen.size >= MAX_CANDIDATES) break;
    }
  }

  // Public RPCs commonly refuse eth_getLogs outright. The explorer API, called
  // server-side with the key, has no such limit.
  if (seen.size === 0) {
    const logs = await scanTransferLogs({
      data: { chainId: cfg.id, token, fromBlock: Number(floor) },
    }).catch(() => []);
    for (const l of logs) {
      take(l.from);
      take(l.to);
      if (seen.size >= MAX_CANDIDATES) break;
    }
  }

  return [...seen];
}

/**
 * The largest holders this token has, from whichever route can answer.
 *
 * THIS is the function to call — it is the one place in the app that answers
 * "who holds this token". Three separate callers used to each ask their own way:
 * the token page's activity panel, the distribution columns in the list, and the
 * whale count. Same token, same answer, three round trips, and they could
 * disagree with each other on screen. Now they share one cached result.
 *
 * Explorer first (one request, richest), the chain second (see deriveTopHolders).
 */
export async function getTokenHolders(
  key: ChainKey,
  cfg: ChainConfig,
  token: string,
  decimals: number,
  totalSupply: number,
  limit = 50,
): Promise<DerivedHolder[]> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(token) || totalSupply <= 0) return [];

  const cacheKey = `all:${key}:${token.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.holders.slice(0, limit);
  const running = inFlight.get(cacheKey);
  if (running) return (await running).slice(0, limit);

  const job = (async () => {
    const explorer = await fetchTokenHolders(cfg, token, decimals, totalSupply, MAX_CANDIDATES)
      .catch(() => [])
      .then((rows) => rows.filter((h) => h.amount > 0));
    if (explorer.length) return explorer.sort((a, b) => b.amount - a.amount);
    return deriveTopHolders(key, cfg, token, decimals, totalSupply, MAX_CANDIDATES);
  })();

  inFlight.set(cacheKey, job);
  try {
    const holders = await job;
    if (holders.length) cache.set(cacheKey, { ts: Date.now(), holders });
    return holders.slice(0, limit);
  } finally {
    inFlight.delete(cacheKey);
  }
}

/**
 * The largest holders this token has, derived from the chain. Sorted by balance,
 * descending. Empty when logs are unavailable from every route — in which case
 * the caller shows no data rather than a number it can't stand behind.
 *
 * Prefer `getTokenHolders` — this is only the on-chain half of it.
 */
export async function deriveTopHolders(
  key: ChainKey,
  cfg: ChainConfig,
  token: string,
  decimals: number,
  totalSupply: number,
  limit = 10,
): Promise<DerivedHolder[]> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(token) || totalSupply <= 0) return [];

  const cacheKey = `chain:${key}:${token.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.holders.slice(0, limit);
  const running = inFlight.get(cacheKey);
  if (running) return (await running).slice(0, limit);

  const job = (async () => {
    const candidates = await candidateAddresses(key, cfg, token as Address);
    if (!candidates.length) return [];

    const balances = await Promise.all(
      candidates.map((a) =>
        getErc20Balance(key, token as Address, a as Address, decimals).catch(() => 0),
      ),
    );

    return candidates
      .map((address, i) => ({
        address,
        amount: balances[i],
        pct: (balances[i] / totalSupply) * 100,
      }))
      .filter((h) => h.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  })();

  inFlight.set(cacheKey, job);
  try {
    const holders = await job;
    // Only cache a real answer — a failed scan should retry, not go quiet for
    // ten minutes.
    if (holders.length) cache.set(cacheKey, { ts: Date.now(), holders });
    return holders.slice(0, limit);
  } finally {
    inFlight.delete(cacheKey);
  }
}
