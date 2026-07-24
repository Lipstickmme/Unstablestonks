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
// the remainder through the chain's DEX router (Uniswap V2 or V3 interface).
// The fee leg is a plain transfer, so treasury collection works on ANY chain.
// Verified router/wrapped-native addresses (Robinhood, Arc — from Uniswap's
// official SDK) ship as defaults; any chain can be overridden via
// VITE_ROUTER_<CHAIN> / VITE_WNATIVE_<CHAIN>. We never hardcode an UNVERIFIED
// router (e.g. Stable, pending its published address) — a wrong router loses funds.
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

// Uniswap V3 — QuoterV2 for quotes (simulated), SwapRouter02 for execution.
const QUOTER_V2_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const V3_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
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
  /** V3 fee tier the quote resolved to — reused for execution. */
  feeTier?: number;
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
  const routerCfg = cfg.router!;
  const router = routerCfg.address;
  const nativeDecimals = cfg.nativeCurrency.decimals;
  const swapAmount = amountIn - feeAmount;

  const inDecimals = side === "buy" ? nativeDecimals : tokenDecimals;
  const path = side === "buy" ? [wnative, token] : [token, wnative];
  const outDecimals = side === "buy" ? tokenDecimals : nativeDecimals;

  const amountInWei = parseUnits(swapAmount.toString(), inDecimals);

  try {
    const client = getPublicClient(chainKey);
    let outWei = 0n;
    let usedFeeTier: number | undefined;

    if (routerCfg.kind === "uniswapV3") {
      if (!routerCfg.quoter) {
        return {
          ok: false,
          reason: `V3 quoting needs a QuoterV2 — set VITE_QUOTER_${cfg.key.toUpperCase()}.`,
          amountOut: 0,
          minOut: 0,
          feeAmount,
          routerReady: false,
        };
      }
      // Probe the common fee tiers (configured one first) and keep the best pool.
      const preferred = routerCfg.feeTier ?? 3000;
      const tiers = [preferred, 10000, 3000, 500, 100].filter((t, i, a) => a.indexOf(t) === i);
      for (const fee of tiers) {
        try {
          const sim = await client.simulateContract({
            address: routerCfg.quoter,
            abi: QUOTER_V2_ABI,
            functionName: "quoteExactInputSingle",
            args: [
              {
                tokenIn: path[0],
                tokenOut: path[1],
                amountIn: amountInWei,
                fee,
                sqrtPriceLimitX96: 0n,
              },
            ],
          });
          const out = (sim.result as readonly [bigint, bigint, number, bigint])[0];
          if (out > outWei) {
            outWei = out;
            usedFeeTier = fee;
          }
        } catch {
          /* no pool at this tier — try the next */
        }
      }
      if (outWei === 0n) {
        return {
          ok: false,
          reason: "No V3 pool with liquidity found for this pair.",
          amountOut: 0,
          minOut: 0,
          feeAmount,
          routerReady: true,
        };
      }
    } else {
      const amounts = (await client.readContract({
        address: router,
        abi: V2_ROUTER_ABI,
        functionName: "getAmountsOut",
        args: [amountInWei, path],
      })) as bigint[];
      outWei = amounts[amounts.length - 1];
    }

    const amountOut = Number(formatUnits(outWei, outDecimals));
    const minOut = amountOut * (1 - slippageBps / 10_000);
    return { ok: true, amountOut, minOut, feeAmount, routerReady: true, feeTier: usedFeeTier };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? `Quote failed: ${e.message.split("\n")[0]}` : "Quote failed",
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
  /** Fee tier chosen by the quote (V3). Falls back to the router default. */
  feeTier?: number;
}): Promise<SwapExecution> {
  const { chainKey, walletClient, account, side, amountIn, token, tokenDecimals, minOut } = params;
  const cfg = CHAINS[chainKey];
  if (!swapEnabled(cfg)) throw new Error(`Swaps are not enabled on ${cfg.name} yet.`);

  const wnative = cfg.wrappedNative as `0x${string}`;
  const routerCfg = cfg.router!;
  const router = routerCfg.address;
  const isV3 = routerCfg.kind === "uniswapV3";
  const feeTier = params.feeTier ?? routerCfg.feeTier ?? 3000;
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

    // 2. Router swap of the remainder. V3 SwapRouter02 wraps native sent as value
    //    when tokenIn is the wrapped-native token.
    result.swapTxHash = isV3
      ? await walletClient.writeContract({
          account,
          chain,
          address: router,
          abi: V3_ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: wnative,
              tokenOut: token,
              fee: feeTier,
              recipient: account,
              amountIn: swapWei,
              amountOutMinimum: minOutWei,
              sqrtPriceLimitX96: 0n,
            },
          ],
          value: swapWei,
        })
      : await walletClient.writeContract({
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

    // 3. Router swap token → native. On V3 the output settles as the wrapped
    //    native ERC-20 (WETH-style) in the seller's wallet.
    result.swapTxHash = isV3
      ? await walletClient.writeContract({
          account,
          chain,
          address: router,
          abi: V3_ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: token,
              tokenOut: wnative,
              fee: feeTier,
              recipient: account,
              amountIn: swapWei,
              amountOutMinimum: minOutWei,
              sqrtPriceLimitX96: 0n,
            },
          ],
        })
      : await walletClient.writeContract({
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
