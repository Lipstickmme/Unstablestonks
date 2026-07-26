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

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: IS_SERVER ? { ...BROWSER_HEADERS, ...headers } : headers,
      redirect: "follow",
    });
  } catch {
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

export async function proxiedFetchJson<T>(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T | null> {
  const timeoutMs = opts.timeoutMs ?? 7_000;
  const targets = [url, ...PROXIES.map((p) => p(url))];
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
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const targets = [url, ...PROXIES.map((p) => p(url))];
  for (const target of targets) {
    const res = await fetchWithTimeout(target, timeoutMs, opts.headers);
    if (!res || !res.ok) continue;
    const text = await res.text().catch(() => "");
    if (text) return text;
  }
  return null;
}
