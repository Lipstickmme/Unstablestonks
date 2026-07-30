import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Send, TrendingDown, TrendingUp, X } from "lucide-react";
import { formatCompactToken, formatUSD } from "@/lib/format";
import type { SellOutcome } from "@/lib/positions";
import { COMMUNITY } from "@/config/links";
import { useChain } from "@/lib/chain-context";

/**
 * The card that appears after a sell settles.
 *
 * It animates because the number is the point: the percentage counts up from
 * zero over two thirds of a second, so the eye lands on it before it reads
 * anything else. Green rises, red falls — the whole card slides from the
 * direction the trade went.
 *
 * Everything on it is derived from recorded trades (see positions.ts). If there
 * was no recorded entry there is no card at all, because there would be no
 * honest number to animate.
 */

/** Ease-out cubic — fast at the start, settles gently. */
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function useCountUp(target: number, ms = 650): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !isFinite(target)) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(target * ease(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return value;
}

export function PnlCard({
  outcome,
  txHash,
  onClose,
}: {
  outcome: SellOutcome;
  txHash?: string | null;
  onClose: () => void;
}) {
  const { chain } = useChain();
  const win = outcome.pnlUsd >= 0;
  const pct = useCountUp(outcome.pnlPct);
  const usd = useCountUp(Math.abs(outcome.pnlUsd));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shareText = useMemo(
    () =>
      `${win ? "Closed green" : "Closed red"} on $${outcome.symbol} — ${
        win ? "+" : ""
      }${outcome.pnlPct.toFixed(1)}% (${win ? "+" : "−"}${formatUSD(Math.abs(outcome.pnlUsd))}) on ${chain.name}.\n\nTraded on UnstableStonks.`,
    [win, outcome, chain.name],
  );
  const xShare = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(COMMUNITY.x)}`;
  const tgShare = `https://t.me/share/url?url=${encodeURIComponent(COMMUNITY.telegramChannel)}&text=${encodeURIComponent(shareText)}`;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={`sheet-grip sheet-up w-full max-w-sm overflow-hidden rounded-t-3xl border bg-background sm:rounded-3xl ${
          win ? "border-bull/40" : "border-bear/40"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* A band of the trade's own colour, so the result reads before the text. */}
        <div
          className={`relative px-5 pb-5 pt-6 text-center ${win ? "pnl-glow-up" : "pnl-glow-down"}`}
        >
          <button
            onClick={onClose}
            className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            {win ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {outcome.closed ? "Position closed" : "Partial sell"}
          </div>

          <div
            className={`num mt-2 text-5xl font-light leading-none ${win ? "text-bull" : "text-bear"}`}
          >
            {win ? "+" : ""}
            {pct.toFixed(1)}%
          </div>
          <div className={`num mt-1.5 text-lg ${win ? "text-bull" : "text-bear"}`}>
            {win ? "+" : "−"}
            {formatUSD(usd)}
          </div>

          <div className="mt-1 text-xs text-muted-foreground">
            {formatCompactToken(outcome.qty)} {outcome.symbol} sold
          </div>
        </div>

        <div className="space-y-2 border-t border-border px-5 py-4 text-xs">
          <Row label="Cost basis" value={formatUSD(outcome.costUsd)} />
          <Row label="Proceeds" value={formatUSD(outcome.proceedsUsd)} />
          <Row
            label={`Realised on ${outcome.symbol}, all time`}
            value={`${outcome.lifetimeUsd >= 0 ? "+" : "−"}${formatUSD(Math.abs(outcome.lifetimeUsd))}`}
            tone={outcome.lifetimeUsd >= 0 ? "bull" : "bear"}
          />
          <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
            Basis is the average of your buys on this terminal, in this browser. Buys made elsewhere
            aren&apos;t counted.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 px-5 pb-5">
          <a
            href={xShare}
            target="_blank"
            rel="noreferrer"
            className="tap flex items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-xs font-medium transition-colors hover:bg-surface-elevated"
          >
            Share on X <ExternalLink className="h-3 w-3" />
          </a>
          <a
            href={tgShare}
            target="_blank"
            rel="noreferrer"
            className="tap flex items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-xs font-medium transition-colors hover:bg-surface-elevated"
          >
            <Send className="h-3 w-3" /> Share on TG
          </a>
        </div>

        {txHash && (
          <a
            href={`${chain.explorerUrl}/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="block border-t border-border px-5 py-3 text-center text-[11px] text-muted-foreground transition-colors hover:text-primary"
          >
            View transaction on the explorer
          </a>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`num font-medium ${tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
