import { CHAINS, CHAIN_ORDER, type ChainKey } from "./chains";

// ─────────────────────────────────────────────────────────────────────────────
// Chains the bridge can move funds between.
//
// This is deliberately a superset of the terminal's three chains. Nobody keeps
// their float on a chain that launched this year — they hold it on Ethereum,
// Base or Arbitrum and need a way in. The bridge previously only offered the
// three terminal chains, which meant the one route users actually wanted
// (Ethereum → Stable) didn't exist.
//
// Every pair is offered in both directions; which ones can actually settle is
// decided at runtime by probing the rails (see bridge.ts), never hardcoded.
// ─────────────────────────────────────────────────────────────────────────────

export interface BridgeChain {
  key: string;
  id: number;
  name: string;
  shortName: string;
  logoUrl?: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** Canonical USDC, which is what CCTP burns and mints. */
  usdc?: { address: `0x${string}`; decimals: number };
  /** Circle CCTP domain id, where the chain is one. */
  cctpDomain?: number;
  rpcUrls: string[];
  explorerUrl: string;
  /** True for the terminal's own chains — used to order and label the picker. */
  terminal: boolean;
}

/**
 * External chains users bridge FROM. Canonical USDC addresses and CCTP domain
 * ids per Circle's supported-domains table.
 */
const EXTERNAL: BridgeChain[] = [
  {
    key: "ethereum",
    id: 1,
    name: "Ethereum",
    shortName: "ETH",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    cctpDomain: 0,
    rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
    explorerUrl: "https://etherscan.io",
    terminal: false,
  },
  {
    key: "base",
    id: 8453,
    name: "Base",
    shortName: "BASE",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    cctpDomain: 6,
    rpcUrls: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
    explorerUrl: "https://basescan.org",
    terminal: false,
  },
  {
    key: "arbitrum",
    id: 42161,
    name: "Arbitrum",
    shortName: "ARB",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    cctpDomain: 3,
    rpcUrls: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
    explorerUrl: "https://arbiscan.io",
    terminal: false,
  },
];

/** A terminal chain, expressed in the bridge's vocabulary. */
function fromTerminal(key: ChainKey): BridgeChain {
  const c = CHAINS[key];
  // On Stable and Arc the gas asset is itself a stablecoin exposed as an ERC-20;
  // that ERC-20 is the USDC-equivalent leg a bridge settles into.
  const stable = c.stablecoin?.address
    ? { address: c.stablecoin.address, decimals: c.stablecoin.decimals }
    : undefined;
  return {
    key,
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    logoUrl: c.logoUrl,
    nativeCurrency: c.nativeCurrency,
    usdc: c.stablecoin?.symbol?.toUpperCase() === "USDC" ? stable : undefined,
    cctpDomain: c.cctpDomain,
    rpcUrls: c.rpcUrls,
    explorerUrl: c.explorerUrl,
    terminal: true,
  };
}

/** Terminal chains first, then the majors people bridge in from. */
export const BRIDGE_CHAINS: BridgeChain[] = [...CHAIN_ORDER.map(fromTerminal), ...EXTERNAL];

export function bridgeChain(key: string): BridgeChain | undefined {
  return BRIDGE_CHAINS.find((c) => c.key === key);
}

/** Everything except `key` — the valid counterparties for a transfer. */
export function bridgeCounterparts(key: string): BridgeChain[] {
  return BRIDGE_CHAINS.filter((c) => c.key !== key);
}
