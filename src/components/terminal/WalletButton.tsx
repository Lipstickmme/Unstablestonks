import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Wallet, Copy, LogOut, ChevronDown, ExternalLink, Smartphone } from "lucide-react";
import { shortAddr } from "@/lib/format";
import { useChain } from "@/lib/chain-context";
import {
  useWallet,
  isMobileDevice,
  mobileWalletLinks,
  DESKTOP_WALLET_LINKS,
  type DiscoveredWallet,
} from "@/lib/wallet";

export function WalletButton() {
  const {
    address,
    connect,
    disconnect,
    connecting,
    error,
    wallets,
    activeWalletName,
    ensureChain,
    pickerOpen,
    clearPicker,
  } = useWallet();
  const { chain } = useChain();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Mobile users with no injected provider need a deep-link handoff to a wallet app.
  const isMobile = useMemo(() => isMobileDevice(), []);
  const hasInjected = wallets.length > 0 || (typeof window !== "undefined" && !!window.ethereum);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A dialog asked for the picker. If there's exactly one wallet there is
  // nothing to choose, so connect straight away instead of showing a
  // one-item menu.
  useEffect(() => {
    if (!pickerOpen || address) return;
    clearPicker();
    if (wallets.length === 1) void handleConnect(wallets[0]);
    else setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen, address]);

  // Surface connection errors so failures are never silent.
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const close = () => {
    setOpen(false);
    clearPicker();
  };

  async function handleConnect(w?: DiscoveredWallet) {
    close();
    const addr = await connect(w);
    if (addr) {
      toast.success(`Connected ${shortAddr(addr)}`);
      // Nudge the wallet onto the active chain (default: Stable) right away.
      ensureChain(chain).catch(() => {});
    }
  }

  // ── Connected ──────────────────────────────────────────────────────────────
  if (address) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-elevated"
        >
          <span className="live-dot" />
          <span className="font-mono">{shortAddr(address)}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
            {activeWalletName && (
              <div className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
                {activeWalletName}
              </div>
            )}
            <button
              onClick={() => {
                navigator.clipboard.writeText(address);
                toast.success("Address copied");
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-elevated"
            >
              <Copy className="h-3.5 w-3.5" /> Copy address
            </button>
            <button
              onClick={() => {
                disconnect();
                setOpen(false);
                toast("Wallet disconnected");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-bear hover:bg-surface-elevated"
            >
              <LogOut className="h-3.5 w-3.5" /> Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Not connected: decide what the dropdown offers ───────────────────────────
  // If there are injected wallets, list them (or connect directly when there's one).
  // Otherwise steer the user to install (desktop) or open in a wallet app (mobile).
  const needsPicker = wallets.length > 1 || !hasInjected;

  const trigger = (
    <button
      onClick={() => (needsPicker ? (open ? close() : setOpen(true)) : handleConnect(wallets[0]))}
      disabled={connecting}
      className="flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      <Wallet className="h-3.5 w-3.5" />
      <span className="hidden xs:inline">{connecting ? "Connecting…" : "Connect"}</span>
    </button>
  );

  if (!needsPicker) return trigger;

  return (
    <div className="relative" ref={ref}>
      {trigger}
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
          {wallets.length > 0 ? (
            <>
              <div className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
                Choose a wallet
              </div>
              {wallets.map((w) => (
                <button
                  key={w.info.uuid}
                  onClick={() => handleConnect(w)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-elevated"
                >
                  {w.info.icon && <img src={w.info.icon} alt="" className="h-4 w-4 rounded" />}
                  {w.info.name}
                </button>
              ))}
            </>
          ) : isMobile ? (
            <>
              <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
                <Smartphone className="h-3 w-3" /> Open in a wallet app
              </div>
              {mobileWalletLinks().map((l) => (
                <a
                  key={l.name}
                  href={l.href}
                  onClick={close}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-surface-elevated"
                >
                  {l.name}
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </a>
              ))}
            </>
          ) : (
            <>
              <div className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
                No wallet detected — install one
              </div>
              {DESKTOP_WALLET_LINKS.map((l) => (
                <a
                  key={l.name}
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={close}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-surface-elevated"
                >
                  {l.name}
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </a>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
