import { createServerFn } from "@tanstack/react-start";
import { proxiedFetchJson, proxiedFetchText } from "./net";

// ─────────────────────────────────────────────────────────────────────────────
// Network overview stats per chain (total transactions, total addresses, 24h
// counters, tokens, contracts).
//
// Three real sources, tried in order and MERGED (never either/or):
//
//   1. Blockscout `/api/v2/stats` — structured and exact. Only exists for chains
//      whose explorer is Blockscout (Robinhood, Arc).
//
//   2. The Etherscan-family explorer's own server-rendered pages. Stable's
//      explorer is StableScan (Etherscan-powered), and per the Etherscan API
//      docs (https://docs.etherscan.io/introduction) there is NO free endpoint
//      for "total transactions"/"total addresses" — those figures live only in
//      the UI. Etherscan renders them as fixed, machine-readable strings:
//        /txs                → "More than 12,345,678 transactions found"
//        /accounts           → "A total of 97,059 accounts found"
//        /tokens             → "A total of 412 token contracts found"
//        /contractsVerified  → "A total of 88 verified contracts found"
//        /charts             → the Overview grid (24h counters, totals)
//      We read those pages server-side (CORS-free, key stays secret) and parse
//      the labelled figures. This is the fetch that populated Stable before.
//
//   3. The Etherscan-compatible JSON API for a key-authenticated block height:
//      StableScan's own host first (`https://stablescan.xyz/api`, the white-label
//      deployment the key belongs to), then Etherscan V2 multichain
//      (`api.etherscan.io/v2/api?chainid=…`) for chains it actually covers.
//      Note: V2 only serves chains on Etherscan's supported list — it does not
//      cover Stable — which is why the key alone changed nothing before.
//
// The API key is read from env ONLY and used ONLY on the server, so it never
// reaches the client bundle. Supported names (first match wins):
//   STABLESCAN_API_KEY · ETHERSCAN_API_KEY · EXPLORER_API_KEY
// No key is required for the totals above — it only unlocks the JSON API hop.
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

export interface ExplorerStats {
  totalAddresses?: number;
  totalTransactions?: number;
  newAddresses24h?: number;
  transactions24h?: number;
  tokensTotal?: number;
  contractsTotal?: number;
  /** Key-authenticated block height from the Etherscan-compatible API. */
  blockNumber?: number;
  ok: boolean;
}

/** Every numeric field — used to merge partial results from different sources. */
type NumericStat =
  | "totalAddresses"
  | "totalTransactions"
  | "newAddresses24h"
  | "transactions24h"
  | "tokensTotal"
  | "contractsTotal"
  | "blockNumber";

const NUMERIC_KEYS: NumericStat[] = [
  "totalAddresses",
  "totalTransactions",
  "newAddresses24h",
  "transactions24h",
  "tokensTotal",
  "contractsTotal",
  "blockNumber",
];

/** Fill only the fields `base` is missing — a later source never overwrites. */
function merge(base: ExplorerStats, extra: Partial<ExplorerStats>): ExplorerStats {
  const out = { ...base };
  for (const k of NUMERIC_KEYS) {
    if (out[k] == null && extra[k] != null) out[k] = extra[k];
  }
  return out;
}

/** "10.95 M" | "97,059" | "1.2B" → number. */
function toNumber(tok: string): number {
  const m = tok.replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?/i);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase()] ?? 1;
  return isFinite(n) ? n * mult : NaN;
}

/** Strip markup so the page reads as plain prose the regexes can match. */
function plain(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

/**
 * Find the value for a labelled stat on the Charts/Overview grid. We locate the
 * label, take the ~90 chars that follow, extract every number token, and keep
 * the LARGEST — the headline figure (e.g. "10.95 M"), never the parenthetical
 * suffix ("6.9 TPS", "87.17%", "(24H)"). A per-metric sanity floor rejects
 * garbage so a bad parse shows "—" instead of a fake "1".
 */
function statValue(text: string, label: RegExp, floor: number): number | undefined {
  const at = text.search(label);
  if (at < 0) return undefined;
  const window = text.slice(at, at + 90).replace(new RegExp(label.source, "i"), "");
  const cleaned = window.replace(/\([^)]*\)/g, " ").replace(/[\d.]+\s*%/g, " ");
  const tokens = cleaned.match(/[\d,]+(?:\.\d+)?\s*[KMB]?/gi) ?? [];
  let best = NaN;
  for (const tok of tokens) {
    const v = toNumber(tok.trim());
    if (isFinite(v) && (isNaN(best) || v > best)) best = v;
  }
  return isFinite(best) && best >= floor ? best : undefined;
}

interface BlockscoutStats {
  total_blocks?: string;
  total_transactions?: string;
  total_addresses?: string;
  transactions_today?: string;
}

/**
 * Blockscout's /stats endpoint carries the network totals directly. Tried first
 * for every chain that has a Blockscout instance.
 */
async function viaBlockscout(hosts: string[]): Promise<ExplorerStats> {
  for (const host of hosts) {
    const json = await proxiedFetchJson<BlockscoutStats>(`${host}/api/v2/stats`, {
      timeoutMs: 9_000,
      headers: { Accept: "application/json" },
    });
    if (!json) continue;
    const num = (v?: string) => {
      const x = v ? parseFloat(v.replace(/,/g, "")) : NaN;
      return isFinite(x) && x > 0 ? x : undefined;
    };
    const stats: ExplorerStats = {
      totalTransactions: num(json.total_transactions),
      totalAddresses: num(json.total_addresses),
      transactions24h: num(json.transactions_today),
      ok: false,
    };
    stats.ok = Boolean(stats.totalTransactions || stats.totalAddresses);
    if (stats.ok) return stats;
  }
  return { ok: false };
}

/**
 * Etherscan list pages state their totals in a fixed sentence directly above the
 * table. These strings are stable across every Etherscan deployment, StableScan
 * included, and they are the only free source for these numbers.
 */
const COUNTERS: { key: NumericStat; re: RegExp; floor: number }[] = [
  {
    key: "totalTransactions",
    re: /(?:More than|A total of)\s+([\d,]+(?:\.\d+)?\s*[KMB]?)\s+transactions?\s+found/i,
    floor: 1,
  },
  {
    key: "totalAddresses",
    re: /(?:More than|A total of)\s+([\d,]+(?:\.\d+)?\s*[KMB]?)\s+(?:accounts?|addresses)\s+found/i,
    floor: 1,
  },
  {
    key: "tokensTotal",
    re: /(?:More than|A total of)\s+([\d,]+(?:\.\d+)?\s*[KMB]?)\s+(?:ERC-?20\s+)?token\s+contracts?\s+found/i,
    floor: 1,
  },
  {
    key: "contractsTotal",
    re: /(?:More than|A total of)\s+([\d,]+(?:\.\d+)?\s*[KMB]?)\s+(?:verified\s+)?contracts?\s+found/i,
    floor: 1,
  },
];

/** Overview-grid labels on /charts, used for anything the list pages don't state. */
const GRID: { key: NumericStat; re: RegExp; floor: number }[] = [
  { key: "totalTransactions", re: /Transactions\s*\(?\s*Total/i, floor: 1_000 },
  { key: "totalAddresses", re: /(?:Unique\s+)?Addresses\s*\(?\s*Total/i, floor: 100 },
  { key: "transactions24h", re: /Transactions\s*\(?\s*24/i, floor: 1 },
  { key: "newAddresses24h", re: /New\s*Addresses\s*\(?\s*24/i, floor: 1 },
  { key: "tokensTotal", re: /Tokens?\s*\(?\s*Total/i, floor: 1 },
  { key: "contractsTotal", re: /Contracts?\s*(?:Deployed)?\s*\(?\s*Total/i, floor: 1 },
];

/**
 * Read an Etherscan-family explorer (StableScan) for the network totals. Walks
 * the pages that carry them and accumulates — a page that 403s or renders
 * without a figure simply contributes nothing instead of failing the whole read.
 */
async function scrapeEtherscanFamily(host: string): Promise<ExplorerStats> {
  const out: ExplorerStats = { ok: false };
  const pages = [
    `${host}/charts`,
    `${host}/txs`,
    `${host}/accounts`,
    `${host}/tokens`,
    `${host}/contractsVerified`,
    host,
  ];

  for (const url of pages) {
    const enough = out.totalTransactions && out.totalAddresses && out.transactions24h;
    if (enough) break;

    const raw = await proxiedFetchText(url, {
      timeoutMs: 12_000,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!raw || raw.length < 200) continue;
    const text = plain(raw);

    for (const c of COUNTERS) {
      if (out[c.key] != null) continue;
      const m = text.match(c.re);
      if (!m) continue;
      const v = toNumber(m[1].trim());
      if (isFinite(v) && v >= c.floor) out[c.key] = v;
    }
    for (const g of GRID) {
      if (out[g.key] != null) continue;
      const v = statValue(text, g.re, g.floor);
      if (v != null) out[g.key] = v;
    }
  }

  out.ok = Boolean(out.totalTransactions || out.totalAddresses || out.transactions24h);
  return out;
}

/** Chain ids for the Etherscan V2 multichain API. */
const CHAIN_IDS: Record<string, number> = { stable: 988, robinhood: 4663, arc: 5042002 };

/** Known Blockscout hosts per chain, tried before any page reading. */
const BLOCKSCOUT_HOSTS: Record<string, string[]> = {
  stable: ["https://blockscout.stable.xyz", "https://explorer.stable.xyz"],
  robinhood: ["https://robinhoodchain.blockscout.com"],
  arc: ["https://testnet.arcscan.app"],
};

/** Etherscan-style explorers whose pages carry the totals. */
const SCAN_HOSTS: Record<string, string[]> = {
  stable: ["https://stablescan.xyz"],
  robinhood: [],
  arc: [],
};

/**
 * Etherscan-compatible JSON API hosts. The white-label deployment comes first —
 * that's the host a StableScan key is actually valid on. Etherscan V2 is
 * appended only as a fallback; it serves the chains on Etherscan's supported
 * list, which is why pointing chainid=988 at it returned nothing usable.
 */
const ETHERSCAN_API_HOSTS: Record<string, string[]> = {
  stable: ["https://api.stablescan.xyz/api", "https://stablescan.xyz/api"],
  robinhood: [],
  arc: [],
};

async function viaEtherscanApi(chain: string): Promise<Partial<ExplorerStats>> {
  const key = apiKey();
  const bases = [...(ETHERSCAN_API_HOSTS[chain] ?? [])];
  const id = CHAIN_IDS[chain];
  if (key && id) bases.push(`https://api.etherscan.io/v2/api?chainid=${id}`);

  for (const base of bases) {
    const sep = base.includes("?") ? "&" : "?";
    const url = `${base}${sep}module=proxy&action=eth_blockNumber${key ? `&apikey=${key}` : ""}`;
    const res = await proxiedFetchJson<{ result?: string }>(url, { timeoutMs: 8_000 });
    const hex = res?.result;
    if (typeof hex === "string" && hex.startsWith("0x")) {
      const n = parseInt(hex, 16);
      if (isFinite(n) && n > 0) return { blockNumber: n };
    }
  }
  return {};
}

// Short server-side cache so refreshes don't re-fetch every tick. Failures are
// cached briefly too, so an unreachable explorer can't be hammered every 30s.
const cache = new Map<string, { ts: number; data: ExplorerStats }>();
const TTL_OK = 120_000;
const TTL_FAIL = 20_000;

/**
 * Network totals for a chain. Sources are merged rather than raced: Blockscout
 * fills what it has, the Etherscan-family explorer fills the rest, and the JSON
 * API adds a key-authenticated block height. Returns ok:false rather than
 * guessing.
 */
export const fetchExplorerStats = createServerFn({ method: "GET" })
  .validator((raw: unknown): { chain: string } => {
    const c = typeof raw === "object" && raw ? (raw as { chain?: unknown }).chain : raw;
    return { chain: String(c ?? "").trim() || "stable" };
  })
  .handler(async ({ data }): Promise<ExplorerStats> => {
    const { chain } = data;
    const hit = cache.get(chain);
    if (hit && Date.now() - hit.ts < (hit.data.ok ? TTL_OK : TTL_FAIL)) return hit.data;

    let stats = await viaBlockscout(BLOCKSCOUT_HOSTS[chain] ?? []);

    for (const host of SCAN_HOSTS[chain] ?? []) {
      if (stats.totalTransactions && stats.totalAddresses) break;
      const scraped = await scrapeEtherscanFamily(host).catch(
        () => ({ ok: false }) as ExplorerStats,
      );
      stats = merge(stats, scraped);
    }

    const api = await viaEtherscanApi(chain).catch(() => ({}) as Partial<ExplorerStats>);
    stats = merge(stats, api);

    stats.ok = Boolean(stats.totalTransactions || stats.totalAddresses || stats.transactions24h);
    cache.set(chain, { ts: Date.now(), data: stats });
    return stats;
  });
