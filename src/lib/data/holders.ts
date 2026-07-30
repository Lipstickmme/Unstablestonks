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
import { scanTransferLogs } from "../launch-scan";

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/** Blocks to look back, and the slice size most public RPCs will serve. */
const MAX_BLOCKS = 30_000n;
const CHUNK = 10_000n;

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
  const floor = head > MAX_BLOCKS ? head - MAX_BLOCKS : 0n;

  // Newest slice first, so a range-limited node still yields the freshest set.
  for (let to = head; to > floor && seen.size < MAX_CANDIDATES; to -= CHUNK) {
    const from = to - CHUNK > floor ? to - CHUNK : floor;
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
 * The largest holders this token has, derived from the chain. Sorted by balance,
 * descending. Empty when logs are unavailable from every route — in which case
 * the caller shows no data rather than a number it can't stand behind.
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

  const cacheKey = `${key}:${token.toLowerCase()}`;
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
