// External trading surfaces and community links.

const env = (key: string): string | undefined => {
  const v = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
  return v && v.length > 0 ? v : undefined;
};

/** Telegram bot username the BaseBot links point at. */
const BASE_BOT = env("VITE_BASE_BOT") ?? "based_eth_bot";

/** Our referral payload — the part that must survive on every link. */
const BASE_BOT_REF = env("VITE_BASE_BOT_REF") ?? "r_5092368318";

/**
 * How a token address is appended to the referral payload.
 *
 * Telegram allows ONE `start` parameter, max 64 chars, `[A-Za-z0-9_-]` only. So
 * referral and token have to share it: `r_5092368318-0x<40 hex>` is 55 chars and
 * fits. Bots differ on the separator they parse, so it's env-tunable — set
 * VITE_BASE_BOT_SEP if BaseBot expects `_` or something else.
 *
 * NOTE: whether BaseBot actually parses a combined payload is the bot's
 * business, not ours. If it ignores the token half, the link still opens with
 * the referral intact, which is the part that must not break.
 */
const SEP = env("VITE_BASE_BOT_SEP") ?? "-";

/** Telegram rejects a start payload outside this set. */
const SAFE = /^[A-Za-z0-9_-]+$/;

/**
 * BaseBot link. With a token address the bot opens on that token; without one
 * it opens the bot normally. The referral payload is always present.
 */
export function baseBotUrl(tokenAddress?: string): string {
  const base = `https://t.me/${BASE_BOT}?start=`;
  if (!tokenAddress) return base + BASE_BOT_REF;

  const payload = `${BASE_BOT_REF}${SEP}${tokenAddress}`;
  // Over-length or illegal payloads are silently dropped by Telegram, which
  // would lose the referral too — fall back to the plain referral link.
  if (payload.length > 64 || !SAFE.test(payload)) return base + BASE_BOT_REF;
  return base + payload;
}

/** Plain referral link, for places with no token context. */
export const BASE_BOT_URL = baseBotUrl();

/** Community endpoints used by the whitelist quest. */
export const COMMUNITY = {
  telegramGroup: "https://t.me/UnstableStonk",
  telegramChannel: "https://t.me/UnstableStonks",
  x: "https://x.com/Unstablestonks",
  xPost: "https://x.com/Unstablestonks/status/2082384116532605155",
} as const;
