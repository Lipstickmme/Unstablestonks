import { parseUnits, formatUnits, type WalletClient } from "viem";
import {
  CHAINS,
  FEE_RECIPIENT,
  PLATFORM_FEE_BPS,
  getIntermediary,
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
// Verified router addresses (Robinhood, Arc — from Uniswap's SDK; Stable — from
// docs.stable.xyz, cross-checked via router.factory()) ship as defaults; any chain
// can be overridden via VITE_ROUTER_<CHAIN> / VITE_QUOTER_<CHAIN>.
//
// Swaps route through a chain's INTERMEDIARY token (see getIntermediary). Usually
// that's the wrapped-native, funded by sending native value. On chains whose gas
// token is itself an ERC-20 — Stable's USDT0, whose wrapped-native predeploy is a
// non-functional revert-stub — the intermediary is that ERC-20 (mode "erc20"):
// the buy is funded by an approve + transferFrom, not native value.
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
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96AfterList", type: "uint160[]" },
      { name: "initializedTicksCrossedList", type: "uint32[]" },
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
  {
    type: "function",
    name: "exactInput",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "path", type: "bytes" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export type SwapSide = "buy" | "sell";

/** The hop sequence a quote resolved to; execution replays it exactly. */
export interface SwapRoute {
  /** [tokenIn, …intermediate, tokenOut] — length is fees.length + 1. */
  tokens: `0x${string}`[];
  /** V3 fee tier per hop. Empty on V2 (fees are fixed by the pair). */
  fees: number[];
}

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
  /** Full resolved route, so the swap executes the pair that was quoted. */
  route?: SwapRoute;
  /** Human label, e.g. "USDT0 → WETH → TOKEN". */
  routeLabel?: string;
}

/**
 * Format a JS number for parseUnits. `Number.toString()` emits exponent notation
 * for small values ("1e-7"), which parseUnits rejects outright — that made every
 * sub-microtoken amount throw instead of quoting.
 */
function amountToString(v: number, decimals: number): string {
  if (!isFinite(v) || v <= 0) return "0";
  let s = v.toFixed(Math.min(Math.max(decimals, 0), 18));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s || "0";
}

const sameAddr = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/**
 * Hop sequences to try, direct first. A token rarely pairs against every routing
 * asset a chain has: on Stable a pool may be TOKEN/WUSDT0 while we fund from the
 * USDT0 ERC-20, and on Robinhood a pool may be TOKEN/USDT while we fund from
 * WETH. Quoting only the direct pair is what made those swaps report "no pool".
 */
function candidateRoutes(
  cfg: ChainConfig,
  from: `0x${string}`,
  to: `0x${string}`,
): `0x${string}`[][] {
  const bases: `0x${string}`[] = [];
  const add = (a?: `0x${string}`) => {
    if (!a || sameAddr(a, from) || sameAddr(a, to)) return;
    if (bases.some((b) => sameAddr(b, a))) return;
    bases.push(a);
  };
  add(cfg.wrappedNative);
  add(cfg.stablecoin?.address);
  add(cfg.intermediary?.address);
  return [[from, to], ...bases.map((b) => [from, b, to])];
}

/** Label a routing address with the symbol the chain config knows it by. */
function shortSym(cfg: ChainConfig, addr: `0x${string}`): string {
  if (sameAddr(addr, cfg.intermediary?.address)) return cfg.intermediary!.symbol;
  if (sameAddr(addr, cfg.wrappedNative)) return `W${cfg.nativeCurrency.symbol}`;
  if (sameAddr(addr, cfg.stablecoin?.address)) return cfg.stablecoin!.symbol;
  return `${addr.slice(0, 6)}…`;
}

/** Uniswap V3 path encoding: token(20) fee(3) token(20) [fee(3) token(20)…]. */
function encodePath(tokens: `0x${string}`[], fees: number[]): `0x${string}` {
  let hex = tokens[0].slice(2).toLowerCase();
  for (let i = 0; i < fees.length; i++) {
    hex += fees[i].toString(16).padStart(6, "0");
    hex += tokens[i + 1].slice(2).toLowerCase();
  }
  return `0x${hex}`;
}

export function swapEnabled(cfg: ChainConfig): boolean {
  return Boolean(cfg.router && getIntermediary(cfg));
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
  const inter = getIntermediary(cfg)!;
  const interAddr = inter.address;
  const routerCfg = cfg.router!;
  const router = routerCfg.address;
  const swapAmount = amountIn - feeAmount;

  // The intermediary is the quote asset — its own decimals, not the native ones.
  const inDecimals = side === "buy" ? inter.decimals : tokenDecimals;
  const path = side === "buy" ? [interAddr, token] : [token, interAddr];
  const outDecimals = side === "buy" ? tokenDecimals : inter.decimals;

  const amountInWei = parseUnits(amountToString(swapAmount, inDecimals), inDecimals);
  if (amountInWei === 0n) {
    return {
      ok: false,
      reason: "Amount too small to route.",
      amountOut: 0,
      minOut: 0,
      feeAmount,
      routerReady: true,
    };
  }

  try {
    const client = getPublicClient(chainKey);
    const routes = candidateRoutes(cfg, path[0], path[1]);
    let outWei = 0n;
    let best: SwapRoute | undefined;

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
      const quoter = routerCfg.quoter;
      const preferred = routerCfg.feeTier ?? 3000;
      const tiers = [preferred, 10000, 3000, 500, 100].filter((t, i, a) => a.indexOf(t) === i);

      // Direct pair across every tier — the common case, and the cheapest.
      for (const fee of tiers) {
        try {
          const sim = await client.simulateContract({
            address: quoter,
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
            best = { tokens: [path[0], path[1]], fees: [fee] };
          }
        } catch {
          /* no pool at this tier — try the next */
        }
      }

      // Only if nothing trades directly: two-hop through the chain's base assets.
      // The base leg is a deep, conventional pair, so a reduced tier set covers it.
      if (outWei === 0n) {
        const baseTiers = [500, 3000, 10000];
        for (const hop of routes.slice(1)) {
          for (const f1 of baseTiers) {
            for (const f2 of tiers) {
              try {
                const encoded = encodePath(hop, [f1, f2]);
                const sim = await client.simulateContract({
                  address: quoter,
                  abi: QUOTER_V2_ABI,
                  functionName: "quoteExactInput",
                  args: [encoded, amountInWei],
                });
                const out = (sim.result as readonly [bigint, bigint[], number[], bigint])[0];
                if (out > outWei) {
                  outWei = out;
                  best = { tokens: hop, fees: [f1, f2] };
                }
              } catch {
                /* no route at this tier pair */
              }
            }
          }
        }
      }

      if (outWei === 0n) {
        return {
          ok: false,
          reason: `No V3 pool with liquidity for this pair on ${cfg.name} — direct or via ${
            routes.length > 1
              ? routes
                  .slice(1)
                  .map((r) => shortSym(cfg, r[1]))
                  .join("/")
              : "any base"
          }.`,
          amountOut: 0,
          minOut: 0,
          feeAmount,
          routerReady: true,
        };
      }
    } else {
      // V2: getAmountsOut takes the whole path, so each candidate is one call.
      for (const hop of routes) {
        try {
          const amounts = (await client.readContract({
            address: router,
            abi: V2_ROUTER_ABI,
            functionName: "getAmountsOut",
            args: [amountInWei, hop],
          })) as bigint[];
          const out = amounts[amounts.length - 1];
          if (out > outWei) {
            outWei = out;
            best = { tokens: hop, fees: [] };
          }
        } catch {
          /* no pair along this path */
        }
      }
      if (outWei === 0n) {
        return {
          ok: false,
          reason: `No liquidity path for this pair on ${cfg.name}.`,
          amountOut: 0,
          minOut: 0,
          feeAmount,
          routerReady: true,
        };
      }
    }

    const amountOut = Number(formatUnits(outWei, outDecimals));
    const minOut = amountOut * (1 - slippageBps / 10_000);
    return {
      ok: true,
      amountOut,
      minOut,
      feeAmount,
      routerReady: true,
      feeTier: best?.fees[best.fees.length - 1],
      route: best,
      routeLabel: best?.tokens.map((t) => shortSym(cfg, t)).join(" → "),
    };
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
  /** Route the quote resolved to. Falls back to the direct pair. */
  route?: SwapRoute;
}): Promise<SwapExecution> {
  const { chainKey, walletClient, account, side, amountIn, token, tokenDecimals, minOut } = params;
  const cfg = CHAINS[chainKey];
  if (!swapEnabled(cfg)) throw new Error(`Swaps are not enabled on ${cfg.name} yet.`);

  const inter = getIntermediary(cfg)!;
  const interAddr = inter.address;
  const routerCfg = cfg.router!;
  const router = routerCfg.address;
  const isV3 = routerCfg.kind === "uniswapV3";
  const feeTier = params.feeTier ?? routerCfg.feeTier ?? 3000;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const result: SwapExecution = {};

  // Replay exactly what was quoted. Without a route (a stale quote), fall back
  // to the direct pair so behaviour matches the pre-multi-hop engine.
  const direct: `0x${string}`[] = side === "buy" ? [interAddr, token] : [token, interAddr];
  const route: SwapRoute = params.route ?? { tokens: direct, fees: isV3 ? [feeTier] : [] };
  const multiHop = route.tokens.length > 2;
  const v3Path = isV3 && multiHop ? encodePath(route.tokens, route.fees) : undefined;

  // The V2 SupportingFeeOnTransfer helpers assume a native (ETH-style) leg. An
  // ERC-20 intermediary (e.g. USDT0 on Stable) is only wired for V3 here.
  if (inter.mode === "erc20" && !isV3) {
    throw new Error(`ERC-20-routed swaps on ${cfg.name} require a Uniswap V3 router.`);
  }

  const feeAmount = feePreview(amountIn);
  const swapAmount = amountIn - feeAmount;
  const chain = walletClient.chain;

  /**
   * One V3 swap call. A multi-hop route goes through `exactInput` with the
   * encoded path; a direct pair keeps the cheaper `exactInputSingle`.
   */
  const swapV3 = (amountInWei: bigint, minOutWei: bigint, value?: bigint) =>
    v3Path
      ? walletClient.writeContract({
          account,
          chain,
          address: router,
          abi: V3_ROUTER_ABI,
          functionName: "exactInput",
          args: [
            {
              path: v3Path,
              recipient: account,
              amountIn: amountInWei,
              amountOutMinimum: minOutWei,
            },
          ],
          value,
        })
      : walletClient.writeContract({
          account,
          chain,
          address: router,
          abi: V3_ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: route.tokens[0],
              tokenOut: route.tokens[route.tokens.length - 1],
              fee: route.fees[0] ?? feeTier,
              recipient: account,
              amountIn: amountInWei,
              amountOutMinimum: minOutWei,
              sqrtPriceLimitX96: 0n,
            },
          ],
          value,
        });

  if (side === "buy") {
    const feeWei = parseUnits(amountToString(feeAmount, inter.decimals), inter.decimals);
    const swapWei = parseUnits(amountToString(swapAmount, inter.decimals), inter.decimals);
    const minOutWei = parseUnits(amountToString(minOut, tokenDecimals), tokenDecimals);

    if (inter.mode === "erc20") {
      // Buy funded by the ERC-20 gas token (USDT0). Fee is an ERC-20 transfer,
      // and the router pulls the remainder via transferFrom — no native value.
      // 1. Protocol fee → treasury.
      result.feeTxHash = await walletClient.writeContract({
        account,
        chain,
        address: interAddr,
        abi: ERC20_TX_ABI,
        functionName: "transfer",
        args: [FEE_RECIPIENT, feeWei],
      });

      // 2. Approve the router for the swap remainder if needed.
      const allowance = await getErc20Allowance(chainKey, interAddr, account, router);
      if (allowance < swapWei) {
        result.approveTxHash = await walletClient.writeContract({
          account,
          chain,
          address: interAddr,
          abi: ERC20_TX_ABI,
          functionName: "approve",
          args: [router, swapWei],
        });
      }

      // 3. Router swap along the quoted route (no native value).
      result.swapTxHash = await swapV3(swapWei, minOutWei);
    } else {
      // Native path: fee is a native transfer; the router wraps the value.
      // 1. Protocol fee → treasury (native transfer).
      result.feeTxHash = await walletClient.sendTransaction({
        account,
        chain,
        to: FEE_RECIPIENT,
        value: feeWei,
      });

      // 2. Router swap of the remainder along the quoted route. V3 SwapRouter02
      //    wraps native sent as value when the path starts at wrapped-native.
      result.swapTxHash = isV3
        ? await swapV3(swapWei, minOutWei, swapWei)
        : await walletClient.writeContract({
            account,
            chain,
            address: router,
            abi: V2_ROUTER_ABI,
            functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
            args: [minOutWei, route.tokens, account, deadline],
            value: swapWei,
          });
    }
  } else {
    const feeWei = parseUnits(amountToString(feeAmount, tokenDecimals), tokenDecimals);
    const swapWei = parseUnits(amountToString(swapAmount, tokenDecimals), tokenDecimals);
    const minOutWei = parseUnits(amountToString(minOut, inter.decimals), inter.decimals);

    // 1. Protocol fee → treasury (ERC-20 transfer of the token being sold).
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

    // 3. Router swap token → intermediary. On V3 the output settles as the
    //    intermediary ERC-20 (USDT0, or wrapped-native) in the seller's wallet.
    result.swapTxHash = isV3
      ? await swapV3(swapWei, minOutWei)
      : await walletClient.writeContract({
          account,
          chain,
          address: router,
          abi: V2_ROUTER_ABI,
          functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
          args: [swapWei, minOutWei, route.tokens, account, deadline],
        });
  }

  return result;
}

export { FEE_RECIPIENT, PLATFORM_FEE_BPS };
