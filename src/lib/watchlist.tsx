import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// A tiny localStorage-backed watchlist (starred token addresses), shared app-wide.

const STORAGE_KEY = "ustonks.watchlist";

interface WatchlistValue {
  ids: string[];
  has: (address: string) => boolean;
  toggle: (address: string) => void;
  count: number;
}

const WatchlistCtx = createContext<WatchlistValue | null>(null);

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => setIds(read()), []);

  const toggle = useCallback((address: string) => {
    const a = address.toLowerCase();
    setIds((prev) => {
      const next = prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a];
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo<WatchlistValue>(
    () => ({
      ids,
      has: (address: string) => ids.includes(address.toLowerCase()),
      toggle,
      count: ids.length,
    }),
    [ids, toggle],
  );

  return <WatchlistCtx.Provider value={value}>{children}</WatchlistCtx.Provider>;
}

export function useWatchlist(): WatchlistValue {
  const ctx = useContext(WatchlistCtx);
  if (!ctx) throw new Error("useWatchlist must be used within <WatchlistProvider>");
  return ctx;
}
