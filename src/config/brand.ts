// Brand artwork.
//
// One place for every logo the app renders, so swapping any of them is an edit
// here rather than a hunt through markup.
//
// NOTE ON CASE: static hosts serve these paths case-sensitively, so each string
// must match its file byte for byte — a case slip resolves on a Mac and 404s in
// production.

const env = (key: string): string | undefined => {
  const v = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
  return v && v.length > 0 ? v : undefined;
};

/** The UnstableStonks mark — header logo and favicon. */
export const BRAND_IMAGE_URL = env("VITE_BRAND_IMAGE") ?? "/unstablestonkslogo.jpg";

/**
 * Absolute URL for the social link card. Crawlers don't resolve relative paths,
 * so a site URL is needed to serve the local file; without one we fall back to
 * the IPFS-hosted copy, which is absolute and already correct.
 */
/**
 * The deployed origin, no trailing slash.
 *
 * Used for the social card, canonical URLs and structured data. Falls back to
 * the production domain so search engines get an absolute canonical even from a
 * preview build that forgot the env var — a relative or missing canonical is
 * worse than a slightly wrong one, because it lets a preview deployment compete
 * with production for the same query.
 */
export const SITE_URL =
  env("VITE_SITE_URL")?.replace(/\/$/, "") ?? "https://unstablestonks.vercel.app";

export const BRAND_CARD_URL = env("VITE_SITE_URL")
  ? `${SITE_URL}${BRAND_IMAGE_URL}`
  : "https://silver-administrative-caribou-620.mypinata.cloud/ipfs/bafkreibe5jv5xc62xj2cddfypwk54mgz2tdpf4m47zmn2zaas6ycxi5mvq";

/**
 * Purpose-built favicons, generated at the sizes each platform actually asks
 * for. A single large image scaled down by the browser is what makes a mark
 * look muddy in a tab.
 */
export const FAVICONS = {
  ico: "/favicon.ico",
  png16: "/favicon-16x16.png",
  png32: "/favicon-32x32.png",
  apple: "/apple-touch-icon.png",
  android192: "/android-chrome-192x192.png",
  android512: "/android-chrome-512x512.png",
} as const;

/**
 * Per-DEX artwork, matched on the venue name a pool reports.
 *
 * Regexes rather than exact names: indexers report "Uniswap V3", "uniswap_v3",
 * "DYORSwap (Stable)" and similar variants for the same venue, so matching on
 * the recognisable stem survives whatever spelling comes back. Order matters —
 * the first match wins.
 */
const VENUE_LOGOS: { test: RegExp; src: string }[] = [
  { test: /uniswap/i, src: "/uniswaplogo.png" },
  { test: /dyor/i, src: "/dyorswap.jpg" },
  { test: /pons/i, src: "/ponsfamily.jpg" },
];

/**
 * Logo for a trading venue, when we have one.
 *
 * Returns undefined for the many venues we have no artwork for — Sushi,
 * PancakeSwap, Noxa, Bankr, Virtuals, Hoodit and whatever launches next month.
 * Callers render a lettermark in that case (see VenueIcon), so a new venue
 * appears correctly labelled the day it shows up rather than as a blank.
 *
 * Adding real artwork is two steps and no code: drop the file in public/ and add
 * a line above. Order matters — the first match wins.
 */
export function venueLogo(name?: string): string | undefined {
  if (!name) return undefined;
  return VENUE_LOGOS.find((v) => v.test.test(name))?.src;
}

/**
 * Stable accent colour for a venue with no artwork, derived from its name.
 *
 * Deterministic so a venue keeps the same colour across every pool row and
 * between sessions — an unrecognised venue should still be recognisable.
 */
export function venueHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
