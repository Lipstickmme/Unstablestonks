import { Wallet } from "lucide-react";
import { shortAddr } from "@/lib/format";
import { useWallet } from "@/lib/wallet";

export function WalletButton() {
  const { address, connect, disconnect, connecting } = useWallet();

  if (address) {
    return (
      <button
        onClick={disconnect}
        title="Disconnect"
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-elevated transition-colors"
      >
        <span className="live-dot" />
        <span className="font-mono">{shortAddr(address)}</span>
      </button>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={connecting}
      className="flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
    >
      <Wallet className="h-3.5 w-3.5" />
      <span className="hidden xs:inline">{connecting ? "Connecting…" : "Connect"}</span>
    </button>
  );
}
