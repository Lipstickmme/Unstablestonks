// Explorer-scanned token list → TokenRow[].
//
// Wraps the server-side `scanTradedTokens` call (Etherscan-family API, keyed)
// and turns its transfer records into rows. Rows arrive unpriced: this source
// knows what exists and when it was last traded, not what it's worth, and the
// GeckoTerminal/DexScreener enrichment fills the market data.

import type { ChainConfig } from "@/config/chains";
import type { TokenRow } from "../types";
import { scanTradedTokens, type ScannedToken } from "../token-scan";

export interface ExplorerTokenScan {
  rows: TokenRow[];
  note?: string;
}

function toRow(t: ScannedToken, now: number): TokenRow {
  // Age is only claimed when we actually watched the token appear inside the
  // scanned window; otherwise it stays unknown rather than being guessed from
  // where the page happened to end.
  const ageMinutes = t.firstSeenIsLaunch ? Math.max(0, (now - t.firstSeenMs) / 60_000) : -1;

  return {
    address: t.address,
    name: t.name,
    symbol: t.symbol,
    logo: t.symbol.slice(0, 2).toUpperCase(),
    ageMinutes,
    price: 0,
    priceChange1h: 0,
    priceChange24h: 0,
    mcap: 0,
    fdv: 0,
    vol5m: 0,
    vol1h: 0,
    vol6h: 0,
    vol24h: 0,
    buys24h: 0,
    sells24h: 0,
    liquidityEth: 0,
    graduationPct: 0,
    holders: 0,
    topHolderPct: 0,
    deployer: "",
    status: ageMinutes >= 0 && ageMinutes < 24 * 60 ? ["new"] : [],
    socialHeat: 0,
    lockedLiquidity: false,
    feeSplit: "90/10",
    socials: {},
    lastTradeMs: t.lastSeenMs,
    priceSource: "none",
    indexed: false,
    decimals: t.decimals,
  };
}

/**
 * Tokens traded through the chain's DEX router, newest activity first. Queries
 * the router and, when known, the factories behind it — between them they touch
 * every tradable token on the chain.
 */
export async function fetchExplorerTokens(
  cfg: ChainConfig,
  extraAddresses: string[] = [],
): Promise<ExplorerTokenScan> {
  const addresses = [cfg.router?.address, ...extraAddresses].filter(
    (a): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a),
  );
  if (!addresses.length) return { rows: [], note: "no router configured" };

  const res = await scanTradedTokens({ data: { chainId: cfg.id, addresses } }).catch(() => null);
  if (!res) return { rows: [], note: "explorer scan failed" };

  const now = Date.now();
  const quotes = new Set(
    [cfg.wrappedNative, cfg.stablecoin?.address, cfg.intermediary?.address]
      .filter(Boolean)
      .map((a) => (a as string).toLowerCase()),
  );

  return {
    rows: res.tokens
      .filter((t) => !quotes.has(t.address) && t.symbol !== "?")
      .map((t) => toRow(t, now)),
    note: res.note,
  };
}
