// ─────────────────────────────────────────────────────────────────────────────
// DYOR Fun V3 — the launchpad that actually spans all three of our chains
// (Robinhood Chain, Arc and Stable). This is the missing piece for Stable/Arc:
// GeckoTerminal only sees pools, so it can't tell us which tokens launched from
// a bonding curve, how far along that curve they are, or whether they graduated.
// DYOR can.
//
// Documented mechanics (dyorv3.org / dyorpro.fun):
//   • V3 curve target  $9,000   — launches straight into a locked Uniswap V3 1%
//                                 token/WETH pool; graduation is a milestone,
//                                 there is no liquidity migration.
//   • V2 curve target  $18,000  — thicker initial liquidity, migrates to DYOR
//                                 Swap once the curve completes.
//
// The public API shape is `/api/tokens?limit=N`, `/api/tokens/{address}` and a
// per-token trades route. Hosts/paths differ slightly per deployment, so we probe
// a candidate list and keep whichever answers — and if none do, callers simply
// get null and the UI falls back to pool data rather than inventing anything.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChainConfig } from "@/config/chains";
import { proxiedFetchJson } from "../net";

/** Documented bonding-curve targets, in USD. */
export const DYOR_CURVE_TARGET_V3 = 9_000;
export const DYOR_CURVE_TARGET_V2 = 18_000;

const HOSTS = ["https://dyorv3.org", "https://dyorpro.fun", "https://dyorswap.org"];

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return isFinite(n) ? n : 0;
};

interface DyorToken {
  address?: string;
  tokenAddress?: string;
  contract?: string;
  name?: string;
  symbol?: string;
  image?: string;
  imageUrl?: string;
  logo?: string;
  createdAt?: string | number;
  launchedAt?: string | number;
  holders?: number;
  holderCount?: number;
  marketCap?: number | string;
  marketCapUsd?: number | string;
  /** Raised-so-far on the curve, when the API exposes it directly. */
  raised?: number | string;
  raisedUsd?: number | string;
  curveProgress?: number | string;
  progress?: number | string;
  bondingCurveProgress?: number | string;
  graduated?: boolean;
  isGraduated?: boolean;
  complete?: boolean;
  version?: string | number;
  chainId?: number;
  pool?: string;
  poolAddress?: string;
}

export interface DyorTokenInfo {
  address: string;
  name?: string;
  symbol?: string;
  logoUrl?: string;
  holders?: number;
  /** 0..100 progress along the bonding curve. */
  curveProgress: number;
  graduated: boolean;
  /** USD target for this token's curve (V3 $9k, V2 $18k). */
  curveTarget: number;
  createdAtMs?: number;
  poolAddress?: string;
}

function pickAddress(t: DyorToken): string {
  return (t.address ?? t.tokenAddress ?? t.contract ?? "").toLowerCase();
}

function toMs(v: string | number | undefined): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Date.parse(v);
  if (!isFinite(n)) return undefined;
  // Accept seconds or milliseconds.
  return n < 1e12 ? n * 1000 : n;
}

function mapToken(t: DyorToken): DyorTokenInfo | null {
  const address = pickAddress(t);
  if (!address) return null;

  const isV2 = String(t.version ?? "").includes("2");
  const curveTarget = isV2 ? DYOR_CURVE_TARGET_V2 : DYOR_CURVE_TARGET_V3;

  // Prefer an explicit progress field; otherwise derive it from raised/target.
  const explicit = num(t.curveProgress ?? t.progress ?? t.bondingCurveProgress);
  const raised = num(t.raised ?? t.raisedUsd);
  let curveProgress = explicit > 0 ? explicit : raised > 0 ? (raised / curveTarget) * 100 : 0;
  // Some APIs report progress as a 0..1 fraction.
  if (explicit > 0 && explicit <= 1) curveProgress = explicit * 100;
  curveProgress = Math.max(0, Math.min(100, curveProgress));

  const graduated = Boolean(t.graduated ?? t.isGraduated ?? t.complete) || curveProgress >= 100;

  return {
    address,
    name: t.name,
    symbol: t.symbol,
    logoUrl: t.image ?? t.imageUrl ?? t.logo ?? undefined,
    holders: t.holders ?? t.holderCount,
    curveProgress: graduated ? 100 : curveProgress,
    graduated,
    curveTarget,
    createdAtMs: toMs(t.createdAt ?? t.launchedAt),
    poolAddress: t.pool ?? t.poolAddress,
  };
}

function unwrapList(body: unknown): DyorToken[] {
  if (Array.isArray(body)) return body as DyorToken[];
  const obj = body as { tokens?: unknown; data?: unknown; items?: unknown; results?: unknown };
  for (const v of [obj?.tokens, obj?.data, obj?.items, obj?.results]) {
    if (Array.isArray(v)) return v as DyorToken[];
  }
  return [];
}

function unwrapOne(body: unknown): DyorToken | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as { token?: unknown; data?: unknown };
  const inner = (obj.token ?? obj.data ?? body) as DyorToken;
  return inner && typeof inner === "object" ? inner : null;
}

/**
 * Every DYOR-launched token on a chain, keyed by address. One request feeds the
 * whole terminal list with real curve progress + graduation state.
 */
export async function fetchDyorTokens(cfg: ChainConfig): Promise<Record<string, DyorTokenInfo>> {
  const slug = cfg.dyorSlug;
  if (!slug) return {};
  // The API is chain-namespaced: /api/<slug>/... (confirmed by /api/stable/openapi).
  const paths = [
    `/api/${slug}/tokens?limit=100&sort=newest`,
    `/api/${slug}/tokens?limit=100`,
    `/api/${slug}/tokens`,
  ];
  for (const host of HOSTS) {
    for (const path of paths) {
      const body = await proxiedFetchJson<unknown>(`${host}${path}`, { timeoutMs: 9_000 });
      const list = unwrapList(body);
      if (!list.length) continue;
      const out: Record<string, DyorTokenInfo> = {};
      for (const raw of list) {
        // When the API ignores the chain filter, drop rows for other chains.
        if (raw.chainId != null && Number(raw.chainId) !== cfg.id) continue;
        const t = mapToken(raw);
        if (t) out[t.address] = t;
      }
      if (Object.keys(out).length) return out;
    }
  }
  return {};
}

/** Curve/graduation detail for a single token. */
export async function fetchDyorToken(
  cfg: ChainConfig,
  address: string,
): Promise<DyorTokenInfo | null> {
  const slug = cfg.dyorSlug;
  if (!slug) return null;
  const addr = address.toLowerCase();
  const paths = [`/api/${slug}/tokens/${addr}`, `/api/${slug}/token/${addr}`];
  for (const host of HOSTS) {
    for (const path of paths) {
      const body = await proxiedFetchJson<unknown>(`${host}${path}`, { timeoutMs: 9_000 });
      const raw = unwrapOne(body);
      if (!raw) continue;
      const t = mapToken(raw);
      if (t && t.address === addr) return t;
    }
  }
  return null;
}
