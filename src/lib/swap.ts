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
//
// HOW THE FEE REACHES THE TREASURY. Two shapes, picked by what the router can do:
//
//   Batched (preferred) — one transaction, via SwapRouter02's payments extension:
//       multicall(deadline, [ pull(fee), sweepToken(fee, TREASURY), swap ])
//     Atomic, so the fee cannot outlive a swap that reverted, and it costs one
//     signature instead of two. Requires multicall + pull + sweepToken, all of
//     which are probed on chain rather than assumed.
//
//   Separate — a plain ERC-20 (or native) transfer to TREASURY, then the swap.
//     The fallback for routers without that extension, and the only option for a
//     native-funded buy, since `pull` is ERC-20 only.
//
// The router/quoter addresses shipped as defaults came from Uniswap's SDK and
// each chain's docs and could NOT be verified against a live RPC. probeRouter
// checks them at runtime and swapDiagnostic names whatever is wrong, so a bad
// address reports itself instead of masquerading as missing liquidity. Override
// with VITE_ROUTER_<CHAIN> / VITE_QUOTER_<CHAIN>.
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

/**
 * The ORIGINAL Uniswap Quoter, whose quoteExactInputSingle takes flat arguments
 * instead of QuoterV2's struct. Tried when the V2 shape reverts: a deployment
 * that shipped the V1 quoter answered nothing at all under the V2 ABI, and the
 * UI reported that as "no pool with liquidity" — the one explanation that sends
 * you looking in completely the wrong place.
 */
const QUOTER_V1_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const V3_ROUTER_ABI = [
  {
    // SwapRouter02 dropped `deadline` from the swap structs and exposes it here
    // instead. Without it a swap has NO expiry: a transaction stuck in the
    // mempool can be mined minutes later, at a price nobody agreed to, and the
    // only protection left is amountOutMinimum from a quote that is by then
    // stale. Used when the router actually has it — see probeRouter. Wrapping
    // unconditionally broke every swap on a router without the extension.
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
  {
    // PeripheryPaymentsExtended: transferFrom the caller into the router, so a
    // later command in the same multicall can move it. This plus sweepToken is
    // what lets the protocol fee ride INSIDE the swap transaction instead of
    // being its own signature.
    type: "function",
    name: "pull",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
  {
    // PeripheryPayments: send the router's balance of a token to a recipient.
    // With `pull` above: pull(fee) → sweepToken(fee, treasury) → swap.
    type: "function",
    name: "sweepToken",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
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

// ─────────────────────────────────────────────────────────────────────────────
// Router capability probe.
//
// The router and quoter addresses in chains.ts are the best available answer for
// three networks that launched in the last few months, and "best available" is
// not "verified on chain". Three things can be true of any of them and each one
// fails in a way that used to be reported as "no liquidity", which sends you
// hunting for a pool when the real problem is an address or an ABI:
//
//   · nothing is deployed there at all;
//   · it's a Uniswap V3 deployment, but the ORIGINAL SwapRouter/Quoter rather
//     than SwapRouter02/QuoterV2 — different function signatures entirely;
//   · it's SwapRouter02 but without the multicall extension.
//
// So the code asks the chain instead of assuming. Probed once per chain, cached
// for the session, and every failure downstream can now name what's actually
// wrong.
// ─────────────────────────────────────────────────────────────────────────────

interface RouterProbe {
  routerDeployed: boolean;
  quoterDeployed: boolean;
  /** SwapRouter02's multicall(deadline, bytes[]) — needed for a deadline. */
  supportsMulticall: boolean;
  /**
   * SwapRouter02's payments extension (pull + sweepToken), which is what lets
   * the protocol fee travel INSIDE the swap transaction: pull the fee into the
   * router, sweep it to the treasury, swap — one signature instead of two.
   */
  supportsPayments: boolean;
  /** Set once a quoter shape is known to work, so we stop trying the other. */
  quoterKind?: "v2" | "v1";
}

const probes = new Map<ChainKey, RouterProbe>();

async function probeRouter(chainKey: ChainKey): Promise<RouterProbe> {
  const hit = probes.get(chainKey);
  if (hit) return hit;

  const cfg = CHAINS[chainKey];
  const client = getPublicClient(chainKey);
  const probe: RouterProbe = {
    routerDeployed: false,
    quoterDeployed: false,
    supportsMulticall: false,
    supportsPayments: false,
  };

  try {
    const [routerCode, quoterCode] = await Promise.all([
      cfg.router ? client.getCode({ address: cfg.router.address }) : Promise.resolve(undefined),
      cfg.router?.quoter
        ? client.getCode({ address: cfg.router.quoter })
        : Promise.resolve(undefined),
    ]);
    probe.routerDeployed = Boolean(routerCode && routerCode !== "0x");
    probe.quoterDeployed = Boolean(quoterCode && quoterCode !== "0x");

    // A multicall with an empty batch is a no-op on SwapRouter02 and an
    // unknown-selector revert on anything that lacks the extension. Cheap, and
    // it can't move funds either way.
    if (probe.routerDeployed && cfg.router?.kind === "uniswapV3") {
      try {
        await client.simulateContract({
          address: cfg.router.address,
          abi: V3_ROUTER_ABI,
          functionName: "multicall",
          args: [BigInt(Math.floor(Date.now() / 1000) + 600), []],
        });
        probe.supportsMulticall = true;
      } catch {
        probe.supportsMulticall = false;
      }

      // sweepToken with amountMinimum 0 is a no-op on SwapRouter02 (the
      // router's balance of anything is 0 ≥ 0, nothing moves) and an
      // unknown-selector revert on a router without the payments extension.
      // Probing with a call that CANNOT move funds is the point.
      if (probe.supportsMulticall) {
        const inter = getIntermediary(cfg);
        if (inter) {
          try {
            await client.simulateContract({
              address: cfg.router.address,
              abi: V3_ROUTER_ABI,
              functionName: "sweepToken",
              args: [inter.address, 0n, FEE_RECIPIENT],
            });
            probe.supportsPayments = true;
          } catch {
            probe.supportsPayments = false;
          }
        }
      }
    }
  } catch {
    /* RPC unreachable — leave everything false and let the caller report it */
  }

  probes.set(chainKey, probe);
  return probe;
}

/** Why swapping can't work on this chain right now, or null when it can. */
export async function swapDiagnostic(chainKey: ChainKey): Promise<string | null> {
  const cfg = CHAINS[chainKey];
  if (!cfg.router) {
    return `No DEX router is configured for ${cfg.name}. Set VITE_ROUTER_${cfg.key.toUpperCase()}.`;
  }
  if (!getIntermediary(cfg)) {
    return `No routing asset is configured for ${cfg.name}. Set VITE_WNATIVE_${cfg.key.toUpperCase()} or an intermediary.`;
  }
  const probe = await probeRouter(chainKey);
  if (!probe.routerDeployed) {
    return `Nothing is deployed at the configured router on ${cfg.name} (${cfg.router.address}). The address is wrong or the chain doesn't have this DEX — set VITE_ROUTER_${cfg.key.toUpperCase()}.`;
  }
  if (cfg.router.kind === "uniswapV3" && !probe.quoterDeployed) {
    return `Nothing is deployed at the configured quoter on ${cfg.name} (${cfg.router.quoter ?? "unset"}). Set VITE_QUOTER_${cfg.key.toUpperCase()}.`;
  }
  return null;
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

      const probe = await probeRouter(chainKey);

      /**
       * One single-hop quote, under whichever quoter ABI this chain actually
       * has. QuoterV2 takes a struct and returns four values; the original
       * Quoter takes flat arguments and returns one. The working shape is
       * remembered so the wrong one is tried at most once per session.
       */
      const quoteSingle = async (fee: number): Promise<bigint> => {
        const tryV2 = async () => {
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
          probe.quoterKind = "v2";
          return (sim.result as readonly [bigint, bigint, number, bigint])[0];
        };
        const tryV1 = async () => {
          const sim = await client.simulateContract({
            address: quoter,
            abi: QUOTER_V1_ABI,
            functionName: "quoteExactInputSingle",
            args: [path[0], path[1], fee, amountInWei, 0n],
          });
          probe.quoterKind = "v1";
          return sim.result as bigint;
        };

        if (probe.quoterKind === "v1") return tryV1().catch(() => 0n);
        if (probe.quoterKind === "v2") return tryV2().catch(() => 0n);
        // Shape unknown: V2 first (much the more common deployment), V1 second.
        return tryV2().catch(() => tryV1().catch(() => 0n));
      };

      // Direct pair across every tier — the common case, and the cheapest.
      for (const fee of tiers) {
        const out = await quoteSingle(fee);
        if (out > outWei) {
          outWei = out;
          best = { tokens: [path[0], path[1]], fees: [fee] };
        }
      }

      // Only if nothing trades directly: two-hop through the chain's base assets.
      // The base leg is a deep, conventional pair, so a reduced tier set covers it.
      if (outWei === 0n) {
        const baseTiers = [500, 3000, 10000];
        for (const hop of routes.slice(1)) {
          for (const f1 of baseTiers) {
            for (const f2 of tiers) {
              const encoded = encodePath(hop, [f1, f2]);
              const out = await client
                .simulateContract({
                  address: quoter,
                  abi: probe.quoterKind === "v1" ? QUOTER_V1_ABI : QUOTER_V2_ABI,
                  functionName: "quoteExactInput",
                  args: [encoded, amountInWei],
                })
                .then((sim) =>
                  probe.quoterKind === "v1"
                    ? (sim.result as bigint)
                    : (sim.result as readonly [bigint, bigint[], number[], bigint])[0],
                )
                .catch(() => 0n);
              if (out > outWei) {
                outWei = out;
                best = { tokens: hop, fees: [f1, f2] };
              }
            }
          }
        }
      }

      if (outWei === 0n) {
        // "No liquidity" is only the right answer when the quoter actually
        // answered. If nothing is deployed at these addresses, or no quoter ABI
        // matched, then we never asked about liquidity at all — and reporting it
        // that way is what sent everyone hunting for a pool that was never the
        // problem.
        const infra = await swapDiagnostic(chainKey);
        if (infra) {
          return {
            ok: false,
            reason: infra,
            amountOut: 0,
            minOut: 0,
            feeAmount,
            routerReady: false,
          };
        }
        if (!probe.quoterKind) {
          return {
            ok: false,
            reason: `The quoter at ${quoter} on ${cfg.name} didn't respond to either the QuoterV2 or the original Quoter interface. The address is probably not a Uniswap quoter — set VITE_QUOTER_${cfg.key.toUpperCase()}.`,
            amountOut: 0,
            minOut: 0,
            feeAmount,
            routerReady: false,
          };
        }
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

  const probe = await probeRouter(chainKey);
  if (isV3 && !probe.routerDeployed) {
    throw new Error((await swapDiagnostic(chainKey)) ?? `Router unavailable on ${cfg.name}.`);
  }

  /**
   * Arguments for the swap call, wrapped in multicall(deadline, …) only when
   * the router actually supports it.
   *
   * Wrapping unconditionally was a mistake: the deadline is worth having, but a
   * router without the multicall extension reverts on an unknown selector, so
   * the wrapper turned every working swap on such a chain into a failure. The
   * wrapper is now conditional on the probe, and a chain that can't take it
   * simply trades without an expiry — which is what it did before, and is
   * strictly better than not trading.
   */
  const v3Args = (amountInWei: bigint, minOutWei: bigint) =>
    probe.supportsMulticall
      ? ({
          account,
          chain,
          address: router,
          abi: V3_ROUTER_ABI,
          functionName: "multicall" as const,
          args: [deadline, [encodeSwap(amountInWei, minOutWei)]] as const,
        } as const)
      : v3Path
        ? ({
            account,
            chain,
            address: router,
            abi: V3_ROUTER_ABI,
            functionName: "exactInput" as const,
            args: [
              {
                path: v3Path,
                recipient: account,
                amountIn: amountInWei,
                amountOutMinimum: minOutWei,
              },
            ] as const,
          } as const)
        : ({
            account,
            chain,
            address: router,
            abi: V3_ROUTER_ABI,
            functionName: "exactInputSingle" as const,
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
            ] as const,
          } as const);

  const swapV3 = (amountInWei: bigint, minOutWei: bigint, value?: bigint) =>
    walletClient.writeContract({ ...v3Args(amountInWei, minOutWei), value } as never);

  /**
   * Fee + swap as ONE transaction, on routers that carry SwapRouter02's
   * payments extension:
   *
   *   multicall(deadline, [
   *     pull(feeToken, feeWei),                    // user → router
   *     sweepToken(feeToken, feeWei, TREASURY),    // router → fee wallet
   *     exactInput(...)                            // the swap itself
   *   ])
   *
   * This is the answer to "how do the fees actually get to my wallet" on the
   * swap side: the same transaction that trades also lands PLATFORM_FEE_BPS of
   * the input in FEE_RECIPIENT, atomically. If the swap reverts the fee reverts
   * with it, which retires the whole fee-before-doomed-swap problem — and it is
   * one wallet prompt instead of two.
   *
   * The approval must cover fee + swap, since `pull` draws on the same
   * allowance the swap does.
   */
  const batchedFeeSwapArgs = (
    feeToken: `0x${string}`,
    feeWei: bigint,
    amountInWei: bigint,
    minOutWei: bigint,
  ) =>
    ({
      account,
      chain,
      address: router,
      abi: V3_ROUTER_ABI,
      functionName: "multicall" as const,
      args: [
        deadline,
        [
          encodeFunctionData({
            abi: V3_ROUTER_ABI,
            functionName: "pull",
            args: [feeToken, feeWei],
          }),
          encodeFunctionData({
            abi: V3_ROUTER_ABI,
            functionName: "sweepToken",
            args: [feeToken, feeWei, FEE_RECIPIENT],
          }),
          encodeSwap(amountInWei, minOutWei),
        ],
      ] as const,
    }) as const;

  const canBatchFee = isV3 && probe.supportsMulticall && probe.supportsPayments;

  /**
   * Try to prove the swap fails before taking a fee for it.
   *
   * The fee is a separate transaction that must go first — the router pulls the
   * remainder, so the balance has to be split beforehand — which means a swap
   * that was always going to revert would still cost the user 1%. A simulation
   * closes that at no cost.
   *
   * FAIL-OPEN, deliberately. At simulation time the fee hasn't moved and the
   * approval hasn't happened, so a whole class of reverts is expected and means
   * nothing. Blocking on any unrecognised revert (the first cut of this) stops
   * perfectly good trades on any chain whose router phrases its errors
   * differently. So this only refuses when the revert positively identifies a
   * routing problem the trade cannot recover from.
   */
  const client = getPublicClient(chainKey);
  const assertSwapViable = async (amountInWei: bigint, minOutWei: bigint, value?: bigint) => {
    if (!isV3) return;
    try {
      await client.simulateContract({ ...v3Args(amountInWei, minOutWei), account, value } as never);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : "").split("\n")[0];
      // Only these say "this trade is impossible" rather than "state isn't
      // ready yet": no pool at all, or the price moved past the slippage floor.
      const fatal =
        /Unexpected error|SPL|Too little received|Too much requested|no pool|Pool does not exist/i.test(
          msg,
        );
      if (fatal) {
        throw new Error(`This swap would fail — no fee has been charged. ${msg}`);
      }
      // Anything else: proceed. The wallet will show the real revert if there
      // is one, and the user still gets to decide.
    }
  };

  if (side === "buy") {
    const feeWei = parseUnits(amountToString(feeAmount, inter.decimals), inter.decimals);
    const swapWei = parseUnits(amountToString(swapAmount, inter.decimals), inter.decimals);
    const minOutWei = parseUnits(amountToString(minOut, tokenDecimals), tokenDecimals);

    if (inter.mode === "erc20") {
      // Buy funded by the ERC-20 gas token (USDT0).
      if (canBatchFee) {
        // One transaction: pull fee → sweep to treasury → swap. Atomic, so the
        // fee cannot outlive a failed swap.
        result.approveTxHash = await approveExact(interAddr, router, feeWei + swapWei);
        const tx = await walletClient.writeContract(
          batchedFeeSwapArgs(interAddr, feeWei, swapWei, minOutWei) as never,
        );
        result.feeTxHash = tx;
        result.swapTxHash = tx;
      } else {
        // Fallback for routers without the payments extension: fee as its own
        // transfer, then the swap.
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
      }
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

    if (canBatchFee) {
      // One transaction: pull the fee (in the token being sold) → sweep it to
      // the treasury → swap the remainder. Atomic; one signature.
      result.approveTxHash = await approveExact(token, router, feeWei + swapWei);
      const tx = await walletClient.writeContract(
        batchedFeeSwapArgs(token, feeWei, swapWei, minOutWei) as never,
      );
      result.feeTxHash = tx;
      result.swapTxHash = tx;
    } else {
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
  }

  return result;
}

export { FEE_RECIPIENT, PLATFORM_FEE_BPS };
