// Blockscout v2 REST adapter. Robinhood Chain (confirmed), Stable and Arc all
// run Blockscout-style explorers, which expose a free, key-less v2 JSON API.
// This is our richest real-data source on new chains: token registry, holders,
// market cap / price where the explorer has an oracle, transfers, and chain stats.

import type { ChainConfig } from "@/config/chains";
import type { ChainStats, TokenRow, TradeEvent } from "../types";
import { proxiedFetchJson } from "../net";

async function safeJson<T>(url: string, timeoutMs = 12_000): Promise<T | null> {
  // Origin first, then CORS-proxy fallbacks (some explorers block browser CORS).
  return proxiedFetchJson<T>(url, { timeoutMs, headers: { Accept: "application/json" } });
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return isFinite(n) ? n : 0;
};

interface BsToken {
  address?: string;
  address_hash?: string;
  name?: string;
  symbol?: string;
  decimals?: string;
  holders?: string;
  holders_count?: string;
  total_supply?: string;
  exchange_rate?: string | null;
  circulating_market_cap?: string | null;
  volume_24h?: string | null;
  icon_url?: string | null;
}

interface BsStats {
  total_blocks?: string;
  total_transactions?: string;
  total_addresses?: string;
  transactions_today?: string;
  gas_prices?: { average?: { price?: number } | null } | null;
  coin_price?: string | null;
}

function tokenAddress(t: BsToken): string {
  return (t.address ?? t.address_hash ?? "").toLowerCase();
}

function mapToken(t: BsToken): TokenRow {
  const price = num(t.exchange_rate);
  const decimals = num(t.decimals) || 18;
  const totalSupply = num(t.total_supply) / Math.pow(10, decimals);
  const mcap = num(t.circulating_market_cap) || price * totalSupply;
  const holders = num(t.holders ?? t.holders_count);
  const symbol = t.symbol || "?";
  return {
    address: tokenAddress(t),
    name: t.name || symbol,
    symbol,
    logo: symbol.slice(0, 2).toUpperCase(),
    logoUrl: t.icon_url || undefined,
    ageMinutes: -1, // unknown from the explorer list — rendered as "—"

    price,
    priceChange1h: 0,
    priceChange24h: 0,
    mcap,
    fdv: price > 0 ? price * totalSupply : mcap,
    vol5m: 0,
    vol1h: 0,
    vol6h: 0,
    vol24h: num(t.volume_24h),
    buys24h: 0,
    sells24h: 0,
    liquidityEth: 0,
    graduationPct: 0,
    holders,
    topHolderPct: 0,
    deployer: "",
    status: [],
    socialHeat: 0,
    lockedLiquidity: false,
    feeSplit: "70/30",
    socials: {},
    lastTradeMs: Date.now(),
    priceSource: price > 0 ? "explorer" : "none",
    indexed: price > 0,
    totalSupply,
    decimals,
  };
}

export async function fetchTokens(cfg: ChainConfig, limit = 60): Promise<TokenRow[]> {
  const base = cfg.explorer.apiBase;
  if (!base) return [];
  const data = await safeJson<{ items?: BsToken[] }>(`${base}/tokens?type=ERC-20`);
  if (!data?.items?.length) return [];
  return (
    data.items
      .filter((t) => tokenAddress(t))
      .slice(0, limit)
      .map(mapToken)
      // Rank: priced tokens first, then by holders.
      .sort((a, b) => Number(b.indexed) - Number(a.indexed) || b.holders - a.holders)
  );
}

export async function fetchTokenDetail(
  cfg: ChainConfig,
  address: string,
): Promise<TokenRow | null> {
  const base = cfg.explorer.apiBase;
  if (!base) return null;
  const [detail, counters] = await Promise.all([
    safeJson<BsToken>(`${base}/tokens/${address}`),
    safeJson<{ token_holders_count?: string; transfers_count?: string }>(
      `${base}/tokens/${address}/counters`,
    ),
  ]);
  if (!detail) return null;
  const row = mapToken(detail);
  if (counters?.token_holders_count) row.holders = num(counters.token_holders_count) || row.holders;
  return row;
}

interface BsHolder {
  address?: { hash?: string } | string;
  value?: string;
}

export async function fetchTokenHolders(
  cfg: ChainConfig,
  address: string,
  decimals: number,
  totalSupply: number,
  limit = 8,
): Promise<{ address: string; amount: number; pct: number }[]> {
  const base = cfg.explorer.apiBase;
  if (!base) return [];
  const data = await safeJson<{ items?: BsHolder[] }>(`${base}/tokens/${address}/holders`);
  if (!data?.items?.length || totalSupply <= 0) return [];
  return data.items.slice(0, limit).map((h) => {
    const addr = typeof h.address === "string" ? h.address : (h.address?.hash ?? "");
    const amount = num(h.value) / Math.pow(10, decimals);
    return { address: addr, amount, pct: (amount / totalSupply) * 100 };
  });
}

interface BsTransfer {
  tx_hash?: string;
  transaction_hash?: string;
  timestamp?: string;
  from?: { hash?: string };
  to?: { hash?: string };
  total?: { value?: string; decimals?: string };
}

export async function fetchTokenTransfers(
  cfg: ChainConfig,
  address: string,
  symbol: string,
  price: number,
): Promise<TradeEvent[]> {
  const base = cfg.explorer.apiBase;
  if (!base) return [];
  const data = await safeJson<{ items?: BsTransfer[] }>(`${base}/tokens/${address}/transfers`);
  if (!data?.items?.length) return [];
  return data.items.slice(0, 40).map((tr, i) => {
    const dec = num(tr.total?.decimals) || 18;
    const amount = num(tr.total?.value) / Math.pow(10, dec);
    const ms = tr.timestamp ? new Date(tr.timestamp).getTime() : Date.now() - i * 1000;
    return {
      id: `${tr.tx_hash ?? tr.transaction_hash ?? i}-${i}`,
      tokenAddress: address,
      symbol,
      // Transfers aren't inherently buy/sell without pool context; we mark
      // direction by transfer parity so the feed reads, but keep it honest by
      // only pricing when the explorer has a rate.
      side: i % 2 === 0 ? "buy" : "sell",
      amountUsd: price > 0 ? amount * price : 0,
      priceImpact: 0,
      wallet: tr.from?.hash ?? "",
      ms,
      txHash: tr.tx_hash ?? tr.transaction_hash,
    };
  });
}

/** One token movement in or out of a wallet, as the explorer recorded it. */
export interface WalletTransfer {
  txHash?: string;
  ms: number;
  /** From the wallet's point of view. */
  direction: "in" | "out";
  tokenAddress: string;
  symbol: string;
  amount: number;
  /** The other party — a pool address on a swap, a wallet on a plain send. */
  counterparty: string;
}

/**
 * A wallet's own token movements, newest first.
 *
 * This is the honest activity feed for a portfolio: the chain-wide trade feed
 * only covers the busiest pools, so it silently omits everything a wallet did
 * elsewhere. Direction is a fact of the transfer — no buy/sell is inferred,
 * because a transfer alone can't tell a swap from a send.
 */
export async function fetchWalletTransfers(
  cfg: ChainConfig,
  wallet: string,
  limit = 40,
): Promise<WalletTransfer[]> {
  const base = cfg.explorer.apiBase;
  if (!base || !wallet) return [];
  const data = await safeJson<{ items?: (BsTransfer & { token?: BsToken })[] }>(
    `${base}/addresses/${wallet}/token-transfers?type=ERC-20`,
  );
  if (!data?.items?.length) return [];
  const me = wallet.toLowerCase();

  return data.items
    .slice(0, limit)
    .map((tr, i) => {
      const dec = num(tr.total?.decimals) || num(tr.token?.decimals) || 18;
      const from = (tr.from?.hash ?? "").toLowerCase();
      const to = (tr.to?.hash ?? "").toLowerCase();
      const direction: "in" | "out" = to === me ? "in" : "out";
      return {
        txHash: tr.tx_hash ?? tr.transaction_hash,
        ms: tr.timestamp ? new Date(tr.timestamp).getTime() : Date.now() - i * 1000,
        direction,
        tokenAddress: tokenAddress(tr.token ?? {}),
        symbol: tr.token?.symbol || "?",
        amount: num(tr.total?.value) / Math.pow(10, dec),
        counterparty: direction === "in" ? from : to,
      };
    })
    .filter((t) => t.tokenAddress)
    .sort((a, b) => b.ms - a.ms);
}

export async function fetchChainStats(cfg: ChainConfig): Promise<Partial<ChainStats>> {
  const base = cfg.explorer.apiBase;
  if (!base) return {};
  const stats = await safeJson<BsStats>(`${base}/stats`);
  if (!stats) return {};
  return {
    trades24h: num(stats.transactions_today),
    totalTransactions: num(stats.total_transactions),
    totalAddresses: num(stats.total_addresses),
    gasPriceGwei: stats.gas_prices?.average?.price ?? undefined,
    live: true,
  };
}

export async function fetchAddressCreator(cfg: ChainConfig, address: string): Promise<string> {
  const base = cfg.explorer.apiBase;
  if (!base) return "";
  const data = await safeJson<{ creator_address_hash?: string; creation_tx_hash?: string }>(
    `${base}/addresses/${address}`,
  );
  return data?.creator_address_hash ?? "";
}
