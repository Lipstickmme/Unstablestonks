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
