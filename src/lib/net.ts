// Resilient fetch with CORS/edge proxy fallbacks.
//
// New-chain explorers and indexers are flaky and sometimes block cross-origin
// browser requests. We always try the origin directly first (fast, no third
// party), then fall back through public proxies so data still populates:
//   1. api.cors.lol   — ?url=<encoded>
//   2. proxy.cors.sh  — /<url>
//   3. r.jina.ai      — /<url>  (reader; returns the body as text)
// All are best-effort and free; if every hop fails we return null and the UI
// shows an honest empty state rather than fabricated data.

type ProxyBuilder = (url: string) => string;

// All key-less. proxy.cors.sh is deliberately absent: it requires an
// `x-cors-api-key` header and 403s without one, so it only ever burned a hop.
const PROXIES: ProxyBuilder[] = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
  (u) => `https://r.jina.ai/${u}`,
];

const IS_SERVER = typeof window === "undefined";

// Explorers behind Cloudflare (StableScan among them) reject requests that
// carry a runtime's default fetch User-Agent. Browsers forbid setting these
// headers — the call would be a silent no-op — so we only add them on the
// server, where they're what makes the direct hop succeed at all.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker, per host.
//
// This is what made Stable feel slow next to Robinhood. Robinhood's Blockscout
// answers on the first hop; Stable's configured explorer host does not resolve
// at all, and every single call to it walked the origin plus five proxies, each
// waiting out its own timeout — up to forty seconds for a request that was
// never going to succeed. The directory lane awaits those calls, so the whole
// token list sat behind a host that was already known to be dead.
//
// After a few consecutive failures a host is skipped outright for a cooldown.
// A dead origin fails in microseconds instead of forty seconds, and the sources
// that DO work paint immediately. The cooldown is short so a host that recovers
// is picked back up on its own, and one success clears the record entirely.
// ─────────────────────────────────────────────────────────────────────────────

const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 3 * 60_000;

const breaker = new Map<string, { fails: number; openUntil: number }>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isOpen(host: string): boolean {
  const s = breaker.get(host);
  if (!s) return false;
  if (s.openUntil > Date.now()) return true;
  // Cooldown elapsed — let one request through to see if it recovered.
  if (s.openUntil) breaker.set(host, { fails: FAIL_THRESHOLD - 1, openUntil: 0 });
  return false;
}

function noteFailure(host: string): void {
  const s = breaker.get(host) ?? { fails: 0, openUntil: 0 };
  const fails = s.fails + 1;
  breaker.set(host, {
    fails,
    openUntil: fails >= FAIL_THRESHOLD ? Date.now() + COOLDOWN_MS : 0,
  });
}

function noteSuccess(host: string): void {
  if (breaker.has(host)) breaker.delete(host);
}

/** Hosts currently being skipped — surfaced by the diagnostics readout. */
export function trippedHosts(): string[] {
  const now = Date.now();
  return [...breaker.entries()].filter(([, s]) => s.openUntil > now).map(([h]) => h);
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<Response | null> {
  const host = hostOf(url);
  if (isOpen(host)) return null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: IS_SERVER ? { ...BROWSER_HEADERS, ...headers } : headers,
      redirect: "follow",
    });
    // 5xx and 429 are the host's problem and worth backing off from. A 404 is
    // an answer — the host is alive and simply doesn't have that resource, so
    // it must not count against it.
    if (res.status >= 500 || res.status === 429) noteFailure(host);
    else noteSuccess(host);
    return res;
  } catch {
    // DNS failure, connection refused, timeout — the host is not answering.
    noteFailure(host);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    // r.jina.ai can wrap the body in prose — grab the first JSON object/array.
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * How many proxies are worth trying for this URL.
 *
 * A host that has been failing is usually failing for everyone — bad DNS, dead
 * service — and relaying to it through five proxies just multiplies the wait.
 * One proxy still gets tried, because the other explanation for a dead origin
 * is that it blocks our IP or our CORS, and a proxy fixes exactly that.
 */
function proxyBudget(url: string, requested?: number): ProxyBuilder[] {
  const capped = requested == null ? PROXIES : PROXIES.slice(0, Math.max(0, requested));
  return isOpen(hostOf(url)) ? capped.slice(0, 1) : capped;
}

export async function proxiedFetchJson<T>(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T | null> {
  const timeoutMs = opts.timeoutMs ?? 7_000;
  const targets = [url, ...proxyBudget(url).map((p) => p(url))];
  for (const target of targets) {
    const res = await fetchWithTimeout(target, timeoutMs, opts.headers);
    if (!res || !res.ok) continue;
    const text = await res.text().catch(() => "");
    if (!text) continue;
    const json = extractJson<T>(text);
    if (json !== null) return json;
  }
  return null;
}

export async function proxiedFetchText(
  url: string,
  opts: {
    timeoutMs?: number;
    headers?: Record<string, string>;
    /**
     * How many proxy fallbacks to try after the origin. Every hop costs a full
     * timeout, so a caller working against a deadline (the X crawl) can cap the
     * worst case instead of walking all five.
     */
    hops?: number;
  } = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const targets = [url, ...proxyBudget(url, opts.hops).map((p) => p(url))];
  for (const target of targets) {
    const res = await fetchWithTimeout(target, timeoutMs, opts.headers);
    if (!res || !res.ok) continue;
    const text = await res.text().catch(() => "");
    if (text) return text;
  }
  return null;
}
