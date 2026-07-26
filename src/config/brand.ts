// Brand artwork.
//
// One place for every logo the app renders, so swapping any of them is an edit
// here rather than a hunt through markup.
//
// NOTE ON CASE: `stonkslogo.PNG` has an uppercase extension. Static hosts serve
// these case-sensitively, so the path must match the file byte for byte — a
// lowercase `.png` here resolves on a Mac and 404s in production.

const env = (key: string): string | undefined => {
  const v = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
  return v && v.length > 0 ? v : undefined;
};

/** The UnstableStonks mark — header logo and favicon. */
export const BRAND_IMAGE_URL = env("VITE_BRAND_IMAGE") ?? "/stonkslogo.PNG";

/**
 * Absolute URL for the social link card. Crawlers don't resolve relative paths,
 * so a site URL is needed to serve the local file; without one we fall back to
 * the IPFS-hosted copy, which is absolute and already correct.
 */
const SITE_URL = env("VITE_SITE_URL")?.replace(/\/$/, "");
export const BRAND_CARD_URL = SITE_URL
  ? `${SITE_URL}${BRAND_IMAGE_URL}`
  : "https://silver-administrative-caribou-620.mypinata.cloud/ipfs/bafkreibe5jv5xc62xj2cddfypwk54mgz2tdpf4m47zmn2zaas6ycxi5mvq";

/** Per-DEX artwork, matched on the venue name a pool reports. */
const VENUE_LOGOS: { test: RegExp; src: string }[] = [
  { test: /uniswap/i, src: "/uniswaplogo.png" },
];

/** Logo for a trading venue, when we have one. */
export function venueLogo(name?: string): string | undefined {
  if (!name) return undefined;
  return VENUE_LOGOS.find((v) => v.test.test(name))?.src;
}
