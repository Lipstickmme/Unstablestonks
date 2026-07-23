// Live on-chain data from Robinhood Chain (4663) via the public Blockscout
// indexer + JSON-RPC endpoint. No API keys required.
//
// Anything derivable from Blockscout is real (token registry, market cap,
// holder counts, 24h volume, transfers, holders). Fields that require a
// PONS-specific factory (launch time, graduation curve, fee split, CTO)
// or off-chain intelligence (social heat, X mentions) return `null` so
// the UI can render a "coming soon" state instead of fabricating values.

export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
export const EXPLORER = BLOCKSCOUT;
export const CHAIN_ID = 4663;

export interface OnchainToken {
  address: string;
  name: string;
  symbol: string;
  iconUrl: string | null;
  decimals: number;
  price: number; // USD, from exchange_rate
  mcap: number; // circulating_market_cap
  vol24h: number;
  holders: number;
  totalSupply: number;
}

export interface OnchainTransfer {
  id: string;
  tokenAddress: string;
  symbol: string;
  from: string;
  to: string;
  amount: number;
  amountUsd: number | null;
  timestampMs: number;
  txHash: string;
  poolTagged: boolean; // touches a Uniswap V3 pool = swap-like
}

export interface OnchainHolder {
  address: string;
  isContract: boolean;
  contractName: string | null;
  value: number;
  pct: number;
}

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}

function num(v: string | null | undefined, dec = 0): number {
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return dec ? n / 10 ** dec : n;
}

export async function fetchTokens(): Promise<OnchainToken[]> {
  const data = await j<{ items: any[] }>(
    `${BLOCKSCOUT}/api/v2/tokens?type=ERC-20`,
  );
  return data.items
    .map((t) => {
      const decimals = Number(t.decimals ?? 18);
      return {
        address: t.address_hash,
        name: t.name ?? "Unknown",
        symbol: t.symbol ?? "—",
        iconUrl: t.icon_url ?? null,
        decimals,
        price: Number(t.exchange_rate ?? 0) || 0,
        mcap: Number(t.circulating_market_cap ?? 0) || 0,
        vol24h: Number(t.volume_24h ?? 0) || 0,
        holders: Number(t.holders_count ?? 0) || 0,
        totalSupply: num(t.total_supply, decimals),
      } satisfies OnchainToken;
    })
    .filter((t) => t.symbol && t.address);
}

export async function fetchToken(address: string): Promise<OnchainToken | null> {
  try {
    const t = await j<any>(`${BLOCKSCOUT}/api/v2/tokens/${address}`);
    const decimals = Number(t.decimals ?? 18);
    return {
      address: t.address_hash,
      name: t.name ?? "Unknown",
      symbol: t.symbol ?? "—",
      iconUrl: t.icon_url ?? null,
      decimals,
      price: Number(t.exchange_rate ?? 0) || 0,
      mcap: Number(t.circulating_market_cap ?? 0) || 0,
      vol24h: Number(t.volume_24h ?? 0) || 0,
      holders: Number(t.holders_count ?? 0) || 0,
      totalSupply: num(t.total_supply, decimals),
    };
  } catch {
    return null;
  }
}

export async function fetchGlobalTransfers(): Promise<OnchainTransfer[]> {
  const data = await j<{ items: any[] }>(
    `${BLOCKSCOUT}/api/v2/token-transfers?type=ERC-20`,
  );
  return data.items.slice(0, 60).map(mapTransfer);
}

export async function fetchTokenTransfers(
  address: string,
): Promise<OnchainTransfer[]> {
  const data = await j<{ items: any[] }>(
    `${BLOCKSCOUT}/api/v2/tokens/${address}/transfers`,
  );
  return data.items.slice(0, 60).map(mapTransfer);
}

function mapTransfer(x: any): OnchainTransfer {
  const decimals = Number(x.token?.decimals ?? 18);
  const amount = num(x.total?.value, decimals);
  const price = Number(x.token?.exchange_rate ?? 0) || 0;
  const poolTagged =
    x.to?.name === "UniswapV3Pool" || x.from?.name === "UniswapV3Pool";
  return {
    id: `${x.transaction_hash}-${x.log_index}`,
    tokenAddress: x.token?.address_hash ?? "",
    symbol: x.token?.symbol ?? "—",
    from: x.from?.hash ?? "",
    to: x.to?.hash ?? "",
    amount,
    amountUsd: price ? amount * price : null,
    timestampMs: x.timestamp ? new Date(x.timestamp).getTime() : Date.now(),
    txHash: x.transaction_hash,
    poolTagged,
  };
}

export async function fetchHolders(address: string): Promise<OnchainHolder[]> {
  try {
    const data = await j<{ items: any[] }>(
      `${BLOCKSCOUT}/api/v2/tokens/${address}/holders`,
    );
    const rows = data.items.slice(0, 10);
    const total = rows.reduce((s, r) => s + Number(r.value ?? 0), 0);
    return rows.map((r) => {
      const v = Number(r.value ?? 0);
      return {
        address: r.address?.hash ?? "",
        isContract: !!r.address?.is_contract,
        contractName: r.address?.name ?? null,
        value: v,
        pct: total ? (v / total) * 100 : 0,
      };
    });
  } catch {
    return [];
  }
}

export interface ChainStats {
  blockNumber: number;
  totalTransactions: number;
  transactionsToday: number;
  gasPriceGwei: number;
}

export async function fetchChainStats(): Promise<ChainStats | null> {
  try {
    const s = await j<any>(`${BLOCKSCOUT}/api/v2/stats`);
    return {
      blockNumber: Number(s.total_blocks ?? 0),
      totalTransactions: Number(s.total_transactions ?? 0),
      transactionsToday: Number(s.transactions_today ?? 0),
      gasPriceGwei: Number(s.gas_prices?.average ?? 0),
    };
  } catch {
    return null;
  }
}

export function shortAddr(a: string) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatUSD(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  if (n > 0) return `$${n.toFixed(6)}`;
  return "$0";
}

export function formatNum(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

export function formatAgo(ms: number) {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
