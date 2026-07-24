import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Wallet, Copy, LogOut, ChevronDown } from "lucide-react";
import { shortAddr } from "@/lib/format";
import { useWallet, type DiscoveredWallet } from "@/lib/wallet";

export function WalletButton() {
  const { address, connect, disconnect, connecting, error, wallets, activeWalletName } =
    useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Surface connection errors so failures are never silent.
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  async function handleConnect(w?: DiscoveredWallet) {
    setOpen(false);
    const addr = await connect(w);
    if (addr) toast.success(`Connected ${shortAddr(addr)}`);
  }

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

  // Multiple wallets → picker; one/none → direct connect.
  if (wallets.length > 1) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={connecting}
          className="flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <Wallet className="h-3.5 w-3.5" />
          <span className="hidden xs:inline">{connecting ? "Connecting…" : "Connect"}</span>
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
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
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => handleConnect()}
      disabled={connecting}
      className="flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      <Wallet className="h-3.5 w-3.5" />
      <span className="hidden xs:inline">{connecting ? "Connecting…" : "Connect"}</span>
    </button>
  );
}
