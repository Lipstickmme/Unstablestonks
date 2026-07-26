// ─────────────────────────────────────────────────────────────────────────────
// UnstableStonks multi-chain registry.
//
// Three real networks the terminal switches between. Endpoints are the public
// ones published by each network (July 2026). Everything downstream — RPC reads,
// explorer indexing, swaps, fee collection — is derived from this file, so a new
// chain is a single entry here.
//
// Router / wrapped-native addresses are intentionally left `undefined` for chains
// where no DEX router has been verified yet. We NEVER hardcode an unverified
// router address (funds would be at risk); instead the swap engine collects the
// platform fee via a plain transfer (works everywhere) and only enables the DEX
// swap leg once a router is configured — per chain, overridable via env.
// ─────────────────────────────────────────────────────────────────────────────

export type ChainKey = "robinhood" | "stable" | "arc";

export type ExplorerKind = "blockscout" | "generic";

export interface RouterConfig {
  kind: "uniswapV2" | "uniswapV3";
  address: `0x${string}`;
  /** Fee tier for v3 (e.g. 3000 = 0.3%). Ignored for v2. */
  feeTier?: number;
  /** QuoterV2 address — required for v3 quoting. */
  quoter?: `0x${string}`;
}

/**
 * The token every swap routes through (the DEX hop / quote asset) and how the
 * INPUT side is funded on a buy:
 *  - "native": send native gas as value; the router wraps it (classic WETH path).
 *  - "erc20":  approve + pull the token via transferFrom, no native value. Used
 *              when the gas token is itself an ERC-20 (e.g. USDT0 on Stable, whose
 *              wrapped-native predeploy is a non-functional revert-stub).
 */
export interface Intermediary {
  address: `0x${string}`;
  decimals: number;
  mode: "native" | "erc20";
  /** Display symbol for the routing asset (e.g. "USDT0", "ETH"). */
  symbol: string;
}

export interface ChainConfig {
  key: ChainKey;
  id: number;
  name: string;
  shortName: string;
  /** Header badge glyph. */
  badge: string;
  network: "mainnet" | "testnet";
  /** Whether the network is live in production (Arc is testnet-only for now). */
  live: boolean;
  rpcUrls: string[];
  explorerUrl: string;
  explorer: { kind: ExplorerKind; apiBase?: string };
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** Human label for the gas token (may differ from the native symbol). */
  gasToken: string;
  /** Wrapped-native token used as the swap intermediary, when known. */
  wrappedNative?: `0x${string}`;
  /** Canonical stablecoin on the chain, used as a quote asset when known. */
  stablecoin?: { symbol: string; address?: `0x${string}`; decimals: number };
  /**
   * Explicit routing/quote token. When set, overrides the wrapped-native as the
   * DEX hop — required on chains whose wrapped-native is unusable (Stable).
   */
  intermediary?: Intermediary;
  router?: RouterConfig;
  /** GeckoTerminal network slug, if the chain is indexed there. */
  geckoterminalNetwork?: string;
  /** DYOR Fun V3 API path segment — the API is namespaced /api/<slug>/... */
  dyorSlug?: string;
  /**
   * DexScreener chain slug, used to check whether a token's DEX listing is paid
   * for. Unset (or unindexed) → the check reports "unknown" rather than "unpaid".
   */
  dexscreenerSlug?: string;
  /** Per-chain accent (oklch) so the UI reskins on switch. */
  accent: string;
  tagline: string;
}

// Platform fee: collected on every swap into the project treasury, on ALL chains.
export const FEE_RECIPIENT = "0x6E53C6288Dc2C0F957Dc1F5E7d78874c3223CC96" as const;
export const PLATFORM_FEE_BPS = 100; // 1.00%

/** Read an optional Vite env override without crashing when it's absent. */
function env(key: string): string | undefined {
  const v = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
  return v && v.length > 0 ? v : undefined;
}

const isAddr = (v: string | undefined): v is string => Boolean(v && /^0x[0-9a-fA-F]{40}$/.test(v));

/**
 * Router config from env, per chain:
 *   VITE_ROUTER_<CHAIN>       router address (required to enable swaps)
 *   VITE_ROUTER_KIND_<CHAIN>  "v2" (default) | "v3"
 *   VITE_QUOTER_<CHAIN>       QuoterV2 address (required for v3 quotes)
 *   VITE_FEE_TIER_<CHAIN>     v3 fee tier, default 3000 (0.3%)
 */
function routerFromEnv(chainUpper: string): RouterConfig | undefined {
  const addr = env(`VITE_ROUTER_${chainUpper}`);
  if (!isAddr(addr)) return undefined;
  const kind = env(`VITE_ROUTER_KIND_${chainUpper}`) === "v3" ? "uniswapV3" : "uniswapV2";
  const quoter = env(`VITE_QUOTER_${chainUpper}`);
  const feeTier = parseInt(env(`VITE_FEE_TIER_${chainUpper}`) ?? "3000", 10);
  return {
    kind,
    address: addr as `0x${string}`,
    feeTier: isFinite(feeTier) ? feeTier : 3000,
    quoter: isAddr(quoter) ? (quoter as `0x${string}`) : undefined,
  };
}

export const CHAINS: Record<ChainKey, ChainConfig> = {
  robinhood: {
    key: "robinhood",
    id: 4663,
    name: "Robinhood Chain",
    shortName: "RH",
    badge: "R",
    network: "mainnet",
    live: true,
    rpcUrls: [env("VITE_RPC_ROBINHOOD") ?? "https://rpc.mainnet.chain.robinhood.com"],
    explorerUrl: "https://robinhoodchain.blockscout.com",
    explorer: { kind: "blockscout", apiBase: "https://robinhoodchain.blockscout.com/api/v2" },
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    gasToken: "ETH",
    // Canonical WETH on Robinhood Chain (from Uniswap's official SDK).
    wrappedNative: (env("VITE_WNATIVE_ROBINHOOD") ??
      "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73") as `0x${string}`,
    // Uniswap V3 on Robinhood (SwapRouter02 + QuoterV2, from the Uniswap SDK).
    // Default fee tier 1% — launchpad/memecoin pools; quoter probes other tiers.
    router: routerFromEnv("ROBINHOOD") ?? {
      kind: "uniswapV3",
      address: "0xcaf681a66d020601342297493863e78c959e5cb2",
      quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
      feeTier: 10000,
    },
    // Robinhood Chain is indexed by GeckoTerminal — unlocks DEX prices/vol/trades.
    geckoterminalNetwork: "robinhood",
    dyorSlug: "robinhood",
    dexscreenerSlug: env("VITE_DS_NETWORK_ROBINHOOD") ?? "robinhood",
    accent: "oklch(0.87 0.19 128)", // Robinhood lime/green
    tagline: "Arbitrum Orbit L2 · tokenized-stock rails · ~100ms blocks",
  },
  stable: {
    key: "stable",
    id: 988,
    name: "Stable",
    shortName: "USDT0",
    badge: "S",
    network: "mainnet",
    live: true,
    rpcUrls: [env("VITE_RPC_STABLE") ?? "https://rpc.stable.xyz"],
    // Primary explorer is Etherscan-powered (StableScan). For the token/stat
    // feeds we use the Blockscout instance, which exposes a free /api/v2.
    explorerUrl: "https://stablescan.xyz",
    explorer: {
      kind: "blockscout",
      apiBase: env("VITE_EXPLORER_API_STABLE") ?? "https://blockscout.stable.xyz/api/v2",
    },
    nativeCurrency: { name: "Tether USD", symbol: "USDT0", decimals: 18 },
    gasToken: "USDT0",
    // USDT0 as an ERC-20 (6 decimals) — verified on-chain (symbol/decimals) and
    // published by Stable. Shares the same underlying balance as the native gas.
    stablecoin: {
      symbol: "USDT0",
      address: (env("VITE_USDT0_STABLE") ??
        "0x779Ded0c9e1022225f8E0630b35a9b54bE713736") as `0x${string}`,
      decimals: 6,
    },
    // Stable's canonical wrapped-native predeploy reverts on every call, so we do
    // NOT use it. Route swaps through the USDT0 ERC-20 instead (mode "erc20").
    wrappedNative: env("VITE_WNATIVE_STABLE") as `0x${string}` | undefined,
    intermediary: {
      address: (env("VITE_INTERMEDIARY_STABLE") ??
        "0x779Ded0c9e1022225f8E0630b35a9b54bE713736") as `0x${string}`,
      decimals: 6,
      mode: "erc20",
      symbol: "USDT0",
    },
    // Uniswap V3 on Stable — SwapRouter02 + QuoterV2 from the official Stable docs
    // (docs.stable.xyz/en/reference/dexes). Router verified via router.factory()
    // == the documented v3 factory. Overridable per env.
    router: routerFromEnv("STABLE") ?? {
      kind: "uniswapV3",
      address: "0x32eaf9B5d5F2CD7361c5012890C943D7de84C22a",
      quoter: "0xb070179E7032CdA868b53e6C1742F80c9e940d1A",
      feeTier: 3000,
    },
    // GeckoTerminal DEX index. "stable" follows the same lowercase-name slug that
    // works for Robinhood; if Stable is indexed there, the table fills with live
    // pool data. Harmless empty otherwise. Override via env if the slug differs.
    geckoterminalNetwork: env("VITE_GT_NETWORK_STABLE") ?? "stable",
    dyorSlug: "stable",
    dexscreenerSlug: env("VITE_DS_NETWORK_STABLE") ?? "stable",
    accent: "oklch(0.80 0.16 155)", // Tether teal-green
    tagline: "Tether L1 · USDT-native gas · sub-second finality",
  },
  arc: {
    key: "arc",
    id: 5042002,
    name: "Arc",
    shortName: "ARC",
    badge: "A",
    network: "testnet",
    live: false,
    rpcUrls: [env("VITE_RPC_ARC") ?? "https://rpc.testnet.arc.network"],
    explorerUrl: "https://testnet.arcscan.app",
    explorer: {
      kind: "blockscout",
      apiBase: env("VITE_EXPLORER_API_ARC") ?? "https://testnet.arcscan.app/api/v2",
    },
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
    gasToken: "USDC",
    stablecoin: { symbol: "USDC", decimals: 6 },
    wrappedNative: env("VITE_WNATIVE_ARC") as `0x${string}` | undefined,
    // Uniswap V3 on Arc (from the Uniswap SDK). Swaps enable once the wrapped
    // native (wrapped USDC) is set via VITE_WNATIVE_ARC.
    router: routerFromEnv("ARC") ?? {
      kind: "uniswapV3",
      address: "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77",
      quoter: "0x7dfd4f31be6814d2906bde155c3e1b146eac1468",
      feeTier: 3000,
    },
    dyorSlug: "arc",
    dexscreenerSlug: env("VITE_DS_NETWORK_ARC"),
    accent: "oklch(0.72 0.16 250)", // Circle blue
    tagline: "Circle L1 · USDC-native gas · testnet",
  },
};

export const CHAIN_ORDER: ChainKey[] = ["stable", "robinhood", "arc"];
export const DEFAULT_CHAIN: ChainKey = "stable";

export function getChain(key: ChainKey): ChainConfig {
  return CHAINS[key];
}

/**
 * The token a swap routes through on a chain. Prefers an explicit `intermediary`
 * (e.g. USDT0 on Stable); otherwise derives one from the wrapped-native, funded
 * by sending native value (classic WETH path).
 */
export function getIntermediary(cfg: ChainConfig): Intermediary | undefined {
  if (cfg.intermediary) return cfg.intermediary;
  if (cfg.wrappedNative)
    return {
      address: cfg.wrappedNative,
      decimals: cfg.nativeCurrency.decimals,
      mode: "native",
      symbol: cfg.nativeCurrency.symbol,
    };
  return undefined;
}

export function isChainKey(v: string | null | undefined): v is ChainKey {
  return v === "robinhood" || v === "stable" || v === "arc";
}
