import { CHAINS, type ChainKey } from "@/config/chains";

// ─────────────────────────────────────────────────────────────────────────────
// Quote assets: the money, not the trade.
//
// Every pool has two sides. One is the token someone is speculating on; the
// other is what they paid with — WETH, USDT0, USDC, a wrapped stable. Both sides
// appear in a pool feed identically, so the quote side leaks into everything
// built from that feed, and it is noise in all of them:
//
//   · the launches list, where WgUSDT ranks above real launches on volume purely
//     because it is one side of every trade on the chain;
//   · the bubble map, where a stablecoin's market cap dwarfs the tokens the map
//     exists to compare;
//   · bundle detection, which flags a stablecoin's constant same-block activity
//     as coordinated when it is just... the chain working;
//   · whale watch, most of all. The point of following a whale is to see what
//     they are buying. "Whale bought USDT" is not a signal, it is the other half
//     of a trade whose interesting side we just filtered out.
//
// Two ways in, deliberately. Addresses from the chain config are certain — they
// are the assets this app itself routes through. The symbol list is a fallback
// for assets we don't have an address for, kept tight on purpose: it matches
// canonical tickers exactly rather than by substring, because a memecoin called
// STABLE or PONS must never be swept up with the real stablecoins.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical quote/settlement tickers, matched EXACTLY (case-insensitive).
 *
 * Substring matching was the trap here: "USD" would eat USDUC, and "stable"
 * would eat a token literally named stable — both of which are real launches in
 * the current list.
 */
const QUOTE_SYMBOLS = new Set(
  [
    // Wrapped natives
    "weth",
    "wbtc",
    "wbnb",
    "wavax",
    "wmatic",
    "wpol",
    "wcelo",
    "wxdai",
    "ws",
    // Dollar stables
    "usdc",
    "usdc.e",
    "usdt",
    "usdt0",
    "usdt.e",
    "usds",
    "usdg",
    "usde",
    "usdd",
    "dai",
    "frax",
    "tusd",
    "busd",
    "lusd",
    "gusd",
    "pyusd",
    "fdusd",
    "susd",
    "crvusd",
    "usdb",
    "usdx",
    "usdy",
    "usda",
    "usdl",
    "usdn",
    "usdp",
    "usdm",
    // Wrapped/staked forms of the above that show up as pool sides
    "wgusdt",
    "wusdt",
    "wusdt0",
    "wusdc",
    "wdai",
    "susds",
    "sdai",
    "steth",
    "wsteth",
    // Non-dollar stables
    "eurc",
    "eurs",
    "eure",
    "xsgd",
    "gyen",
  ].map((s) => s.toLowerCase()),
);

/** Every address this chain treats as money, from its own config. */
function configuredQuoteAddresses(chainKey: ChainKey): Set<string> {
  const cfg = CHAINS[chainKey];
  const out = new Set<string>();
  const add = (a?: string) => {
    if (a) out.add(a.toLowerCase());
  };
  add(cfg.wrappedNative);
  add(cfg.stablecoin?.address);
  add(cfg.intermediary?.address);
  for (const a of cfg.extraRoutingBases ?? []) add(a);
  // Seed tokens are the chain's canonical assets by definition — USDC and EURC
  // on Arc, USDT0 on Stable. They belong on the list for exactly that reason.
  for (const a of cfg.seedTokens ?? []) add(a);
  return out;
}

const cache = new Map<ChainKey, Set<string>>();

function quoteAddresses(chainKey: ChainKey): Set<string> {
  let hit = cache.get(chainKey);
  if (!hit) {
    hit = configuredQuoteAddresses(chainKey);
    cache.set(chainKey, hit);
  }
  return hit;
}

/**
 * True when this token is the money side of a pair rather than something being
 * traded. Address match first (certain), then an exact-ticker fallback.
 */
export function isQuoteAsset(chainKey: ChainKey, address?: string, symbol?: string): boolean {
  if (address && quoteAddresses(chainKey).has(address.toLowerCase())) return true;
  if (symbol && QUOTE_SYMBOLS.has(symbol.trim().toLowerCase())) return true;
  return false;
}

/** Drop the money side from any list of things that carry a token identity. */
export function withoutQuoteAssets<T extends { address?: string; symbol?: string }>(
  chainKey: ChainKey,
  items: T[],
): T[] {
  return items.filter((t) => !isQuoteAsset(chainKey, t.address, t.symbol));
}
