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
