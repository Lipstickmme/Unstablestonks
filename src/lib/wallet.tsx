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

// EIP-1193 + EIP-6963 wallet layer. Discovers every injected wallet (MetaMask,
// Rabby, Coinbase, in-app mobile browsers…) via the 6963 announce protocol, with
// a window.ethereum fallback. No external wallet SDK, so nothing to break the build.

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip6963Detail {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
  }
}

export interface DiscoveredWallet {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

interface WalletState {
  address: `0x${string}` | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  /** Any injected wallet is reachable. */
  hasProvider: boolean;
  /** Wallets announced via EIP-6963 (for a picker). */
  wallets: DiscoveredWallet[];
  /** Name of the connected wallet, when known. */
  activeWalletName: string | null;
  /** Connect. Pass a specific wallet from `wallets`, else the default is used. */
  connect: (wallet?: DiscoveredWallet) => Promise<`0x${string}` | null>;
  disconnect: () => void;
  ensureChain: (cfg: ChainConfig) => Promise<boolean>;
  getWalletClient: (cfg: ChainConfig) => WalletClient | null;
  /** Raw active provider — needed to build SDK signers. */
  getProvider: () => Eip1193Provider | undefined;
}

const WalletCtx = createContext<WalletState | null>(null);

function windowProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const eth = window.ethereum;
  if (!eth) return undefined;
  // Some environments expose multiple providers under window.ethereum.providers.
  if (Array.isArray(eth.providers) && eth.providers.length) return eth.providers[0];
  return eth;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [active, setActive] = useState<DiscoveredWallet | null>(null);

  // EIP-6963 discovery.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<Eip6963Detail>).detail;
      if (!detail?.info || !detail.provider) return;
      setWallets((prev) =>
        prev.some((w) => w.info.uuid === detail.info.uuid) ? prev : [...prev, detail],
      );
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () =>
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
  }, []);

  const resolveProvider = useCallback(
    (wallet?: DiscoveredWallet): Eip1193Provider | undefined =>
      wallet?.provider ?? active?.provider ?? wallets[0]?.provider ?? windowProvider(),
    [active, wallets],
  );

  // Reflect an existing connection + subscribe to changes on the active provider.
  useEffect(() => {
    const p = resolveProvider();
    if (!p) return;
    p.request({ method: "eth_accounts" })
      .then((accts) => {
        const a = (accts as string[])[0];
        if (a) setAddress(a as `0x${string}`);
      })
      .catch(() => {});
    p.request({ method: "eth_chainId" })
      .then((id) => setChainId(parseInt(id as string, 16)))
      .catch(() => {});

    const onAccounts = (...args: unknown[]) =>
      setAddress(((args[0] as string[])?.[0] as `0x${string}`) ?? null);
    const onChain = (...args: unknown[]) => setChainId(parseInt(args[0] as string, 16));
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, [resolveProvider]);

  const connect = useCallback(
    async (wallet?: DiscoveredWallet): Promise<`0x${string}` | null> => {
      const provider = wallet?.provider ?? resolveProvider();
      if (!provider) {
        setError(
          "No wallet detected. Install MetaMask/Rabby, or on mobile open this site inside your wallet app's browser.",
        );
        return null;
      }
      setConnecting(true);
      setError(null);
      try {
        const accts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
        const addr = (accts[0] as `0x${string}`) ?? null;
        setAddress(addr);
        const id = (await provider.request({ method: "eth_chainId" })) as string;
        setChainId(parseInt(id, 16));
        if (wallet) setActive(wallet);
        else {
          const match = wallets.find((w) => w.provider === provider);
          if (match) setActive(match);
        }
        return addr;
      } catch (e) {
        const code = (e as { code?: number })?.code;
        setError(
          code === 4001
            ? "Connection request rejected in your wallet."
            : e instanceof Error
              ? e.message
              : "Failed to connect wallet.",
        );
        return null;
      } finally {
        setConnecting(false);
      }
    },
    [resolveProvider, wallets],
  );

  const disconnect = useCallback(() => {
    setAddress(null);
    setActive(null);
  }, []);

  const ensureChain = useCallback(
    async (cfg: ChainConfig): Promise<boolean> => {
      const p = resolveProvider();
      if (!p) return false;
      const hexId = `0x${cfg.id.toString(16)}`;
      try {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
        setChainId(cfg.id);
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
            setChainId(cfg.id);
            return true;
          } catch {
            return false;
          }
        }
        return false;
      }
    },
    [resolveProvider],
  );

  const getWalletClient = useCallback(
    (cfg: ChainConfig): WalletClient | null => {
      const p = resolveProvider();
      if (!p || !address) return null;
      return createWalletClient({
        account: address,
        chain: toViemChain(cfg),
        transport: custom(p),
      });
    },
    [resolveProvider, address],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      chainId,
      connecting,
      error,
      hasProvider: wallets.length > 0 || Boolean(windowProvider()),
      wallets,
      activeWalletName: active?.info.name ?? null,
      connect,
      disconnect,
      ensureChain,
      getWalletClient,
      getProvider: () => resolveProvider(),
    }),
    [
      address,
      chainId,
      connecting,
      error,
      wallets,
      active,
      connect,
      disconnect,
      ensureChain,
      getWalletClient,
      resolveProvider,
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
