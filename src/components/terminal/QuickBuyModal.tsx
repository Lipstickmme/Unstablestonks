import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { TokenRow } from "@/lib/types";
import { SwapPanel } from "./SwapPanel";

/**
 * Quick-buy dialog opened from the table's Buy button — no navigation.
 *
 * It never connects a wallet itself. If the panel needs one it closes this
 * dialog and opens the header's wallet picker, so there is exactly one connect
 * flow in the app rather than a second one competing from inside a portal.
 */
export function QuickBuyModal({ token, onClose }: { token: TokenRow; onClose: () => void }) {
  // Close on Escape, and lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // Portal to <body>: rendered inside the scrollable table the dialog inherits
  // that scroll context and drifts far down the page. At the body root it always
  // centres on the viewport, right where the click happened.
  return createPortal(
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
          <SwapPanel token={token} defaultSide="buy" onNeedsWallet={onClose} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
