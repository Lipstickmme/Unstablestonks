// Tiny localStorage-backed cache so the terminal paints instantly on load with
// the last known list, then refreshes live in the background. Purely a display
// accelerator — every value is still real data we fetched earlier, and it's
// labelled stale until the live refresh lands.

const PREFIX = "ustonks.cache.";

interface Entry<T> {
  ts: number;
  data: T;
}

export function readCache<T>(key: string, maxAgeMs = 10 * 60_000): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as Entry<T>;
    if (!entry || Date.now() - entry.ts > maxAgeMs) return undefined;
    return entry.data;
  } catch {
    return undefined;
  }
}

export function writeCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* quota or private mode — caching is best-effort */
  }
}
