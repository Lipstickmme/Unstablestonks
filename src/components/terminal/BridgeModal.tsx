import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useChain } from "@/lib/chain-context";
import { BridgePanel } from "./BridgePanel";

/**
 * Bridge dialog opened from the header. Same presentation as the quick-buy
 * modal: portalled to <body> so it centres on the viewport wherever the click
 * happened, full-width sheet on mobile, background scroll locked.
 */
export function BridgeModal({ onClose }: { onClose: () => void }) {
  const { chain } = useChain();

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

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="sheet-grip sheet-up w-full max-w-sm overflow-hidden rounded-t-3xl border border-border bg-background sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-medium leading-none">Bridge funds</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Top up your {chain.name} balance
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
          <BridgePanel bare onNeedsWallet={onClose} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
