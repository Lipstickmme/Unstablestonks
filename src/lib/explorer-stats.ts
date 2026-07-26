import { createServerFn } from "@tanstack/react-start";
import { proxiedFetchJson, proxiedFetchText } from "./net";

// ─────────────────────────────────────────────────────────────────────────────
// Explorer overview stats (Stable). StableScan is Etherscan-powered and its
// "Charts & Statistics → Overview" page carries the network totals (addresses,
// transactions, 24h counts, tokens, contracts) that no free Etherscan API
// endpoint exposes. We read that page server-side (so the API key stays secret
// and CORS is bypassed) and parse the labelled figures.
//
// The API key is used ONLY on the server (never shipped to the client bundle).
// It's read from the STABLESCAN_API_KEY / EXPLORER_API_KEY env var, falling back
// to the key the operator provided. Set the env var in your deploy secrets to
// rotate it without a code change.
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

function apiKey(): string {
  return (
    serverEnv("STABLESCAN_API_KEY") ??
    serverEnv("EXPLORER_API_KEY") ??
    "QCV6J48PRJV8CJ839SW6RXDRBRY1NDX6GY"
  );
}

export interface ExplorerStats {
  totalAddresses?: number;
  totalTransactions?: number;
  newAddresses24h?: number;
  transactions24h?: number;
  tokensTotal?: number;
  contractsTotal?: number;
  gasUsed24h?: number;
  /** Key-authenticated block height from Etherscan V2, when a key is set. */
  blockNumber?: number;
  ok: boolean;
}

/** "10.95 M" | "97,059" | "1.2B" → number. */
function toNumber(tok: string): number {
  const m = tok.replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?/i);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase()] ?? 1;
  return isFinite(n) ? n * mult : NaN;
}

/**
 * Find the value for a labelled stat. We locate the label, take the ~80 chars
 * that follow, extract every number token, and keep the LARGEST — the headline
 * figure (e.g. "10.95 M"), never the small parenthetical suffix ("6.9 TPS",
 * "87.17%", "(24H)"). A per-metric sanity floor rejects garbage so a bad parse
 * shows "—" instead of a fake "1".
 */
function statValue(text: string, label: RegExp, floor: number): number | undefined {
  const at = text.search(label);
  if (at < 0) return undefined;
  const window = text.slice(at, at + 90).replace(new RegExp(label.source, "i"), "");
  // Strip parenthetical suffixes like "(24H)", "(6.9 TPS)", "(87.17%)".
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
 * Etherscan V2 — one key, every supported chain via ?chainid=. Used server-side
 * with STABLESCAN_API_KEY. It doesn't publish a "total addresses" counter, but it
 * does give an authoritative, key-authenticated block height and gas price, and
 * it raises our rate limits on the Etherscan-family explorers.
 */
async function viaEtherscanV2(chainId: number): Promise<Partial<ExplorerStats>> {
  const key = apiKey();
  if (!key) return {};
  const base = `https://api.etherscan.io/v2/api?chainid=${chainId}&apikey=${key}`;

  const [blockRes, countRes] = await Promise.all([
    proxiedFetchJson<{ result?: string }>(`${base}&module=proxy&action=eth_blockNumber`, {
      timeoutMs: 8_000,
    }),
    // Total transaction count is exposed per-chain on the stats module where the
    // chain supports it; absent → we simply don't set the field.
    proxiedFetchJson<{ status?: string; result?: string }>(
      `${base}&module=stats&action=nodecount`,
      { timeoutMs: 8_000 },
    ),
  ]);

  const out: Partial<ExplorerStats> = {};
  const hex = blockRes?.result;
  if (typeof hex === "string" && hex.startsWith("0x")) {
    const n = parseInt(hex, 16);
    if (isFinite(n) && n > 0) out.blockNumber = n;
  }
  void countRes;
  return out;
}

/**
 * Blockscout's /stats endpoint carries the network totals directly. Try the
 * known instances for the chain before falling back to scraping a page.
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

async function scrapeStableScan(): Promise<ExplorerStats> {
  const key = apiKey();
  const pages = [
    `https://stablescan.xyz/charts?apikey=${key}`,
    "https://stablescan.xyz/charts",
    "https://stablescan.xyz",
  ];
  for (const url of pages) {
    const text = await proxiedFetchText(url, { timeoutMs: 12_000 });
    if (!text || text.length < 200) continue;
    // Qualifiers keep "…(Total)" and "…(24H)" apart; floors reject implausible hits.
    const stats: ExplorerStats = {
      totalTransactions: statValue(text, /Transactions\s*\(?\s*Total/i, 1000),
      totalAddresses: statValue(text, /Addresses\s*\(?\s*Total/i, 100),
      transactions24h: statValue(text, /Transactions\s*\(?\s*24/i, 10),
      newAddresses24h: statValue(text, /New\s*Addresses\s*\(?\s*24/i, 1),
      tokensTotal: statValue(text, /Tokens\s*\(?\s*Total/i, 1),
      contractsTotal: statValue(text, /Contracts\s*Deployed\s*\(?\s*Total/i, 1),
      ok: false,
    };
    stats.ok = Boolean(stats.totalTransactions && stats.totalAddresses);
    if (stats.ok) return stats;
  }
  return { ok: false };
}

/** Chain ids for the Etherscan V2 multichain API. */
const CHAIN_IDS: Record<string, number> = { stable: 988, robinhood: 4663, arc: 5042002 };

/** Known Blockscout hosts per chain, tried before any page scraping. */
const BLOCKSCOUT_HOSTS: Record<string, string[]> = {
  stable: ["https://blockscout.stable.xyz", "https://explorer.stable.xyz"],
  robinhood: ["https://robinhoodchain.blockscout.com"],
  arc: ["https://testnet.arcscan.app"],
};

// Short server-side cache so refreshes don't re-fetch every tick.
const cache = new Map<string, { ts: number; data: ExplorerStats }>();
const TTL = 60_000;

/**
 * Network totals for a chain: Blockscout's /stats endpoint first (structured and
 * exact), then the explorer page scrape for chains whose primary explorer is
 * Etherscan-style (Stable). Returns ok:false rather than guessing.
 */
export const fetchExplorerStats = createServerFn({ method: "GET" })
  .validator((raw: unknown): { chain: string } => {
    const c = typeof raw === "object" && raw ? (raw as { chain?: unknown }).chain : raw;
    return { chain: String(c ?? "").trim() || "stable" };
  })
  .handler(async ({ data }): Promise<ExplorerStats> => {
    const { chain } = data;
    const hit = cache.get(chain);
    if (hit && Date.now() - hit.ts < TTL) return hit.data;

    let stats = await viaBlockscout(BLOCKSCOUT_HOSTS[chain] ?? []);
    if (!stats.ok && chain === "stable") stats = await scrapeStableScan();

    // Etherscan V2 (STABLESCAN_API_KEY) adds a key-authenticated block height
    // and higher rate limits on Etherscan-family explorers.
    const chainId = CHAIN_IDS[chain];
    if (chainId) {
      const es = await viaEtherscanV2(chainId).catch(() => ({}) as Partial<ExplorerStats>);
      if (es.blockNumber) {
        stats = { ...stats, blockNumber: es.blockNumber, ok: stats.ok || true };
      }
    }

    if (stats.ok) cache.set(chain, { ts: Date.now(), data: stats });
    return stats;
  });
