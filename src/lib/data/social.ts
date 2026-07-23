import { useQuery } from "@tanstack/react-query";
import { searchXSocial, type XSocialResult } from "@/lib/x-social";

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
