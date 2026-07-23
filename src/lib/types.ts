// Canonical data shapes for the terminal. These are populated from REAL sources
// (RPC + block-explorer + DEX aggregators). Fields that a given source can't
// provide are left at neutral values (0 / undefined) and the UI labels them as
// "no data" rather than inventing numbers.

export type TokenStatus = "new" | "trending" | "graduating" | "graduated" | "cto";

export interface Social {
  twitter?: string;
  telegram?: string;
  website?: string;
  farcaster?: string;
}

export interface TokenRow {
  address: string;
  name: string;
  symbol: string;
  logo: string; // emoji/text placeholder or first letter
  logoUrl?: string; // real token icon if the explorer/aggregator has one
  ageMinutes: number;
  price: number; // USD
  priceChange1h: number;
  priceChange24h: number;
  mcap: number;
  fdv: number;
  vol5m: number;
  vol1h: number;
  vol6h: number;
  vol24h: number;
  buys24h: number;
  sells24h: number;
  liquidityEth: number;
  liquidityUsd?: number;
  graduationPct: number; // 0..100 (launchpad-specific; 0 when N/A)
  holders: number;
  topHolderPct: number;
  deployer: string;
  status: TokenStatus[];
  socialHeat: number; // 0..100 — filled by the X social layer
  ctoAt?: number;
  lockedLiquidity: boolean;
  feeSplit: "70/30" | "90/10";
  restrictionsEndBlock?: number;
  socials: Social;
  lastTradeMs: number;
  /** Where the market figures came from, surfaced in the UI for honesty. */
  priceSource?: "geckoterminal" | "dexscreener" | "explorer" | "none";
  /** True when the token has tradable on-chain liquidity we could price. */
  indexed?: boolean;
  totalSupply?: number;
  decimals?: number;
  /** Venue the primary pool trades on (e.g. "Uniswap V3"). */
  dexName?: string;
  /** Launchpad the token launched from, when its pool sits on one. */
  launchpadName?: string;
  /** True when a launchpad token also has a pool on a regular DEX. */
  graduated?: boolean;
  /** Real 5-point trend [-24h,-6h,-1h,-5m,now] reconstructed from price changes. */
  sparkline?: number[];
  priceChange5m?: number;
}

export interface TradeEvent {
  id: string;
  tokenAddress: string;
  symbol: string;
  side: "buy" | "sell";
  amountUsd: number;
  priceImpact: number;
  wallet: string;
  ms: number;
  txHash?: string;
}

export interface ChainStats {
  vol24h: number;
  launches24h: number;
  trades24h: number;
  totalTransactions?: number;
  totalAddresses?: number;
  gasPriceGwei?: number;
  blockNumber?: number;
  updatedAt: Date;
  /** True when at least one figure came off a live source. */
  live: boolean;
}
