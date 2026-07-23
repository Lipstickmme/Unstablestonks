import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CHAINS,
  DEFAULT_CHAIN,
  getChain,
  isChainKey,
  type ChainConfig,
  type ChainKey,
} from "@/config/chains";

const STORAGE_KEY = "ustonks.chain";

interface ChainContextValue {
  chainKey: ChainKey;
  chain: ChainConfig;
  setChainKey: (key: ChainKey) => void;
}

const ChainContext = createContext<ChainContextValue | null>(null);

function readStored(): ChainKey {
  if (typeof window === "undefined") return DEFAULT_CHAIN;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (isChainKey(v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_CHAIN;
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const [chainKey, setChainKeyState] = useState<ChainKey>(DEFAULT_CHAIN);

  // Hydrate from localStorage on the client after mount (SSR-safe).
  useEffect(() => {
    setChainKeyState(readStored());
  }, []);

  // Reflect the active chain's accent on the document root so the whole UI reskins.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--primary", CHAINS[chainKey].accent);
    document.documentElement.style.setProperty("--ring", CHAINS[chainKey].accent);
    document.documentElement.setAttribute("data-chain", chainKey);
  }, [chainKey]);

  const setChainKey = (key: ChainKey) => {
    setChainKeyState(key);
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* ignore */
    }
  };

  const value = useMemo<ChainContextValue>(
    () => ({ chainKey, chain: getChain(chainKey), setChainKey }),
    [chainKey],
  );

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export function useChain(): ChainContextValue {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error("useChain must be used within <ChainProvider>");
  return ctx;
}
