// Compatibility shim. The terminal no longer generates simulated feeds — all data
// is pulled live from RPC + block explorers + DEX aggregators (see src/lib/data/*).
// This module now just re-exports the shared types and formatters so existing
// imports (`@/lib/mock-data`) keep resolving.

export type { TokenRow, TradeEvent, Social, TokenStatus, ChainStats } from "./types";
export { shortAddr, formatUSD, formatNum, formatAge, formatCompactToken } from "./format";
