import { createServerFn } from "@tanstack/react-start";
import { kvCommand, kvEnabled, kvGetJson, kvIncr, kvPipeline, kvSetJson } from "./kv";
import { WHITELIST_CAP } from "./whitelist";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side persistence, all optional.
//
// Every function here answers "not configured" when no store is set up, and the
// callers fall back to what they already do — localStorage and a live fetch. So
// adding the store is a pure upgrade, and losing it degrades rather than breaks.
//
// What it buys:
//   snapshot   The last good token list per chain, shared by every visitor. A
//              cold visitor paints real rows immediately instead of watching
//              indexers resolve, and logo URLs arrive with the row rather than
//              after an enrichment pass — which is the actual reason icons
//              "load every time".
//   whitelist  One roster for everyone, so spot #7 means the 7th person, not
//              the 7th claim in that browser.
//   analytics  Visit and event counters.
// ─────────────────────────────────────────────────────────────────────────────

const SNAPSHOT_TTL = 15 * 60; // seconds

const key = {
  snapshot: (chain: string) => `snap:tokens:${chain}`,
  logos: (chain: string) => `logo:${chain}`,
  wlList: "wl:roster",
  wlWallet: (addr: string) => `wl:spot:${addr}`,
  visits: (day: string) => `stat:visits:${day}`,
  visitsTotal: "stat:visits:total",
  event: (name: string) => `stat:ev:${name}`,
};

const today = () => new Date().toISOString().slice(0, 10);

// ── Token snapshot ───────────────────────────────────────────────────────────

export const readSnapshot = createServerFn({ method: "GET" })
  .validator((raw: unknown): { chain: string } => ({
    chain: String((raw as { chain?: unknown })?.chain ?? "").trim() || "stable",
  }))
  // Rows cross the wire as a JSON string: the server-fn serializer only accepts
  // concrete types, and the row shape belongs to the client anyway.
  .handler(
    async ({ data }): Promise<{ json: string; ts: number } | null> =>
      kvGetJson<{ json: string; ts: number }>(key.snapshot(data.chain)),
  );

export const writeSnapshot = createServerFn({ method: "POST" })
  .validator((raw: unknown): { chain: string; json: string } => {
    const o = (raw ?? {}) as { chain?: unknown; json?: unknown };
    return {
      chain: String(o.chain ?? "").trim() || "stable",
      // Cap the payload: this is a paint-fast cache, not a database, and the
      // free tier's 256 MB is worth respecting.
      json: String(o.json ?? "").slice(0, 400_000),
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    if (!kvEnabled() || data.json.length < 2) return { ok: false };
    await kvSetJson(key.snapshot(data.chain), { json: data.json, ts: Date.now() }, SNAPSHOT_TTL);
    return { ok: true };
  });

// ── Token logos ──────────────────────────────────────────────────────────────
//
// The snapshot expires in 15 minutes; artwork doesn't change on that scale. A
// token's icon URL, once found, is good for weeks — so it gets its own long-
// lived hash. This is what stops a brand-new Stable launch from rendering as a
// blank tile on every cold load while the enrichment pass catches up: the URL
// is already known before any indexer answers, so the browser starts fetching
// the image with the first paint.
//
// URLs only, never image bytes. The browser caches the bytes itself after the
// first fetch; mirroring them here would spend the free tier's transfer budget
// to re-solve a problem HTTP already solved.

const LOGO_TTL = 30 * 24 * 3600; // seconds — dead tokens age out on their own
const MAX_LOGO_WRITE = 120;

export const readLogos = createServerFn({ method: "GET" })
  .validator((raw: unknown): { chain: string } => ({
    chain: String((raw as { chain?: unknown })?.chain ?? "").trim() || "stable",
  }))
  .handler(async ({ data }): Promise<{ json: string }> => {
    if (!kvEnabled()) return { json: "" };
    // HGETALL answers as a flat [field, value, field, value, …] array.
    const flat = await kvCommand<string[]>(["HGETALL", key.logos(data.chain)]);
    if (!Array.isArray(flat) || flat.length < 2) return { json: "" };
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
    return { json: JSON.stringify(out) };
  });

export const writeLogos = createServerFn({ method: "POST" })
  .validator((raw: unknown): { chain: string; json: string } => {
    const o = (raw ?? {}) as { chain?: unknown; json?: unknown };
    return {
      chain: String(o.chain ?? "").trim() || "stable",
      json: String(o.json ?? "").slice(0, 100_000),
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; written: number }> => {
    if (!kvEnabled() || data.json.length < 2) return { ok: false, written: 0 };

    let parsed: unknown;
    try {
      parsed = JSON.parse(data.json);
    } catch {
      return { ok: false, written: 0 };
    }
    if (!parsed || typeof parsed !== "object") return { ok: false, written: 0 };

    const args: string[] = [];
    for (const [addr, url] of Object.entries(parsed as Record<string, unknown>)) {
      if (args.length >= MAX_LOGO_WRITE * 2) break;
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) continue;
      if (typeof url !== "string" || !/^https?:\/\//.test(url) || url.length > 400) continue;
      args.push(addr.toLowerCase(), url);
    }
    if (!args.length) return { ok: false, written: 0 };

    const k = key.logos(data.chain);
    await kvPipeline([
      ["HSET", k, ...args],
      ["EXPIRE", k, LOGO_TTL],
    ]);
    return { ok: true, written: args.length / 2 };
  });

// ── Whitelist ────────────────────────────────────────────────────────────────

export interface WhitelistClaim {
  ok: boolean;
  /** 1-based spot, when granted. */
  spot?: number;
  taken: number;
  cap: number;
  reason?: string;
  /** False when no store is configured — the caller keeps its local roster. */
  shared: boolean;
}

export const claimWhitelistSpot = createServerFn({ method: "POST" })
  .validator((raw: unknown): { wallet: string } => ({
    wallet: String((raw as { wallet?: unknown })?.wallet ?? "")
      .trim()
      .toLowerCase(),
  }))
  .handler(async ({ data }): Promise<WhitelistClaim> => {
    const { wallet } = data;
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
      return { ok: false, taken: 0, cap: WHITELIST_CAP, reason: "Invalid address.", shared: false };
    }
    if (!kvEnabled()) {
      return { ok: false, taken: 0, cap: WHITELIST_CAP, shared: false };
    }

    // Already claimed? Return the same spot rather than consuming another.
    const existing = await kvGetJson<number>(key.wlWallet(wallet));
    if (typeof existing === "number") {
      const taken = (await kvPipeline<number>([["LLEN", key.wlList]]))?.[0] ?? existing;
      return { ok: true, spot: existing, taken, cap: WHITELIST_CAP, shared: true };
    }

    const len = (await kvPipeline<number>([["LLEN", key.wlList]]))?.[0] ?? 0;
    if (len >= WHITELIST_CAP) {
      return {
        ok: false,
        taken: len,
        cap: WHITELIST_CAP,
        reason: "All spots have been claimed.",
        shared: true,
      };
    }

    // RPUSH returns the new length, which IS the spot number. Redis runs
    // commands one at a time, so two simultaneous claims get 7 and 8 rather
    // than both getting 7 — the reason this belongs on a server at all.
    const pushed = await kvPipeline<number>([["RPUSH", key.wlList, wallet]]);
    const spot = pushed?.[0];
    if (typeof spot !== "number" || spot < 1) {
      return {
        ok: false,
        taken: len,
        cap: WHITELIST_CAP,
        reason: "Could not claim.",
        shared: true,
      };
    }
    if (spot > WHITELIST_CAP) {
      return {
        ok: false,
        taken: spot,
        cap: WHITELIST_CAP,
        reason: "All spots have been claimed.",
        shared: true,
      };
    }

    await kvSetJson(key.wlWallet(wallet), spot, 365 * 24 * 3600);
    return { ok: true, spot, taken: spot, cap: WHITELIST_CAP, shared: true };
  });

export const readWhitelistCount = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ taken: number; cap: number; shared: boolean }> => {
    if (!kvEnabled()) return { taken: 0, cap: WHITELIST_CAP, shared: false };
    const len = (await kvPipeline<number>([["LLEN", key.wlList]]))?.[0] ?? 0;
    return { taken: len, cap: WHITELIST_CAP, shared: true };
  },
);

// ── Analytics ────────────────────────────────────────────────────────────────

/**
 * Count a visit or a named event. Counters only — no addresses, no
 * fingerprints, nothing that identifies a person.
 */
export const trackEvent = createServerFn({ method: "POST" })
  .validator((raw: unknown): { name: string } => ({
    name: String((raw as { name?: unknown })?.name ?? "visit")
      .replace(/[^a-z0-9_-]/gi, "")
      .slice(0, 32),
  }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    if (!kvEnabled()) return { ok: false };
    if (data.name === "visit") {
      await Promise.all([kvIncr(key.visits(today())), kvIncr(key.visitsTotal)]);
    } else {
      await kvIncr(key.event(data.name));
    }
    return { ok: true };
  });
