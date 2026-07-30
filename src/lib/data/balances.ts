// One place that answers "how much of token X does wallet Y hold".
//
// Three features want that number and each wanted it in its own shape: live
// trades wants a share of supply, whale watch wants a dollar value, the
// portfolio wants the raw balance. They were each reading balanceOf themselves,
// so on the token page the SAME wallet's balance of the SAME token was fetched
// twice per cycle — and the two reads could land on different blocks and
// disagree on screen.
//
// The cache is keyed by chain + token + wallet, which is what the number is
// actually about. Callers derive their own view from it. Overlapping requests
// only fetch the wallets that aren't already known, so the second panel on a
// page usually costs nothing.

import type { ChainKey } from "@/config/chains";
import { getErc20Balance } from "./rpc";

/** Balances move with every trade, so this is short — it exists to collapse
 *  simultaneous readers, not to serve stale numbers. */
const TTL_MS = 60_000;

const cache = new Map<string, { ts: number; value: number }>();
const inFlight = new Map<string, Promise<number>>();

const cacheKey = (chain: ChainKey, token: string, wallet: string) =>
  `${chain}:${token.toLowerCase()}:${wallet.toLowerCase()}`;

/**
 * Token balances for a set of wallets, as a lowercase-address → amount map.
 * Zero balances are omitted. Never throws — an unreachable RPC yields an empty
 * map and the caller shows no data rather than a wrong one.
 */
export async function sharedBalances(
  chain: ChainKey,
  token: string,
  decimals: number,
  wallets: string[],
): Promise<Record<string, number>> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return {};

  const out: Record<string, number> = {};
  const now = Date.now();
  const pending: { wallet: string; key: string }[] = [];

  for (const w of wallets) {
    const lower = w.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(lower) || lower in out) continue;
    const key = cacheKey(chain, token, lower);
    const hit = cache.get(key);
    if (hit && now - hit.ts < TTL_MS) {
      if (hit.value > 0) out[lower] = hit.value;
      continue;
    }
    pending.push({ wallet: lower, key });
  }

  if (!pending.length) return out;

  // viem batches these into multicalls, so a screenful of wallets is a round
  // trip or two rather than one call each.
  await Promise.all(
    pending.map(async ({ wallet, key }) => {
      const running = inFlight.get(key);
      const job =
        running ??
        getErc20Balance(chain, token as `0x${string}`, wallet as `0x${string}`, decimals).catch(
          () => 0,
        );
      if (!running) inFlight.set(key, job);
      try {
        const value = await job;
        cache.set(key, { ts: Date.now(), value });
        if (value > 0) out[wallet] = value;
      } finally {
        if (!running) inFlight.delete(key);
      }
    }),
  );

  return out;
}
