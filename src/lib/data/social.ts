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
