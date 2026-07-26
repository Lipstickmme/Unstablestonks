import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /**
   * True when something asked the header's wallet picker to open. Dialogs set it
   * instead of running their own connect: one connect path, in one place, with
   * the full wallet list and mobile deep links behind it.
   */
  pickerOpen: boolean;
  requestPicker: () => void;
  clearPicker: () => void;
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

// Remember the last wallet the user connected (by EIP-6963 rdns) so we can
// silently re-attach to it on the next visit → one-tap (often zero-tap) reconnect.
const LAST_WALLET_KEY = "ustonks.wallet.rdns";
// Set when the user explicitly disconnects, so we don't auto-reflect the still-
// authorized account on the next render/visit.
const DISCONNECTED_KEY = "ustonks.wallet.off";

function readStore(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, val: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (val === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}

/** Coarse mobile-device check (touch UA), used only to steer the connect UX. */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export interface WalletDeepLink {
  name: string;
  /** Universal link that reopens the current page inside the wallet's dApp browser. */
  href: string;
}

/**
 * Deep links that reopen the current URL inside a mobile wallet's in-app browser.
 * On mobile there's no extension to inject a provider, so the reliable path is to
 * hand the user off to their wallet app, which then injects EIP-1193 for us.
 */
export function mobileWalletLinks(): WalletDeepLink[] {
  if (typeof window === "undefined") return [];
  const url = window.location.href;
  const host = window.location.host + window.location.pathname + window.location.search;
  const enc = encodeURIComponent(url);
  return [
    { name: "MetaMask", href: `https://metamask.app.link/dapp/${host}` },
    { name: "Coinbase Wallet", href: `https://go.cb-w.com/dapp?cb_url=${enc}` },
    { name: "Trust Wallet", href: `https://link.trustwallet.com/open_url?coin_id=60&url=${enc}` },
    { name: "Rainbow", href: `https://rnbwapp.com/dapp?url=${enc}` },
  ];
}

/** Where to send desktop users who have no injected wallet. */
export const DESKTOP_WALLET_LINKS: WalletDeepLink[] = [
  { name: "MetaMask", href: "https://metamask.io/download/" },
  { name: "Rabby", href: "https://rabby.io/" },
  { name: "Coinbase Wallet", href: "https://www.coinbase.com/wallet/downloads" },
];

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
    const lastRdns = readStore(LAST_WALLET_KEY);
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<Eip6963Detail>).detail;
      if (!detail?.info || !detail.provider) return;
      setWallets((prev) =>
        prev.some((w) => w.info.uuid === detail.info.uuid) ? prev : [...prev, detail],
      );
      // Prefer the previously-used wallet as the active provider on reload.
      if (lastRdns && detail.info.rdns === lastRdns) setActive(detail);
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
    // Honor an explicit disconnect: don't silently re-attach the authorized account.
    const suppressed = readStore(DISCONNECTED_KEY) === "1";
    if (!suppressed)
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

  // The in-flight connect, not a boolean. A second caller must be able to await
  // the SAME request rather than be dropped: the table's Buy button fires
  // connect() to keep the wallet prompt inside a user gesture, then the modal
  // that opens has its own Connect button — with a boolean guard that second
  // click returned null and did nothing at all, with no error shown.
  const connectingRef = useRef<Promise<`0x${string}` | null> | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const connect = useCallback(
    async (wallet?: DiscoveredWallet): Promise<`0x${string}` | null> => {
      const provider = wallet?.provider ?? resolveProvider();
      if (!provider) {
        setError(
          "No wallet detected. Install MetaMask/Rabby, or on mobile open this site inside your wallet app's browser.",
        );
        return null;
      }
      // Overlapping eth_requestAccounts makes wallets throw a spurious
      // rejection, so callers share one request instead of racing.
      if (connectingRef.current) return connectingRef.current;

      // A manual connect clears any prior "disconnected" suppression.
      writeStore(DISCONNECTED_KEY, null);
      const remember = (w?: DiscoveredWallet) => {
        const match = w ?? wallets.find((x) => x.provider === provider);
        if (match?.info.rdns) writeStore(LAST_WALLET_KEY, match.info.rdns);
        if (match) setActive(match);
      };

      // If already authorized, don't re-prompt (silently reuse the account).
      try {
        const existing = (await provider.request({ method: "eth_accounts" })) as string[];
        if (existing?.[0]) {
          setAddress(existing[0] as `0x${string}`);
          const id = (await provider.request({ method: "eth_chainId" })) as string;
          setChainId(parseInt(id, 16));
          remember(wallet);
          return existing[0] as `0x${string}`;
        }
      } catch {
        /* fall through to request */
      }

      setConnecting(true);
      setError(null);

      const run = async (): Promise<`0x${string}` | null> => {
        try {
          const accts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
          const addr = (accts[0] as `0x${string}`) ?? null;
          setAddress(addr);
          const id = (await provider.request({ method: "eth_chainId" })) as string;
          setChainId(parseInt(id, 16));
          remember(wallet);
          return addr;
        } catch (e) {
          const code = (e as { code?: number })?.code;
          setError(
            code === 4001
              ? "Connection request rejected — approve it in your wallet to continue."
              : code === -32002
                ? "A connection request is already open — check your wallet extension or app."
                : e instanceof Error
                  ? e.message
                  : "Failed to connect wallet.",
          );
          return null;
        } finally {
          connectingRef.current = null;
          setConnecting(false);
        }
      };

      connectingRef.current = run();
      return connectingRef.current;
    },
    [resolveProvider, wallets],
  );

  const disconnect = useCallback(() => {
    setAddress(null);
    setActive(null);
    // Remember the intent so we don't auto-reconnect on the next render/visit.
    writeStore(DISCONNECTED_KEY, "1");
    writeStore(LAST_WALLET_KEY, null);
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
      pickerOpen,
      requestPicker: () => setPickerOpen(true),
      clearPicker: () => setPickerOpen(false),
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
      pickerOpen,
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
