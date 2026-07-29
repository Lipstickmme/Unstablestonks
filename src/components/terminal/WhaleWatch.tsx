import { useMemo } from "react";
import { Waves, ArrowUpRight, Wallet } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { formatUSD, shortAddr } from "@/lib/format";
import type { TradeEvent } from "@/lib/types";
import { useChain } from "@/lib/chain-context";
import { useTraderBalances } from "@/lib/data/hooks";

/**
 * Whale buys.
 *
 * Two ways in, because size alone misses the interesting half:
 *
 *   1. The print is big — at or above `threshold`.
 *   2. The buyer is big — their holding of that token is worth at least
 *      `walletThreshold`, however small this particular buy was. A wallet
 *      sitting on $50k that adds $400 is a whale accumulating, and ranking
 *      purely by ticket size would have hidden it entirely.
 *
 * Sells are excluded outright: this panel answers "who is buying", and mixing
 * exits into it made the signal ambiguous.
 */
export function WhaleWatch({
  trades,
  threshold = 1000,
  walletThreshold = 5000,
}: {
  trades: TradeEvent[];
  /** Minimum size for a single buy to qualify on its own. */
  threshold?: number;
  /** Minimum token holding value for a buyer to qualify at any size. */
  walletThreshold?: number;
}) {
  const { chain } = useChain();

  const buys = useMemo(() => trades.filter((t) => t.side === "buy"), [trades]);

  // Value each buyer's holding of the token they bought. Batched into one
  // multicall per token by the hook.
  const wallets = useMemo(
    () => [...new Set(buys.map((t) => (t.wallet || "").toLowerCase()).filter(Boolean))],
    [buys],
  );
  const balancesQ = useTraderBalances(wallets, buys);
  const balances = balancesQ.data;

  const whales = useMemo(() => {
    const seen = new Set<string>();
    return (
      buys
        .map((t) => {
          const holdingUsd = balances?.[(t.wallet || "").toLowerCase()];
          const bySize = t.amountUsd >= threshold;
          const byWallet = (holdingUsd ?? 0) >= walletThreshold;
          return { t, holdingUsd, qualifies: bySize || byWallet, bySize };
        })
        .filter((x) => x.qualifies)
        // One row per wallet — the same buyer printing five times shouldn't fill
        // the panel; their largest buy represents them.
        .sort((a, b) => b.t.amountUsd - a.t.amountUsd)
        .filter((x) => {
          const w = (x.t.wallet || x.t.id).toLowerCase();
          if (seen.has(w)) return false;
          seen.add(w);
          return true;
        })
        .slice(0, 6)
    );
  }, [buys, balances, threshold, walletThreshold]);

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
        <h3 className="text-sm font-medium">Whale buys</h3>
        <span
          className="ml-auto text-[10px] text-muted-foreground"
          title={`Buys of ${formatUSD(threshold)}+, or any buy from a wallet holding ${formatUSD(walletThreshold)}+ of the token`}
        >
          ≥ {formatUSD(threshold)} · or {formatUSD(walletThreshold)}+ holder
        </span>
      </div>

      {whales.length === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          No qualifying buys in the recent window.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {whales.map(({ t, holdingUsd, bySize }) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="inline-flex items-center gap-1 font-medium text-bull">
                <ArrowUpRight className="h-3 w-3" />
                Buy
              </span>
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

              {/* Why this row is here, when the ticket alone wouldn't qualify. */}
              {!bySize && holdingUsd != null && (
                <span
                  className="chip border-primary/40 bg-primary/10 !py-0 text-[9px] text-primary"
                  title="Small buy, big holder"
                >
                  <Wallet className="h-2.5 w-2.5" /> holds {formatUSD(holdingUsd)}
                </span>
              )}

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
              <span className="num ml-auto text-[11px] text-muted-foreground">{timeAgo(t.ms)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
