import { encodeFunctionData, parseUnits, formatUnits, type WalletClient } from "viem";
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
    // SwapRouter02 dropped `deadline` from the swap structs and exposes it here
    // instead. Without it a swap has NO expiry: a transaction stuck in the
    // mempool can be mined minutes later, at a price nobody agreed to, and the
    // only protection left is amountOutMinimum from a quote that is by then
    // stale. Every V3 swap goes through this.
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [
      { name: "deadline", type: "uint256" },
      { name: "data", type: "bytes[]" },
    ],
    outputs: [{ name: "", type: "bytes[]" }],
  },
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
  /** When this quote was produced. Execution refuses a stale one. */
  quotedAt?: number;
}

/**
 * How old a quote may be at execution time.
 *
 * minOut is computed from the quote, so an old quote means the slippage floor
 * describes a price that no longer exists. Two minutes is long enough to read
 * the panel and confirm in a wallet, short enough that the floor still means
 * something.
 */
export const QUOTE_MAX_AGE_MS = 120_000;

/** Slippage is clamped: 5% is generous for a launchpad, and 100% is a giveaway. */
const MAX_SLIPPAGE_BPS = 500;

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
  for (const extra of cfg.extraRoutingBases ?? []) add(extra);
  return [[from, to], ...bases.map((b) => [from, b, to])];
}

/** Label a routing address with the symbol the chain config knows it by. */
function shortSym(cfg: ChainConfig, addr: `0x${string}`): string {
  if (sameAddr(addr, cfg.intermediary?.address)) return cfg.intermediary!.symbol;
  if (cfg.extraRoutingBases?.some((b) => sameAddr(b, addr))) return `${addr.slice(0, 6)}…`;
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
    // Clamped, so a bad slippage value can never collapse minOut toward zero and
    // hand the whole trade to a sandwich.
    const slip = Math.min(Math.max(slippageBps, 0), MAX_SLIPPAGE_BPS);
    const minOut = amountOut * (1 - slip / 10_000);
    return {
      ok: true,
      amountOut,
      minOut,
      feeAmount,
      routerReady: true,
      feeTier: best?.fees[best.fees.length - 1],
      route: best,
      routeLabel: best?.tokens.map((t) => shortSym(cfg, t)).join(" → "),
      quotedAt: Date.now(),
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
  /** When the quote was produced — a stale one is refused. */
  quotedAt?: number;
}): Promise<SwapExecution> {
  const { chainKey, walletClient, account, side, amountIn, token, tokenDecimals, minOut } = params;
  const cfg = CHAINS[chainKey];
  if (!swapEnabled(cfg)) throw new Error(`Swaps are not enabled on ${cfg.name} yet.`);

  // A stale quote means minOut protects a price that no longer exists.
  if (params.quotedAt != null && Date.now() - params.quotedAt > QUOTE_MAX_AGE_MS) {
    throw new Error("This quote has expired. Check the amount and try again.");
  }

  // The wallet must be on the chain we're building for. viem checks this too,
  // but only against the client's own configured chain — if the user switched
  // networks between pressing the button and signing, that check passes while
  // the transaction lands somewhere else entirely.
  const connected = await walletClient.getChainId().catch(() => 0);
  if (connected !== cfg.id) {
    throw new Error(`Your wallet is on the wrong network. Switch to ${cfg.name} and try again.`);
  }

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
   * Approve exactly what the swap needs, resetting first when a stale non-zero
   * allowance is in the way.
   *
   * USDT-lineage tokens revert on approve() when the current allowance is
   * non-zero — a deliberate anti-front-running measure in Tether's contract.
   * Stable's gas asset IS a Tether token (USDT0), so a user with any leftover
   * allowance smaller than the new amount hit a swap that reverted on the
   * approval and never reached the router. Zeroing first is the standard
   * workaround and costs an extra signature only in that exact case.
   *
   * The approval is for the exact amount, never unlimited: a router that is
   * later compromised can only take what this trade needed.
   */
  const approveExact = async (
    erc20: `0x${string}`,
    spender: `0x${string}`,
    needed: bigint,
  ): Promise<`0x${string}` | undefined> => {
    const allowance = await getErc20Allowance(chainKey, erc20, account, spender);
    if (allowance >= needed) return undefined;
    if (allowance > 0n) {
      await walletClient.writeContract({
        account,
        chain,
        address: erc20,
        abi: ERC20_TX_ABI,
        functionName: "approve",
        args: [spender, 0n],
      });
    }
    return walletClient.writeContract({
      account,
      chain,
      address: erc20,
      abi: ERC20_TX_ABI,
      functionName: "approve",
      args: [spender, needed],
    });
  };

  /**
   * One V3 swap call, wrapped in SwapRouter02's `multicall(deadline, data)`.
   *
   * The deadline is the whole point of the wrapper. SwapRouter02's swap structs
   * carry no expiry of their own, so a bare exactInput can sit in the mempool
   * and be mined at a price nobody agreed to — with only a by-then-stale
   * amountOutMinimum standing between the user and a bad fill.
   */
  const encodeSwap = (amountInWei: bigint, minOutWei: bigint) =>
    v3Path
      ? encodeFunctionData({
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
        })
      : encodeFunctionData({
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
        });

  const v3Args = (amountInWei: bigint, minOutWei: bigint) =>
    ({
      account,
      chain,
      address: router,
      abi: V3_ROUTER_ABI,
      functionName: "multicall" as const,
      args: [deadline, [encodeSwap(amountInWei, minOutWei)]] as const,
    }) as const;

  const swapV3 = (amountInWei: bigint, minOutWei: bigint, value?: bigint) =>
    walletClient.writeContract({ ...v3Args(amountInWei, minOutWei), value });

  /**
   * Prove the swap works before taking a fee for it.
   *
   * The fee is a separate transaction that must go first — the router pulls the
   * remainder, so the balance has to be split beforehand. That ordering means a
   * swap which was always going to revert would still cost the user 1%. A
   * simulation costs nothing and closes that: if the swap can't succeed, nobody
   * pays anything.
   *
   * A simulation that fails for an unrelated reason (the fee hasn't moved yet,
   * so allowances and balances differ) must not block a good trade, so only a
   * definite revert of the swap logic stops us.
   */
  const client = getPublicClient(chainKey);
  const assertSwapViable = async (amountInWei: bigint, minOutWei: bigint, value?: bigint) => {
    if (!isV3) return;
    try {
      await client.simulateContract({ ...v3Args(amountInWei, minOutWei), account, value });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // Balance and allowance shortfalls are expected here: the fee transfer and
      // the approval haven't happened yet at simulation time.
      if (/transfer amount exceeds|insufficient|allowance|STF|balance/i.test(msg)) return;
      throw new Error(
        `This swap would fail — no fee has been charged. ${msg.split("\n")[0] || "Try a different amount."}`,
      );
    }
  };

  if (side === "buy") {
    const feeWei = parseUnits(amountToString(feeAmount, inter.decimals), inter.decimals);
    const swapWei = parseUnits(amountToString(swapAmount, inter.decimals), inter.decimals);
    const minOutWei = parseUnits(amountToString(minOut, tokenDecimals), tokenDecimals);

    if (inter.mode === "erc20") {
      // Buy funded by the ERC-20 gas token (USDT0). Fee is an ERC-20 transfer,
      // and the router pulls the remainder via transferFrom — no native value.
      await assertSwapViable(swapWei, minOutWei);

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
      result.approveTxHash = await approveExact(interAddr, router, swapWei);

      // 3. Router swap along the quoted route (no native value).
      result.swapTxHash = await swapV3(swapWei, minOutWei);
    } else {
      // Native path: fee is a native transfer; the router wraps the value.
      await assertSwapViable(swapWei, minOutWei, swapWei);

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

    await assertSwapViable(swapWei, minOutWei);

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
    result.approveTxHash = await approveExact(token, router, swapWei);

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
