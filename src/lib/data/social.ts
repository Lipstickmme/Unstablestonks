import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchXSocial, searchXSocialBatch, type XSocialResult } from "@/lib/x-social";

/**
 * Crawl X for real posts / reach about a contract address (or symbol).
 * Backed by the server function in x-social.ts (official API when keyed, Nitter
 * fallback otherwise). Never returns fabricated posts.
 */
export function useXSocial(query: string | undefined, enabled = true) {
  return useQuery<XSocialResult>({
    queryKey: ["x-social", query],
    enabled: enabled && Boolean(query),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 0,
    queryFn: () => searchXSocial({ data: { query: query as string } }),
  });
}

/**
 * Dashboard heat map: crawl X for up to 5 contract addresses in one batched
 * server call (cached server-side). Returns { address → heat/mentions/... }.
 */
export function useXSocialHeatMap(addresses: string[]) {
  const key = addresses.join(",");
  return useQuery<Record<string, XSocialResult>>({
    queryKey: ["x-social-batch", key],
    enabled: addresses.length > 0,
    staleTime: 120_000,
    refetchInterval: 180_000,
    retry: 0,
    queryFn: () => searchXSocialBatch({ data: { queries: addresses } }),
  });
}

/**
 * Share of voice for `address`: its X mentions as a % of total mentions across
 * a peer set (address + up to 4 top peers on the chain). Returns null until the
 * batch resolves or when there's no measurable chatter.
 */
export function useShareOfVoice(address: string | undefined, peers: string[]) {
  const set = address
    ? Array.from(new Set([address.toLowerCase(), ...peers.map((p) => p.toLowerCase())])).slice(0, 5)
    : [];
  const { data } = useXSocialHeatMap(set);
  if (!address || !data) return null;
  const total = Object.values(data).reduce((s, r) => s + (r?.mentions ?? 0), 0);
  if (total <= 0) return null;
  const mine = data[address.toLowerCase()]?.mentions ?? 0;
  return (mine / total) * 100;
}

/** How many contracts one rotation crawls, and how often it advances. */
const ROTATION_SIZE = 8;
const ROTATION_MS = 45_000;

/**
 * Social heat for EVERY token on screen, not just the first handful.
 *
 * Crawling a hundred contracts at once would blow through every rate limit, so
 * the scan rotates: each pass takes the next slice of addresses, and results
 * accumulate into one map that persists across passes. After a few cycles the
 * whole list carries a real score, and each token is re-crawled on its way back
 * round. Addresses that have never been scored are always taken first, so a
 * newly listed token doesn't wait a full lap.
 */
export function useRotatingXHeat(addresses: string[]): Record<string, XSocialResult> {
  const [scores, setScores] = useState<Record<string, XSocialResult>>({});
  const cursor = useRef(0);
  const key = addresses.join(",");

  useEffect(() => {
    if (!addresses.length) return;
    let cancelled = false;

    const runPass = async () => {
      const scored = new Set(Object.keys(scores));
      const unscored = addresses.filter((a) => !scored.has(a));
      // Unscored first; otherwise continue round the list from where we stopped.
      const batch = unscored.length
        ? unscored.slice(0, ROTATION_SIZE)
        : Array.from({ length: Math.min(ROTATION_SIZE, addresses.length) }, (_, i) => {
            return addresses[(cursor.current + i) % addresses.length];
          });
      if (!unscored.length) cursor.current = (cursor.current + ROTATION_SIZE) % addresses.length;

      try {
        const res = await searchXSocialBatch({ data: { queries: batch } });
        if (cancelled) return;
        setScores((prev) => {
          const next = { ...prev };
          for (const [addr, result] of Object.entries(res)) {
            // Keep the last real reading rather than replacing it with a miss:
            // one unreachable pass shouldn't blank a score the UI already shows.
            if (result?.ok || !next[addr]) next[addr] = result;
          }
          return next;
        });
      } catch {
        /* leave prior scores in place */
      }
    };

    void runPass();
    const id = setInterval(runPass, ROTATION_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // `key` stands in for the address list; `scores` is read inside but must not
    // restart the timer on every merge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return scores;
}
