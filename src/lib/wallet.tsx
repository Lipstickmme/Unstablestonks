import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createWalletClient, custom, type WalletClient } from "viem";
import { CHAINS, type ChainConfig } from "@/config/chains";
import { toViemChain } from "./data/rpc";

// Minimal, dependency-light EIP-1193 wallet layer. Works with any injected
// provider (MetaMask, Rabby, mobile in-app browsers, Coinbase Wallet…). Mobile
// browsers without an injected provider get a clear prompt to open in a wallet app.

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

interface WalletState {
  address: `0x${string}` | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  hasProvider: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  ensureChain: (cfg: ChainConfig) => Promise<boolean>;
  getWalletClient: (cfg: ChainConfig) => WalletClient | null;
}

const WalletCtx = createContext<WalletState | null>(null);

function getProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return window.ethereum;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasProvider, setHasProvider] = useState(false);

  useEffect(() => {
    const p = getProvider();
    setHasProvider(Boolean(p));
    if (!p) return;

    // Reflect existing connection without prompting.
    p.request({ method: "eth_accounts" })
      .then((accts) => {
        const a = (accts as string[])[0];
        if (a) setAddress(a as `0x${string}`);
      })
      .catch(() => {});
    p.request({ method: "eth_chainId" })
      .then((id) => setChainId(parseInt(id as string, 16)))
      .catch(() => {});

    const onAccounts = (...args: unknown[]) => {
      const accts = args[0] as string[];
      setAddress((accts?.[0] as `0x${string}`) ?? null);
    };
    const onChain = (...args: unknown[]) => setChainId(parseInt(args[0] as string, 16));
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const p = getProvider();
    if (!p) {
      setError(
        "No wallet found. Open in a wallet app (MetaMask, Rabby, Coinbase Wallet) or install an extension.",
      );
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accts = (await p.request({ method: "eth_requestAccounts" })) as string[];
      setAddress((accts[0] as `0x${string}`) ?? null);
      const id = (await p.request({ method: "eth_chainId" })) as string;
      setChainId(parseInt(id, 16));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  const ensureChain = useCallback(async (cfg: ChainConfig): Promise<boolean> => {
    const p = getProvider();
    if (!p) return false;
    const hexId = `0x${cfg.id.toString(16)}`;
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
      return true;
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code === 4902) {
        try {
          await p.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexId,
                chainName: cfg.name,
                nativeCurrency: cfg.nativeCurrency,
                rpcUrls: cfg.rpcUrls,
                blockExplorerUrls: [cfg.explorerUrl],
              },
            ],
          });
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }, []);

  const getWalletClient = useCallback(
    (cfg: ChainConfig): WalletClient | null => {
      const p = getProvider();
      if (!p || !address) return null;
      return createWalletClient({
        account: address,
        chain: toViemChain(cfg),
        transport: custom(p),
      });
    },
    [address],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      chainId,
      connecting,
      error,
      hasProvider,
      connect,
      disconnect,
      ensureChain,
      getWalletClient,
    }),
    [
      address,
      chainId,
      connecting,
      error,
      hasProvider,
      connect,
      disconnect,
      ensureChain,
      getWalletClient,
    ],
  );

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error("useWallet must be used within <WalletProvider>");
  return ctx;
}

export { CHAINS };
