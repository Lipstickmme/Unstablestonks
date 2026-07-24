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

const PROXIES: ProxyBuilder[] = [
  (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
  (u) => `https://proxy.cors.sh/${u}`,
  (u) => `https://r.jina.ai/${u}`,
];

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal, headers });
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
  const timeoutMs = opts.timeoutMs ?? 11_000;
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
