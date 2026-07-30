// Canonical assets, read straight off the chain.
//
// Every other source in this app is a third party that may or may not cover a
// given chain. Arc is the clearest case: its mainnet produces blocks and has
// USDC deployed, but no public aggregator indexes it, so GeckoTerminal,
// DexScreener and the explorer adapters all return nothing and the terminal is
// empty. Stable had a milder version of the same problem.
//
// The contracts always answer. Reading a chain's documented predeploys directly
// gives real names, symbols, decimals and total supply with no indexer in the
// loop — a floor under the token list that cannot go dark.
//
// These rows arrive UNPRICED (indexed: false). A stablecoin's price is not
// assumed to be a dollar here: if a market source later covers it, the merge in
// useTokens fills the price in; until then the UI shows "no data" rather than a
// number nobody quoted.

import type { ChainConfig, ChainKey } from "@/config/chains";
import type { TokenRow } from "../types";
import { getErc20Meta } from "./rpc";

/** Metadata is immutable — one read per token per session. */
const cache = new Map<string, TokenRow | null>();

export async function fetchSeedTokens(key: ChainKey, cfg: ChainConfig): Promise<TokenRow[]> {
  const seeds = cfg.seedTokens ?? [];
  if (!seeds.length) return [];

  const rows = await Promise.all(
    seeds.map(async (address) => {
      const cacheKey = `${key}:${address.toLowerCase()}`;
      const hit = cache.get(cacheKey);
      if (hit !== undefined) return hit;

      const meta = await getErc20Meta(key, address).catch(() => null);
      // A null is cached too: a predeploy that doesn't answer won't start
      // answering this session, and retrying it every five minutes is waste.
      const row: TokenRow | null = meta
        ? {
            address: address.toLowerCase(),
            name: meta.name,
            symbol: meta.symbol,
            logo: meta.symbol.slice(0, 2).toUpperCase(),
            ageMinutes: -1,
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
            status: [],
            socialHeat: 0,
            lockedLiquidity: false,
            feeSplit: "70/30",
            socials: {},
            lastTradeMs: Date.now(),
            priceSource: "none",
            indexed: false,
            totalSupply: meta.totalSupply,
            decimals: meta.decimals,
          }
        : null;
      cache.set(cacheKey, row);
      return row;
    }),
  );

  return rows.filter((r): r is TokenRow => r !== null);
}
