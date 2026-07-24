import { useEffect } from "react";
import { X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { TokenRow } from "@/lib/types";
import { useWallet } from "@/lib/wallet";
import { SwapPanel } from "./SwapPanel";

/**
 * Quick-buy dialog opened from the table's Buy button. Triggers a wallet
 * connection immediately on open (that's the point of the button), then shows
 * the swap panel defaulted to Buy — without navigating away from the terminal.
 */
export function QuickBuyModal({ token, onClose }: { token: TokenRow; onClose: () => void }) {
  const { address, connect } = useWallet();

  // "Buy" should engage the wallet right away.
  useEffect(() => {
    if (!address) void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="fade-up w-full max-w-sm overflow-hidden rounded-t-2xl border border-border bg-background sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 flex-shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground">
              {token.logoUrl ? (
                <img src={token.logoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                token.logo
              )}
            </div>
            <div>
              <div className="text-sm font-medium leading-none">Buy {token.symbol}</div>
              <Link
                to="/token/$address"
                params={{ address: token.address }}
                onClick={onClose}
                className="text-[11px] text-muted-foreground hover:text-primary"
              >
                View full token page →
              </Link>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-3">
          <SwapPanel token={token} defaultSide="buy" />
        </div>
      </div>
    </div>
  );
}
