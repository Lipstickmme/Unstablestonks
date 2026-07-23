import { parseUnits, formatUnits, type WalletClient } from "viem";
import {
  CHAINS,
  FEE_RECIPIENT,
  PLATFORM_FEE_BPS,
  type ChainConfig,
  type ChainKey,
} from "@/config/chains";
import { getErc20Allowance, getPublicClient } from "./data/rpc";

// ─────────────────────────────────────────────────────────────────────────────
// Quick-swap engine with protocol fee collection.
//
// Every swap collects PLATFORM_FEE_BPS of the INPUT into FEE_RECIPIENT and routes
// the remainder through the chain's configured DEX router (Uniswap-V2 interface).
// The fee leg is a plain transfer, so treasury collection works on ANY chain; the
// DEX leg activates per chain once a router + wrapped-native are configured
// (via VITE_ROUTER_<CHAIN> / VITE_WNATIVE_<CHAIN>). We never hardcode an
// unverified router — routing funds through the wrong address would lose them.
// ─────────────────────────────────────────────────────────────────────────────

const V2_ROUTER_ABI = [
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "swapExactTokensForETHSupportingFeeOnTransferTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const ERC20_TX_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export type SwapSide = "buy" | "sell";

export interface SwapQuote {
  ok: boolean;
  reason?: string;
  /** Expected output tokens (human units). */
  amountOut: number;
  /** Minimum output after slippage. */
  minOut: number;
  feeAmount: number; // in input units
  routerReady: boolean;
}

export function swapEnabled(cfg: ChainConfig): boolean {
  return Boolean(cfg.router && cfg.wrappedNative);
}

export function feePreview(amountIn: number): number {
  return (amountIn * PLATFORM_FEE_BPS) / 10_000;
}

/** Quote a swap of `amountIn` (human units of the input asset). */
export async function quoteSwap(
  chainKey: ChainKey,
  side: SwapSide,
  amountIn: number,
  token: `0x${string}`,
  tokenDecimals: number,
  slippageBps: number,
): Promise<SwapQuote> {
  const cfg = CHAINS[chainKey];
  const feeAmount = feePreview(amountIn);
  if (!swapEnabled(cfg)) {
    return {
      ok: false,
      reason: `No DEX router configured for ${cfg.name} yet — set VITE_ROUTER_${cfg.key.toUpperCase()}.`,
      amountOut: 0,
      minOut: 0,
      feeAmount,
      routerReady: false,
    };
  }
  const wnative = cfg.wrappedNative as `0x${string}`;
  const router = cfg.router!.address;
  const nativeDecimals = cfg.nativeCurrency.decimals;
  const swapAmount = amountIn - feeAmount;

  const inDecimals = side === "buy" ? nativeDecimals : tokenDecimals;
  const path = side === "buy" ? [wnative, token] : [token, wnative];
  const outDecimals = side === "buy" ? tokenDecimals : nativeDecimals;

  try {
    const client = getPublicClient(chainKey);
    const amounts = (await client.readContract({
      address: router,
      abi: V2_ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [parseUnits(swapAmount.toString(), inDecimals), path],
    })) as bigint[];
    const outWei = amounts[amounts.length - 1];
    const amountOut = Number(formatUnits(outWei, outDecimals));
    const minOut = amountOut * (1 - slippageBps / 10_000);
    return { ok: true, amountOut, minOut, feeAmount, routerReady: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? `Quote failed: ${e.message}` : "Quote failed",
      amountOut: 0,
      minOut: 0,
      feeAmount,
      routerReady: true,
    };
  }
}

export interface SwapExecution {
  feeTxHash?: `0x${string}`;
  approveTxHash?: `0x${string}`;
  swapTxHash?: `0x${string}`;
}

/**
 * Execute the fee transfer + router swap. Returns tx hashes as each is sent.
 * Throws with a clear message when the router isn't ready or the user rejects.
 */
export async function executeSwap(params: {
  chainKey: ChainKey;
  walletClient: WalletClient;
  account: `0x${string}`;
  side: SwapSide;
  amountIn: number;
  token: `0x${string}`;
  tokenDecimals: number;
  minOut: number;
}): Promise<SwapExecution> {
  const { chainKey, walletClient, account, side, amountIn, token, tokenDecimals, minOut } = params;
  const cfg = CHAINS[chainKey];
  if (!swapEnabled(cfg)) throw new Error(`Swaps are not enabled on ${cfg.name} yet.`);

  const wnative = cfg.wrappedNative as `0x${string}`;
  const router = cfg.router!.address;
  const nativeDecimals = cfg.nativeCurrency.decimals;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const result: SwapExecution = {};

  const feeAmount = feePreview(amountIn);
  const swapAmount = amountIn - feeAmount;
  const chain = walletClient.chain;

  if (side === "buy") {
    const feeWei = parseUnits(feeAmount.toString(), nativeDecimals);
    const swapWei = parseUnits(swapAmount.toString(), nativeDecimals);
    const minOutWei = parseUnits(minOut.toFixed(tokenDecimals), tokenDecimals);

    // 1. Protocol fee → treasury (native transfer).
    result.feeTxHash = await walletClient.sendTransaction({
      account,
      chain,
      to: FEE_RECIPIENT,
      value: feeWei,
    });

    // 2. Router swap of the remainder.
    result.swapTxHash = await walletClient.writeContract({
      account,
      chain,
      address: router,
      abi: V2_ROUTER_ABI,
      functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
      args: [minOutWei, [wnative, token], account, deadline],
      value: swapWei,
    });
  } else {
    const feeWei = parseUnits(feeAmount.toString(), tokenDecimals);
    const swapWei = parseUnits(swapAmount.toString(), tokenDecimals);
    const minOutWei = parseUnits(minOut.toFixed(nativeDecimals), nativeDecimals);

    // 1. Protocol fee → treasury (ERC-20 transfer).
    result.feeTxHash = await walletClient.writeContract({
      account,
      chain,
      address: token,
      abi: ERC20_TX_ABI,
      functionName: "transfer",
      args: [FEE_RECIPIENT, feeWei],
    });

    // 2. Approve router for the swap remainder if needed.
    const allowance = await getErc20Allowance(chainKey, token, account, router);
    if (allowance < swapWei) {
      result.approveTxHash = await walletClient.writeContract({
        account,
        chain,
        address: token,
        abi: ERC20_TX_ABI,
        functionName: "approve",
        args: [router, swapWei],
      });
    }

    // 3. Router swap token → native.
    result.swapTxHash = await walletClient.writeContract({
      account,
      chain,
      address: router,
      abi: V2_ROUTER_ABI,
      functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
      args: [swapWei, minOutWei, [token, wnative], account, deadline],
    });
  }

  return result;
}

export { FEE_RECIPIENT, PLATFORM_FEE_BPS };
