import { createServerFn } from "@tanstack/react-start";
import { proxiedFetchJson } from "./net";

// ─────────────────────────────────────────────────────────────────────────────
// The chain's traded-token universe, in one API call.
//
// Stable's `explorer.apiBase` points at a Blockscout instance, and if that
// instance doesn't exist the whole token-registry source contributes nothing —
// leaving GeckoTerminal as Stable's only list, which is why the list looked thin
// and never showed anything new.
//
// The simplest fix that needs no registry and no factory address: ask the
// explorer for the ERC-20 transfers that went through the DEX router.
//
//   /v2/api?chainid=988&module=account&action=tokentx
//          &address=<router>&page=1&offset=1000&sort=desc&apikey=…
//
// Every token that has been traded on the chain shows up there, newest first,
// and each record already carries contractAddress + tokenName + tokenSymbol +
// tokenDecimal. One request yields the list, the metadata and the ordering — no
// per-token lookups, no indexer, no waiting for anyone to index the chain.
//
// This is what the STABLESCAN_API_KEY buys. Runs server-side so the key never
// reaches the browser. Returns [] (never throws) when no key is set.
// ─────────────────────────────────────────────────────────────────────────────

function serverEnv(key: string): string | undefined {
  try {
    const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env?.[key];
    return v && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function apiKey(): string | undefined {
  return (
    serverEnv("STABLESCAN_API_KEY") ??
    serverEnv("ETHERSCAN_API_KEY") ??
    serverEnv("EXPLORER_API_KEY")
  );
}

export interface ScannedToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  /** Oldest transfer we saw for it, ms. */
  firstSeenMs: number;
  /** Newest transfer we saw for it, ms. */
  lastSeenMs: number;
  /** Transfers seen in the window — a rough activity rank. */
  transfers: number;
  /**
   * True when the window contains records older than this token's first
   * transfer, i.e. we genuinely watched it appear rather than just hitting the
   * edge of the page. Only then is firstSeenMs a real launch time.
   */
  firstSeenIsLaunch: boolean;
}

interface EsTokenTx {
  contractAddress?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  timeStamp?: string;
}

export interface TokenScanResult {
  tokens: ScannedToken[];
  /** Why the scan is empty, for the on-screen source readout. */
  note?: string;
}

export const scanTradedTokens = createServerFn({ method: "GET" })
  .validator((raw: unknown): { chainId: number; addresses: string[] } => {
    const o = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
    const list = Array.isArray(o.addresses) ? o.addresses : [];
    return {
      chainId: Number(o.chainId ?? 0),
      addresses: list
        .map((a) => String(a ?? ""))
        .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
        .slice(0, 3),
    };
  })
  .handler(async ({ data }): Promise<TokenScanResult> => {
    const key = apiKey();
    if (!key) return { tokens: [], note: "no explorer API key set" };
    const { chainId, addresses } = data;
    if (!chainId || !addresses.length) return { tokens: [], note: "no router configured" };

    const pages = await Promise.all(
      addresses.map((address) =>
        proxiedFetchJson<{ status?: string; message?: string; result?: EsTokenTx[] | string }>(
          `https://api.etherscan.io/v2/api?chainid=${chainId}` +
            `&module=account&action=tokentx&address=${address}` +
            `&page=1&offset=1000&sort=desc&apikey=${key}`,
          { timeoutMs: 14_000, headers: { Accept: "application/json" } },
        ),
      ),
    );

    const records: EsTokenTx[] = [];
    let note: string | undefined;
    for (const p of pages) {
      if (Array.isArray(p?.result)) records.push(...p.result);
      else if (typeof p?.result === "string") note = p.result;
      else if (!p) note = "explorer API unreachable";
    }
    if (!records.length) return { tokens: [], note: note ?? "no token transfers returned" };

    // Oldest record across the whole window — the horizon we can see back to.
    let horizon = Number.POSITIVE_INFINITY;
    for (const r of records) {
      const ts = Number(r.timeStamp ?? 0) * 1000;
      if (ts > 0 && ts < horizon) horizon = ts;
    }

    const byToken = new Map<string, ScannedToken>();
    for (const r of records) {
      const address = (r.contractAddress ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(address)) continue;
      const ts = Number(r.timeStamp ?? 0) * 1000;
      const decimals = Number(r.tokenDecimal ?? 18);

      const cur = byToken.get(address);
      if (cur) {
        cur.transfers++;
        if (ts > 0) {
          cur.firstSeenMs = Math.min(cur.firstSeenMs || ts, ts);
          cur.lastSeenMs = Math.max(cur.lastSeenMs, ts);
        }
        continue;
      }
      byToken.set(address, {
        address,
        name: r.tokenName || r.tokenSymbol || "Unknown",
        symbol: r.tokenSymbol || "?",
        decimals: isFinite(decimals) ? decimals : 18,
        firstSeenMs: ts,
        lastSeenMs: ts,
        transfers: 1,
        firstSeenIsLaunch: false,
      });
    }

    const tokens = [...byToken.values()];
    for (const t of tokens) {
      // Strictly newer than the window's oldest record ⇒ it appeared inside the
      // window, so its first transfer really is its first activity.
      t.firstSeenIsLaunch = isFinite(horizon) && t.firstSeenMs > horizon;
    }
    tokens.sort((a, b) => b.lastSeenMs - a.lastSeenMs);
    return { tokens };
  });
