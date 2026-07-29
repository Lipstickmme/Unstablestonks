import { createServerFn } from "@tanstack/react-start";
import { proxiedFetchText } from "./net";

// ─────────────────────────────────────────────────────────────────────────────
// X (Twitter) social intelligence.
//
// Given a contract address (or symbol), find real posts on X that mention it and
// estimate reach. Runs server-side (via createServerFn) so it can bypass browser
// CORS and use a secret API key when one is configured.
//
// Provider priority (all REAL sources — no fabricated posts):
//   1. Official X API v2 recent search, when a bearer token is set. Authoritative:
//      true impression_count + engagement. Several env names are accepted, since
//      a mis-named secret is indistinguishable from an outage. This is the ONLY
//      source that can report reach — everything below counts posts.
//   2. An open crawl of public search engines scoped to x.com, and Nitter search
//      RSS, RACED against each other. Chaining them was the bug: exhausting
//      Nitter's seven mostly-dead mirrors ate the whole budget before the crawl
//      ever ran, so the panel always reported a timeout.
//   3. Nothing reachable → an empty, clearly-labelled result. The UI says "no
//      signal" rather than inventing tweets or a score.
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
  source: "x-api" | "nitter" | "crawler" | "unavailable";
  ok: boolean;
  note?: string;
}

/**
 * Fetch budget for a single server-function invocation.
 *
 * The crawl runs on Cloudflare Workers, which caps subrequests per invocation
 * (50 on the free plan). Unbounded, one batch could ask for 8 queries x (4
 * search sources + 3 Nitter mirrors) x 3 proxy hops = ~170 fetches — the whole
 * invocation is killed, and the panel shows nothing at all rather than a
 * partial result. Every hop now draws from a shared budget and the sources stop
 * when it runs out.
 */
interface Budget {
  left: number;
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

// Free, key-less mirrors. More instances = more resilience to rate limits and
// dead hosts; each is tried in turn (and each through the CORS/reader proxies).
const DEFAULT_NITTER = [
  "https://nitter.net",
  "https://nitter.poast.org",
  "https://nitter.privacyredirect.com",
  "https://nitter.tiekoetter.com",
  "https://nitter.space",
  "https://xcancel.com",
  "https://lightbrd.com",
];

function heatFrom(mentions: number, impressions: number, unique: number): number {
  // No posts means no heat — never let a zero-signal crawl score above 0.
  if (mentions <= 0) return 0;
  // Log-scaled blend so a handful of posts still registers but virality dominates.
  // When reach is unknown (crawler sources) mentions + unique accounts carry it.
  const m = Math.log10(1 + mentions) / Math.log10(1 + 200); // ~200 posts => 1
  const i = Math.log10(1 + impressions) / Math.log10(1 + 2_000_000); // ~2M views => 1
  const u = Math.log10(1 + unique) / Math.log10(1 + 100);
  if (impressions <= 0) return Math.min(100, Math.round((0.65 * m + 0.35 * u) * 100));
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

async function viaNitter(
  query: string,
  instances: string[],
  budget: Budget,
): Promise<XSocialResult | null> {
  // Two mirrors, two hops each: most public Nitter instances are long dead, and
  // exhausting the list is what used to burn the entire crawl budget.
  for (const base of instances.slice(0, 2)) {
    if (budget.left <= 0) return null;
    budget.left -= 2;
    try {
      const xml = await proxiedFetchText(
        `${base}/search/rss?f=tweets&q=${encodeURIComponent(query)}`,
        {
          timeoutMs: 5_000,
          hops: 2,
          headers: { Accept: "application/rss+xml, application/xml, text/xml" },
        },
      );
      if (!xml) continue;
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
    }
  }
  return null;
}

/** Reserved x.com path segments that are never a user handle. */
const RESERVED_HANDLES = new Set([
  "search",
  "i",
  "home",
  "explore",
  "intent",
  "share",
  "hashtag",
  "notifications",
  "messages",
  "settings",
  "compose",
  "login",
  "signup",
]);

/**
 * How far from a status link the contract address must appear for the link to
 * count as a post about it. One search result — snippet, title and URL — sits
 * comfortably inside this.
 */
const PROXIMITY = 1500;

/** X's snowflake epoch — post IDs carry their own creation timestamp. */
const X_EPOCH = 1_288_834_974_657;

/**
 * Decode a post's real creation time from its snowflake ID. Doubles as a
 * validity check: any digit run that doesn't decode to a plausible date is not a
 * post ID, so junk numbers scraped off a page can never inflate the count.
 */
function tsFromStatusId(id: string): number | null {
  try {
    const ms = Number((BigInt(id) >> 22n) + BigInt(X_EPOCH));
    if (!isFinite(ms)) return null;
    if (ms <= X_EPOCH || ms > Date.now() + 86_400_000) return null;
    return ms;
  } catch {
    return null;
  }
}

/**
 * Last-resort free crawler: read X's own live-search page and public search
 * engines scoped to x.com through the reader proxy, and collect the DISTINCT
 * posts that link to the contract address.
 *
 * A post only counts if we find a real `x.com/<handle>/status/<id>` link whose
 * snowflake ID decodes to a plausible timestamp. We deliberately do NOT count
 * literal occurrences of the address in the page text — every search page echoes
 * the query back in its own markup (search box, title, canonical URL), which
 * previously scored one phantom mention for every token and pinned the heat
 * score at a constant value. No links found now means no signal, and the panel
 * says so.
 *
 * All sources are read and unioned rather than short-circuiting on the first
 * hit, so the count reflects everything reachable. Reach/impressions stay 0
 * (unknowable without the API) and the UI reports the source honestly.
 */
async function viaOpenCrawl(query: string, budget: Budget): Promise<XSocialResult | null> {
  const encoded = encodeURIComponent(`"${query}"`);
  const sources = [
    `https://duckduckgo.com/html/?q=${encoded}+site%3Ax.com`,
    `https://lite.duckduckgo.com/lite/?q=${encoded}+site%3Atwitter.com`,
    `https://www.bing.com/search?q=${encoded}+site%3Ax.com`,
  ];

  // id → post. Keyed by status id so the same post seen on two engines counts once.
  const found = new Map<string, XPost>();

  const needle = query.toLowerCase();

  for (const url of sources) {
    if (budget.left <= 0) break;
    budget.left -= 2;
    const text = await proxiedFetchText(url, { timeoutMs: 6_000, hops: 1 });
    if (!text || text.length < 200) continue;
    const haystack = text.toLowerCase();

    for (const m of text.matchAll(
      /(?:x|twitter|nitter[\w.-]*)\.com\/([A-Za-z0-9_]{2,15})\/status(?:es)?\/(\d{15,25})/gi,
    )) {
      const handle = m[1];
      const id = m[2];
      if (RESERVED_HANDLES.has(handle.toLowerCase())) continue;
      if (found.has(id)) continue;
      const ts = tsFromStatusId(id);
      if (ts == null) continue;

      // The link must sit in a result block that actually mentions the contract.
      // Search pages carry a handful of x.com/<handle>/status/<id> links that
      // have nothing to do with the query — nav, promos, "people also viewed" —
      // and counting one of those gave EVERY token exactly one mention and one
      // account, which is the constant 14 heat score.
      const at = m.index ?? 0;
      const window = haystack.slice(Math.max(0, at - PROXIMITY), at + PROXIMITY);
      if (!window.includes(needle)) continue;

      found.set(id, {
        handle: `@${handle}`,
        text: "",
        url: `https://x.com/${handle}/status/${id}`,
        ts,
        impressions: 0,
        engagement: 0,
      });
    }
  }

  if (found.size === 0) return null;

  const posts = [...found.values()].sort((a, b) => b.ts - a.ts);
  const unique = new Set(posts.map((p) => p.handle.toLowerCase())).size;
  return {
    query,
    posts: posts.slice(0, 20),
    mentions: posts.length,
    uniqueAccounts: unique,
    impressions: 0,
    engagement: 0,
    heat: heatFrom(posts.length, 0, unique),
    source: "crawler",
    ok: true,
    note: "Posts found by public crawl — reach unavailable without X_BEARER_TOKEN.",
  };
}

/**
 * Bearer token for the official X API. Several names are accepted because the
 * deploy secret is just as likely to be called TWITTER_BEARER_TOKEN or
 * X_API_BEARER_TOKEN, and a name mismatch looks exactly like "the API is down".
 */
function bearerToken(): string | undefined {
  for (const name of [
    "X_BEARER_TOKEN",
    "TWITTER_BEARER_TOKEN",
    "X_API_BEARER_TOKEN",
    "X_API_KEY",
    "TWITTER_API_KEY",
  ]) {
    const v = serverEnv(name);
    if (v) return v;
  }
  return undefined;
}

/** Resolve to the first source that returns real data; null when all fail. */
function firstOk<T>(promises: Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (!pending) {
      resolve(null);
      return;
    }
    for (const p of promises) {
      p.then(
        (v) => {
          if (v) resolve(v);
          else if (--pending === 0) resolve(null);
        },
        () => {
          if (--pending === 0) resolve(null);
        },
      );
    }
  });
}

async function crawlOne(query: string, budget: Budget): Promise<XSocialResult> {
  const bearer = bearerToken();
  if (bearer) {
    const r = await viaXApi(query, bearer);
    if (r) return r;
  }

  const instances =
    serverEnv("X_NITTER_INSTANCES")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? DEFAULT_NITTER;

  // Raced, not chained. Walking Nitter's mirrors first — seven instances, each
  // through six fetch hops — consumed the whole deadline before the open crawl
  // ever ran, which is why the panel reported "timed out" instead of a result.
  const found = await firstOk([viaOpenCrawl(query, budget), viaNitter(query, instances, budget)]);
  if (found) return found;

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
      ? "No recent posts found for this contract."
      : budget.left <= 0
        ? "Crawl budget spent before a source answered. Add X_BEARER_TOKEN for reliable data."
        : "No X posts found for this contract, and no bearer token is set. Add X_BEARER_TOKEN for authoritative reach data.",
  };
}

// Server-side result cache so dashboard refreshes don't hammer X/Nitter.
// Results are held long enough that a rotating scan keeps the whole list warm:
// a token crawled ten minutes ago still has a real score while the rotation
// works through the rest.
const CACHE_TTL_MS = 10 * 60_000;
const crawlCache = new Map<string, { ts: number; result: XSocialResult }>();

/** Hard ceiling so a slow/unreachable X source can never hang the UI card. */
function withDeadline(query: string, ms: number, budget: Budget): Promise<XSocialResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: XSocialResult) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    const timer = setTimeout(
      () =>
        finish({
          query,
          posts: [],
          mentions: 0,
          uniqueAccounts: 0,
          impressions: 0,
          engagement: 0,
          heat: 0,
          source: "unavailable",
          ok: false,
          note: "X sources didn't respond in time. Set X_BEARER_TOKEN for reliable, authoritative data.",
        }),
      ms,
    );
    crawlOne(query, budget).then(
      (r) => {
        clearTimeout(timer);
        finish(r);
      },
      () => clearTimeout(timer),
    );
  });
}

async function crawlCached(query: string, budget: Budget): Promise<XSocialResult> {
  const hit = crawlCache.get(query);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;
  const result = await withDeadline(query, 22_000, budget);
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
  .handler(async ({ data }): Promise<XSocialResult> => crawlCached(data.query, { left: 12 }));

/**
 * Batch crawl for the dashboard: heat for up to 8 contract addresses. Runs in
 * parallel (each with its own deadline + cache) so the card resolves quickly
 * instead of stacking timeouts sequentially. The caller rotates through the
 * list, so every token gets scored over a few cycles rather than only the top
 * few being crawled forever.
 */
export const searchXSocialBatch = createServerFn({ method: "GET" })
  .validator((raw: unknown): { queries: string[] } => {
    const q = typeof raw === "object" && raw ? (raw as { queries?: unknown }).queries : raw;
    const queries = (Array.isArray(q) ? q : [])
      .map((v) => String(v ?? "").trim())
      .filter((v) => v.length > 0)
      .slice(0, 4);
    if (!queries.length) throw new Error("queries required");
    return { queries };
  })
  .handler(async ({ data }): Promise<Record<string, XSocialResult>> => {
    // One budget shared across the batch — the cap is per invocation, not per
    // query, so splitting it evenly is what keeps the whole call alive.
    const budget: Budget = { left: 24 };
    const results = await Promise.all(data.queries.map((q) => crawlCached(q, budget)));
    const out: Record<string, XSocialResult> = {};
    data.queries.forEach((q, i) => {
      out[q] = results[i];
    });
    return out;
  });
