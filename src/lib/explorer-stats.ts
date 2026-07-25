import { createServerFn } from "@tanstack/react-start";
import { proxiedFetchText } from "./net";

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
  ok: boolean;
}

/** "10.95 M" | "97,059" | "1.2B" → number. */
function parseMetric(raw: string): number {
  const m = raw
    .trim()
    .replace(/,/g, "")
    .match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase()] ?? 1;
  return isFinite(n) ? n * mult : 0;
}

/** Pull the number that follows a label in the scraped page text. */
function afterLabel(text: string, label: RegExp): number | undefined {
  const re = new RegExp(label.source + String.raw`[^\d]*([\d.,]+\s*[KMB]?)`, "i");
  const m = text.match(re);
  return m ? parseMetric(m[1]) : undefined;
}

async function scrapeStableScan(): Promise<ExplorerStats> {
  // The Etherscan-style overview stats live on the charts/stats page.
  const key = apiKey();
  const pages = [
    `https://stablescan.xyz/charts?apikey=${key}`,
    "https://stablescan.xyz/charts",
    "https://stablescan.xyz",
  ];
  for (const url of pages) {
    const text = await proxiedFetchText(url, { timeoutMs: 12_000 });
    if (!text) continue;
    const stats: ExplorerStats = {
      totalAddresses: afterLabel(text, /Addresses\s*\(?Total\)?/),
      totalTransactions: afterLabel(text, /Transactions\s*\(?Total\)?/),
      newAddresses24h: afterLabel(text, /New\s*Addresses\s*\(?24H?\)?/),
      transactions24h: afterLabel(text, /Transactions\s*\(?24H?\)?/),
      tokensTotal: afterLabel(text, /Tokens\s*\(?Total\)?/),
      contractsTotal: afterLabel(text, /Contracts\s*Deployed\s*\(?Total\)?/),
      ok: false,
    };
    stats.ok = Boolean(stats.totalTransactions || stats.totalAddresses);
    if (stats.ok) return stats;
  }
  return { ok: false };
}

// Short server-side cache so refreshes don't re-scrape every tick.
let cache: { ts: number; data: ExplorerStats } | null = null;
const TTL = 60_000;

export const fetchStableScanStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<ExplorerStats> => {
    if (cache && Date.now() - cache.ts < TTL) return cache.data;
    const data = await scrapeStableScan();
    if (data.ok) cache = { ts: Date.now(), data };
    return data;
  },
);
