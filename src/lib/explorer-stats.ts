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
//   2. The Etherscan-family explorer's chart CSV exports. Every Etherscan
//      deployment — StableScan included — serves each chart as CSV:
//        /chart/tx?output=csv                 daily transaction counts
//        /chart/address?output=csv            cumulative unique addresses
//        /chart/verified-contracts?output=csv cumulative verified contracts
//      Rows are `"Date(UTC)","UnixTimeStamp","Value"`. Summing the tx series
//      gives total transactions; its last row is the last full day; the address
//      series is cumulative so its last row IS the total address count. This is
//      the most reliable source for Stable: small, static, text/csv, and not
//      gated behind the client-rendered parts of the UI.
//
//   3. The explorer's server-rendered pages, as a backstop when the CSVs are
//      unavailable. Etherscan states these totals in fixed strings:
//        /txs                → "More than 12,345,678 transactions found"
//        /accounts           → "A total of 97,059 accounts found"
//        /tokens             → "A total of 412 token contracts found"
//        /contractsVerified  → "A total of 88 verified contracts found"
//        /charts             → the #section-overview-stats grid
//
//   4. The Etherscan V2 multichain API for a key-authenticated block height and
//      gas price. Stable IS on Etherscan V2 (`api.etherscan.io/v2/api?chainid=988`
//      — StableScan is an Etherscan-built explorer), so a STABLESCAN_API_KEY is
//      valid there. What V2 does NOT have, on any chain, is a free "total
//      transactions"/"total addresses" endpoint — those exist only as chart data,
//      which is why adding the key alone changed nothing.
//
// The API key is read from env ONLY and used ONLY on the server, so it never
// reaches the client bundle. Supported names (first match wins):
//   STABLESCAN_API_KEY · ETHERSCAN_API_KEY · EXPLORER_API_KEY
// No key is required for sources 1-3 — it only authenticates source 4.
//
// `sources` on the result records which hops actually produced data, so a live
// deployment can be diagnosed from the network tab without guesswork.
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
  gasPriceGwei?: number;
  /** Which hops produced data, e.g. ["csv:tx", "csv:address", "api:v2"]. */
  sources?: string[];
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
  | "blockNumber"
  | "gasPriceGwei";

const NUMERIC_KEYS: NumericStat[] = [
  "totalAddresses",
  "totalTransactions",
  "newAddresses24h",
  "transactions24h",
  "tokensTotal",
  "contractsTotal",
  "blockNumber",
  "gasPriceGwei",
];

/** Fill only the fields `base` is missing — a later source never overwrites. */
function merge(base: ExplorerStats, extra: Partial<ExplorerStats>): ExplorerStats {
  const out = { ...base };
  for (const k of NUMERIC_KEYS) {
    if (out[k] == null && extra[k] != null) out[k] = extra[k];
  }
  if (extra.sources?.length) out.sources = [...(out.sources ?? []), ...extra.sources];
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

interface SeriesPoint {
  ts: number;
  value: number;
}

/**
 * Parse an Etherscan chart CSV export.
 * Header: "Date(UTC)","UnixTimeStamp","Value" — the header row can't match
 * because its second column isn't numeric.
 */
function parseChartCsv(csv: string): SeriesPoint[] {
  const rows: SeriesPoint[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const m = line.match(/^\s*"?[^",]*"?\s*,\s*"?(\d{9,12})"?\s*,\s*"?([\d,]+(?:\.\d+)?)"?/);
    if (!m) continue;
    const ts = parseInt(m[1], 10);
    const value = parseFloat(m[2].replace(/,/g, ""));
    if (!isFinite(ts) || !isFinite(value)) continue;
    rows.push({ ts, value });
  }
  return rows.sort((a, b) => a.ts - b.ts);
}

/** A non-decreasing series is cumulative (its last point is the total). */
function isCumulative(rows: SeriesPoint[]): boolean {
  for (let i = 1; i < rows.length; i++) if (rows[i].value < rows[i - 1].value) return false;
  return true;
}

async function fetchChart(host: string, name: string): Promise<SeriesPoint[]> {
  const csv = await proxiedFetchText(`${host}/chart/${name}?output=csv`, {
    timeoutMs: 12_000,
    headers: { Accept: "text/csv,text/plain,*/*" },
  });
  if (!csv || csv.length < 40) return [];
  return parseChartCsv(csv);
}

/**
 * Read the network totals from the explorer's chart CSV exports. This is the
 * data behind stablescan.xyz/charts#section-overview-stats, served as plain
 * text instead of markup — no parsing of a rendered page, no key required.
 */
async function viaChartCsv(host: string): Promise<Partial<ExplorerStats>> {
  const [tx, addr, verified] = await Promise.all([
    fetchChart(host, "tx"),
    fetchChart(host, "address"),
    fetchChart(host, "verified-contracts"),
  ]);

  const out: Partial<ExplorerStats> = {};
  const sources: string[] = [];

  if (tx.length) {
    // Daily counts: the running total is their sum, "24h" is the last full day.
    const total = isCumulative(tx) ? tx[tx.length - 1].value : tx.reduce((s, r) => s + r.value, 0);
    if (total > 0) out.totalTransactions = Math.round(total);
    const last = tx[tx.length - 1].value;
    if (last > 0) out.transactions24h = Math.round(last);
    sources.push("csv:tx");
  }

  if (addr.length) {
    // Unique-address charts are cumulative, so the last point is the total.
    const total = isCumulative(addr)
      ? addr[addr.length - 1].value
      : addr.reduce((s, r) => s + r.value, 0);
    if (total > 0) out.totalAddresses = Math.round(total);
    if (addr.length > 1 && isCumulative(addr)) {
      const delta = addr[addr.length - 1].value - addr[addr.length - 2].value;
      if (delta > 0) out.newAddresses24h = Math.round(delta);
    } else if (addr.length) {
      out.newAddresses24h = Math.round(addr[addr.length - 1].value) || undefined;
    }
    sources.push("csv:address");
  }

  if (verified.length) {
    const total = isCumulative(verified)
      ? verified[verified.length - 1].value
      : verified.reduce((s, r) => s + r.value, 0);
    if (total > 0) out.contractsTotal = Math.round(total);
    sources.push("csv:verified-contracts");
  }

  if (sources.length) out.sources = sources;
  return out;
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
    let hit = false;

    for (const c of COUNTERS) {
      if (out[c.key] != null) continue;
      const m = text.match(c.re);
      if (!m) continue;
      const v = toNumber(m[1].trim());
      if (isFinite(v) && v >= c.floor) {
        out[c.key] = v;
        hit = true;
      }
    }
    for (const g of GRID) {
      if (out[g.key] != null) continue;
      const v = statValue(text, g.re, g.floor);
      if (v != null) {
        out[g.key] = v;
        hit = true;
      }
    }
    if (hit) out.sources = [...(out.sources ?? []), `html:${url.replace(host, "") || "/"}`];
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
 * Etherscan-compatible JSON API hosts. Etherscan V2 multichain comes first when
 * a key is set — Stable (988) is one of the chains it serves, and that's the
 * host a STABLESCAN_API_KEY authenticates against. The white-label host is kept
 * as a key-less fallback for deployments V2 hasn't picked up.
 */
function etherscanApiBases(chain: string): string[] {
  const key = apiKey();
  const id = CHAIN_IDS[chain];
  const bases: string[] = [];
  if (key && id) bases.push(`https://api.etherscan.io/v2/api?chainid=${id}`);
  if (chain === "stable")
    bases.push("https://api.stablescan.xyz/api", "https://stablescan.xyz/api");
  return bases;
}

interface RpcResult {
  result?: string;
}

/** Block height + gas price from the Etherscan-compatible JSON API. */
async function viaEtherscanApi(chain: string): Promise<Partial<ExplorerStats>> {
  const key = apiKey();
  const suffix = key ? `&apikey=${key}` : "";

  for (const base of etherscanApiBases(chain)) {
    const sep = base.includes("?") ? "&" : "?";
    const [blockRes, gasRes] = await Promise.all([
      proxiedFetchJson<RpcResult>(`${base}${sep}module=proxy&action=eth_blockNumber${suffix}`, {
        timeoutMs: 8_000,
      }),
      proxiedFetchJson<RpcResult>(`${base}${sep}module=proxy&action=eth_gasPrice${suffix}`, {
        timeoutMs: 8_000,
      }),
    ]);

    const out: Partial<ExplorerStats> = {};
    const hex = blockRes?.result;
    if (typeof hex === "string" && hex.startsWith("0x")) {
      const n = parseInt(hex, 16);
      if (isFinite(n) && n > 0) out.blockNumber = n;
    }
    const gasHex = gasRes?.result;
    if (typeof gasHex === "string" && gasHex.startsWith("0x")) {
      const wei = parseInt(gasHex, 16);
      if (isFinite(wei) && wei > 0) out.gasPriceGwei = wei / 1e9;
    }
    if (out.blockNumber || out.gasPriceGwei) {
      out.sources = [`api:${base.includes("etherscan.io") ? "etherscan-v2" : "white-label"}`];
      return out;
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
 * Network totals for a chain. Sources are merged rather than raced, cheapest and
 * most reliable first: Blockscout /stats, then the explorer's chart CSVs, then
 * its rendered pages, then the JSON API for block height and gas. Every hop only
 * fills fields still missing, so one failure can never blank a figure another
 * source already found. Returns ok:false rather than guessing.
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

    // Guarded like every hop below it. Unguarded, a throw here rejected the
    // whole server function, so a single unreachable Blockscout host discarded
    // the CSV, HTML and JSON-API results that were never even attempted — the
    // caller just saw null and the counters went blank.
    let stats = await viaBlockscout(BLOCKSCOUT_HOSTS[chain] ?? []).catch(
      () => ({ ok: false }) as ExplorerStats,
    );
    if (stats.ok) stats.sources = ["blockscout"];

    const complete = (s: ExplorerStats) => Boolean(s.totalTransactions && s.totalAddresses);

    for (const host of SCAN_HOSTS[chain] ?? []) {
      if (complete(stats)) break;
      // CSV exports first — plain text, no rendered markup to parse.
      const csv = await viaChartCsv(host).catch(() => ({}) as Partial<ExplorerStats>);
      stats = merge(stats, csv);
      if (complete(stats)) break;
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
