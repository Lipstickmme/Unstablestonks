// Direct JSON-RPC reads via viem. This is the one data source that works on
// EVERY EVM chain regardless of whether an indexer/aggregator has picked it up —
// so it's our floor for "real, live" numbers (block height, gas, balances, ERC-20
// metadata) even on brand-new networks that DexScreener/GeckoTerminal don't cover.

import {
  createPublicClient,
  defineChain,
  http,
  fallback,
  formatUnits,
  type Chain,
  type PublicClient,
} from "viem";
import { CHAINS, type ChainConfig, type ChainKey } from "@/config/chains";

const ERC20_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export function toViemChain(cfg: ChainConfig): Chain {
  return defineChain({
    id: cfg.id,
    name: cfg.name,
    nativeCurrency: cfg.nativeCurrency,
    rpcUrls: { default: { http: cfg.rpcUrls } },
    blockExplorers: { default: { name: cfg.name, url: cfg.explorerUrl } },
    testnet: cfg.network === "testnet",
  });
}

const clientCache = new Map<number, PublicClient>();

/**
 * Ask each chain's own RPC what its id is, and correct the registry when the
 * configured value is wrong.
 *
 * A hardcoded chain id is a liability on a network that just launched: get it
 * wrong and `wallet_addEthereumChain` registers a bogus network in the user's
 * wallet and every read fails. eth_chainId from the chain itself is
 * authoritative, costs one request, and makes the constant in chains.ts a hint
 * rather than a dependency. Runs once at startup; failures leave the config
 * value in place.
 */
export async function resolveChainIds(): Promise<void> {
  await Promise.all(
    (Object.keys(CHAINS) as ChainKey[]).map(async (key) => {
      const cfg = CHAINS[key];
      const url = cfg.rpcUrls[0];
      if (!url) return;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6_000);
        const res = await fetch(url, {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        }).finally(() => clearTimeout(timer));
        if (!res.ok) return;
        const body = (await res.json()) as { result?: string };
        const actual = body?.result ? parseInt(body.result, 16) : NaN;
        if (!isFinite(actual) || actual <= 0 || actual === cfg.id) return;
        // The cached client was keyed and built with the stale id — drop it.
        clientCache.delete(cfg.id);
        cfg.id = actual;
      } catch {
        /* unreachable RPC: keep the configured id */
      }
    }),
  );
}

export function getPublicClient(key: ChainKey): PublicClient {
  const cfg = CHAINS[key];
  const cached = clientCache.get(cfg.id);
  if (cached) return cached;
  const client = createPublicClient({
    chain: toViemChain(cfg),
    transport: fallback(cfg.rpcUrls.map((u) => http(u, { timeout: 12_000 }))),
    batch: { multicall: true },
  }) as PublicClient;
  clientCache.set(cfg.id, client);
  return client;
}

export interface RpcHealth {
  chainId: number;
  blockNumber: number;
  gasPriceGwei: number;
  ok: boolean;
}

export async function getRpcHealth(key: ChainKey): Promise<RpcHealth> {
  const client = getPublicClient(key);
  try {
    const [blockNumber, gasPrice] = await Promise.all([
      client.getBlockNumber(),
      client.getGasPrice().catch(() => 0n),
    ]);
    return {
      chainId: CHAINS[key].id,
      blockNumber: Number(blockNumber),
      gasPriceGwei: Number(formatUnits(gasPrice, 9)),
      ok: true,
    };
  } catch {
    return { chainId: CHAINS[key].id, blockNumber: 0, gasPriceGwei: 0, ok: false };
  }
}

export interface Erc20Meta {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: number;
}

export async function getErc20Meta(
  key: ChainKey,
  address: `0x${string}`,
): Promise<Erc20Meta | null> {
  const client = getPublicClient(key);
  try {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address, abi: ERC20_ABI, functionName: "name" }).catch(() => "Unknown"),
      client.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }).catch(() => "?"),
      client.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }).catch(() => 18),
      client.readContract({ address, abi: ERC20_ABI, functionName: "totalSupply" }).catch(() => 0n),
    ]);
    const dec = Number(decimals);
    return {
      address,
      name: String(name),
      symbol: String(symbol),
      decimals: dec,
      totalSupply: Number(formatUnits(totalSupply as bigint, dec)),
    };
  } catch {
    return null;
  }
}

export async function getErc20Balance(
  key: ChainKey,
  token: `0x${string}`,
  owner: `0x${string}`,
  decimals: number,
): Promise<number> {
  const client = getPublicClient(key);
  try {
    const bal = (await client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [owner],
    })) as bigint;
    return Number(formatUnits(bal, decimals));
  } catch {
    return 0;
  }
}

export async function getNativeBalance(key: ChainKey, owner: `0x${string}`): Promise<number> {
  const client = getPublicClient(key);
  try {
    const bal = await client.getBalance({ address: owner });
    return Number(formatUnits(bal, CHAINS[key].nativeCurrency.decimals));
  } catch {
    return 0;
  }
}

export async function getErc20Allowance(
  key: ChainKey,
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  const client = getPublicClient(key);
  try {
    return (await client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    })) as bigint;
  } catch {
    return 0n;
  }
}

export { ERC20_ABI };
