import { Waves, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { formatUSD, shortAddr } from "@/lib/format";
import type { TradeEvent } from "@/lib/types";
import { useChain } from "@/lib/chain-context";

/** Largest recent swaps for a token — the real "whale" prints, ranked by USD size. */
export function WhaleWatch({
  trades,
  threshold = 1000,
}: {
  trades: TradeEvent[];
  threshold?: number;
}) {
  const { chain } = useChain();
  const whales = [...trades]
    .filter((t) => t.amountUsd >= threshold)
    .sort((a, b) => b.amountUsd - a.amountUsd)
    .slice(0, 6);

  const timeAgo = (ms: number) => {
    const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
  };

  return (
    <section className="card-surface p-4">
      <div className="flex items-center gap-2">
        <Waves className="h-3.5 w-3.5 text-grad" />
        <h3 className="text-sm font-medium">Whale watch</h3>
        <span className="ml-auto text-[10px] text-muted-foreground">≥ {formatUSD(threshold)}</span>
      </div>
      {whales.length === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          No trades above {formatUSD(threshold)} in the recent window.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {whales.map((t) => {
            const buy = t.side === "buy";
            return (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`inline-flex items-center gap-1 font-medium ${buy ? "text-bull" : "text-bear"}`}
                >
                  {buy ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {buy ? "Buy" : "Sell"}
                </span>
                {/* Which token the whale actually traded. */}
                {t.tokenAddress ? (
                  <Link
                    to="/token/$address"
                    params={{ address: t.tokenAddress }}
                    className="font-medium hover:text-primary"
                  >
                    {t.symbol}
                  </Link>
                ) : (
                  <span className="font-medium">{t.symbol}</span>
                )}
                <span className="num font-medium">{formatUSD(t.amountUsd)}</span>
                {t.wallet && (
                  <a
                    href={`${chain.explorerUrl}/address/${t.wallet}`}
                    target="_blank"
                    rel="noreferrer"
                    className="num text-[11px] text-muted-foreground hover:text-primary"
                  >
                    {shortAddr(t.wallet)}
                  </a>
                )}
                <span className="num ml-auto text-[11px] text-muted-foreground">
                  {timeAgo(t.ms)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
