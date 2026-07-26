// Brand artwork, hosted on IPFS behind a dedicated Pinata gateway.
//
// One constant, used by the header logo, the favicon and the social link card,
// so swapping the artwork is a single edit here (or a single env var in the
// deploy) rather than a hunt through markup.
//
// It stays a remote URL deliberately: the file is content-addressed, so the CID
// pins this exact image forever and a CDN serves it closer to the user than our
// own origin would.
export const BRAND_IMAGE_URL =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BRAND_IMAGE ??
  "https://silver-administrative-caribou-620.mypinata.cloud/ipfs/bafkreibe5jv5xc62xj2cddfypwk54mgz2tdpf4m47zmn2zaas6ycxi5mvq";

/** The gateway the artwork loads from — preconnected so the mark paints sooner. */
export const BRAND_IMAGE_ORIGIN = "https://silver-administrative-caribou-620.mypinata.cloud";
