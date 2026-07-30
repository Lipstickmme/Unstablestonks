// ─────────────────────────────────────────────────────────────────────────────
// Shared key-value store (Upstash Redis over its REST API).
//
// WHY THIS AND NOT THE OTHERS, on a free Vercel account:
//
//   Upstash Redis   256 MB, 500k commands/month, 10 GB transfer. Speaks HTTP,
//                   so it works from serverless and edge with no connection
//                   pool. Free tier fits everything here with room to spare.
//   Vercel Edge     100k reads but only 100 WRITES per month. Fine for config,
//   Config          useless for data that changes every few minutes.
//   Vercel Blob     1 GB storage, 10 GB transfer. Object storage — right for
//                   files, wrong for the small JSON reads this needs.
//   Neon Postgres   Free and capable, but relational overkill for key-value,
//                   and serverless Postgres needs pooling to behave.
//
// No SDK: two env vars and fetch. The Vercel Upstash integration injects both
// automatically, and everything here degrades to null when they're absent — the
// app keeps working off localStorage exactly as it does today.
// ─────────────────────────────────────────────────────────────────────────────

function env(key: string): string | undefined {
  try {
    const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env?.[key];
    return v && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function credentials(): { url: string; token: string } | null {
  // Names the Vercel ↔ Upstash integration sets, with the KV_* aliases Vercel
  // used for its own store so an existing project doesn't need renaming.
  const url = env("UPSTASH_REDIS_REST_URL") ?? env("KV_REST_API_URL");
  const token = env("UPSTASH_REDIS_REST_TOKEN") ?? env("KV_REST_API_TOKEN");
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

/** True when a store is configured — callers use it to pick a fallback path. */
export function kvEnabled(): boolean {
  return credentials() !== null;
}

/**
 * Which env var supplied the URL, or undefined when none did.
 *
 * Reported by the health check: "credentials missing" and "credentials present
 * under the alias" are different problems with the same symptom, and knowing
 * which name was picked up turns a mystery into a one-line fix.
 */
export function kvSourceName(): string | undefined {
  if (env("UPSTASH_REDIS_REST_URL")) return "UPSTASH_REDIS_REST_URL";
  if (env("KV_REST_API_URL")) return "KV_REST_API_URL";
  return undefined;
}

type Command = (string | number)[];

/** Run one Redis command. Returns null when unconfigured or on any failure. */
async function command<T>(cmd: Command): Promise<T | null> {
  const creds = credentials();
  if (!creds) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6_000);
    const res = await fetch(creds.url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cmd),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: T; error?: string };
    if (body.error) return null;
    return (body.result ?? null) as T | null;
  } catch {
    // A store outage must never take the page down with it.
    return null;
  }
}

/** Run several commands in one round trip. */
async function pipeline<T>(cmds: Command[]): Promise<T[] | null> {
  const creds = credentials();
  if (!creds || !cmds.length) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`${creds.url}/pipeline`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cmds),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: T; error?: string }[];
    return body.map((r) => (r.error ? null : (r.result ?? null)) as T);
  } catch {
    return null;
  }
}

/** Read and parse a JSON value. */
export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await command<string>(["GET", key]);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write a JSON value with a TTL in seconds. */
export async function kvSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await command(["SET", key, JSON.stringify(value), "EX", Math.max(1, Math.floor(ttlSeconds))]);
}

/** Increment a counter and return its new value. */
export async function kvIncr(key: string): Promise<number | null> {
  return command<number>(["INCR", key]);
}

/** Add to a set. Returns true when the member was new. */
export async function kvSetAdd(key: string, member: string): Promise<boolean | null> {
  const added = await command<number>(["SADD", key, member]);
  return added == null ? null : added === 1;
}

export { command as kvCommand, pipeline as kvPipeline };
