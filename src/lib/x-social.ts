import { createServerFn } from "@tanstack/react-start";

// ─────────────────────────────────────────────────────────────────────────────
// X (Twitter) social intelligence.
//
// Given a contract address (or symbol), find real posts on X that mention it and
// estimate reach. Runs server-side (via createServerFn) so it can bypass browser
// CORS and use a secret API key when one is configured.
//
// Provider priority (all REAL sources — no fabricated posts):
//   1. Official X API v2 recent search — set X_BEARER_TOKEN. Authoritative, gives
//      true impression_count + engagement. Best signal.
//   2. Nitter search RSS — key-less fallback. Set X_NITTER_INSTANCES (comma list)
//      or rely on the built-in instances. Gives real posts; engagement unknown.
//   3. If nothing is reachable we return an empty, clearly-labelled result. The UI
//      shows "no signal / source unavailable" rather than inventing tweets.
// ─────────────────────────────────────────────────────────────────────────────

export interface XPost {
  handle: string;
  text: string;
  url: string;
  ts: number;
  impressions: number;
  engagement: number;
}

export interface XSocialResult {
  query: string;
  posts: XPost[];
  mentions: number;
  uniqueAccounts: number;
  impressions: number;
  engagement: number;
  /** 0..100 heat score derived from real volume/reach. */
  heat: number;
  source: "x-api" | "nitter" | "unavailable";
  ok: boolean;
  note?: string;
}

function serverEnv(key: string): string | undefined {
  try {
    const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env?.[key];
    return v && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_NITTER = [
  "https://nitter.net",
  "https://nitter.poast.org",
  "https://nitter.privacyredirect.com",
];

function heatFrom(mentions: number, impressions: number, unique: number): number {
  // Log-scaled blend so a handful of posts still registers but virality dominates.
  const m = Math.log10(1 + mentions) / Math.log10(1 + 200); // ~200 posts => 1
  const i = Math.log10(1 + impressions) / Math.log10(1 + 2_000_000); // ~2M views => 1
  const u = Math.log10(1 + unique) / Math.log10(1 + 100);
  return Math.min(100, Math.round((0.35 * m + 0.45 * i + 0.2 * u) * 100));
}

interface XApiTweet {
  text?: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    impression_count?: number;
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    quote_count?: number;
  };
}

async function viaXApi(query: string, token: string): Promise<XSocialResult | null> {
  const url =
    "https://api.x.com/2/tweets/search/recent?max_results=50" +
    "&tweet.fields=public_metrics,created_at,author_id&expansions=author_id&user.fields=username" +
    `&query=${encodeURIComponent(query + " -is:retweet")}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: XApiTweet[];
      includes?: { users?: { id: string; username: string }[] };
    };
    const users = new Map((body.includes?.users ?? []).map((u) => [u.id, u.username]));
    const tweets = body.data ?? [];
    const posts: XPost[] = tweets.map((tw) => {
      const pm = tw.public_metrics ?? {};
      const handle = users.get(tw.author_id ?? "") ?? "unknown";
      return {
        handle: `@${handle}`,
        text: tw.text ?? "",
        url: `https://x.com/${handle}/status/`,
        ts: tw.created_at ? new Date(tw.created_at).getTime() : Date.now(),
        impressions: pm.impression_count ?? 0,
        engagement:
          (pm.like_count ?? 0) +
          (pm.retweet_count ?? 0) +
          (pm.reply_count ?? 0) +
          (pm.quote_count ?? 0),
      };
    });
    const unique = new Set(posts.map((p) => p.handle)).size;
    const impressions = posts.reduce((s, p) => s + p.impressions, 0);
    const engagement = posts.reduce((s, p) => s + p.engagement, 0);
    return {
      query,
      posts: posts.sort((a, b) => b.engagement - a.engagement),
      mentions: posts.length,
      uniqueAccounts: unique,
      impressions,
      engagement,
      heat: heatFrom(posts.length, impressions, unique),
      source: "x-api",
      ok: true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function viaNitter(query: string, instances: string[]): Promise<XSocialResult | null> {
  for (const base of instances) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9_000);
    try {
      const res = await fetch(`${base}/search/rss?f=tweets&q=${encodeURIComponent(query)}`, {
        signal: ctrl.signal,
        headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = xml.split(/<item>/).slice(1);
      if (!items.length) continue;
      const posts: XPost[] = items.slice(0, 40).map((item) => {
        const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
        const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "";
        const creator = item.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/)?.[1] ?? "";
        const pub = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
        const cleanLink = decodeEntities(link).replace(/nitter\.[^/]+/, "x.com");
        return {
          handle: creator ? decodeEntities(creator) : "@unknown",
          text: decodeEntities(title),
          url: cleanLink,
          ts: pub ? new Date(pub).getTime() : Date.now(),
          impressions: 0,
          engagement: 0,
        };
      });
      const unique = new Set(posts.map((p) => p.handle)).size;
      return {
        query,
        posts,
        mentions: posts.length,
        uniqueAccounts: unique,
        impressions: 0,
        engagement: 0,
        heat: heatFrom(posts.length, 0, unique),
        source: "nitter",
        ok: true,
        note: "Reach unavailable via Nitter — add X_BEARER_TOKEN for true impressions.",
      };
    } catch {
      continue;
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

async function crawlOne(query: string): Promise<XSocialResult> {
  const bearer = serverEnv("X_BEARER_TOKEN");
  if (bearer) {
    const r = await viaXApi(query, bearer);
    if (r) return r;
  }

  const instances =
    serverEnv("X_NITTER_INSTANCES")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? DEFAULT_NITTER;
  const nitter = await viaNitter(query, instances);
  if (nitter) return nitter;

  return {
    query,
    posts: [],
    mentions: 0,
    uniqueAccounts: 0,
    impressions: 0,
    engagement: 0,
    heat: 0,
    source: "unavailable",
    ok: false,
    note: bearer
      ? "No recent posts found."
      : "X crawl source unreachable. Set X_BEARER_TOKEN (official API) or a reachable X_NITTER_INSTANCES for live social data.",
  };
}

// Server-side result cache so dashboard refreshes don't hammer X/Nitter.
const CACHE_TTL_MS = 120_000;
const crawlCache = new Map<string, { ts: number; result: XSocialResult }>();

async function crawlCached(query: string): Promise<XSocialResult> {
  const hit = crawlCache.get(query);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;
  const result = await crawlOne(query);
  // Only cache successful crawls — let failures retry sooner.
  if (result.ok) crawlCache.set(query, { ts: Date.now(), result });
  return result;
}

export const searchXSocial = createServerFn({ method: "GET" })
  .validator((raw: unknown): { query: string } => {
    const q = typeof raw === "object" && raw ? (raw as { query?: unknown }).query : raw;
    const query = String(q ?? "")
      .trim()
      .slice(0, 100);
    if (!query) throw new Error("query required");
    return { query };
  })
  .handler(async ({ data }): Promise<XSocialResult> => crawlCached(data.query));

/**
 * Batch crawl for the dashboard: heat for up to 5 contract addresses in one
 * request, sequential upstream calls + server-side cache to respect rate limits.
 */
export const searchXSocialBatch = createServerFn({ method: "GET" })
  .validator((raw: unknown): { queries: string[] } => {
    const q = typeof raw === "object" && raw ? (raw as { queries?: unknown }).queries : raw;
    const queries = (Array.isArray(q) ? q : [])
      .map((v) => String(v ?? "").trim())
      .filter((v) => v.length > 0)
      .slice(0, 5);
    if (!queries.length) throw new Error("queries required");
    return { queries };
  })
  .handler(async ({ data }): Promise<Record<string, XSocialResult>> => {
    const out: Record<string, XSocialResult> = {};
    for (const q of data.queries) {
      out[q] = await crawlCached(q);
    }
    return out;
  });
