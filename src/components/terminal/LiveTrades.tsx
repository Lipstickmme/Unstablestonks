import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { formatUSD, shortAddr } from "@/lib/format";
import type { TradeEvent } from "@/lib/types";
import { profileTraders, type SizeTier } from "@/lib/traders";
import { useChain } from "@/lib/chain-context";
import { useTraderHoldings } from "@/lib/data/hooks";

const TIER_CLASS: Record<SizeTier, string> = {
  whale: "border-primary/40 bg-primary/10 text-primary",
  shark: "border-hot/40 bg-hot/10 text-hot",
  fish: "border-border bg-secondary text-muted-foreground",
  shrimp: "border-border bg-secondary text-muted-foreground",
};

/** Compact age. Raw seconds stop being readable within the hour. */
function age(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Live trades, with who is behind each one.
 *
 * The feed already carries the wallet on every trade, so the trader's recent
 * behaviour — how many swaps, whether they're net buying, what they realised —
 * is derivable for free (see profileTraders) with no extra requests. Holdings
 * are the one thing trades can't answer, so those come from a batched balanceOf
 * and fill in when ready.
 *
 * `token` and `totalSupply` are optional: on the chain-wide feed a row can be
 * any token, so the supply figure only appears on a single-token page where
 * "share of supply" actually means something.
 *
 * PAGED, not scrolled. A feed that grows without limit made this card as tall as
 * whatever the window happened to hold, which on the token page left a long
 * empty run below the rail and pushed the card past the footer. A page at a time
 * gives the section a height that barely moves no matter how busy the chain is.
 */
const PAGE_SIZE = 10;

export function LiveTrades({
  trades,
  loading,
  token,
  decimals = 18,
  totalSupply = 0,
}: {
  trades: TradeEvent[];
  loading?: boolean;
  /** Token address, when the feed is for one token. Enables the supply figure. */
  token?: string;
  decimals?: number;
  totalSupply?: number;
}) {
  const { chain } = useChain();
  const [page, setPage] = useState(0);

  // Profiles are derived from the WHOLE window, not the page: "12 swaps, net
  // buying" is a claim about the trader, and recomputing it per page would make
  // the same wallet read differently depending on where you happened to be.
  const profiles = useMemo(() => profileTraders(trades), [trades]);

  const pageCount = Math.max(1, Math.ceil(trades.length / PAGE_SIZE));
  // Clamped rather than reset. The feed refetches every few seconds, and an
  // effect that snapped back to page 1 on each refresh would make the control
  // unusable — you'd be thrown to the top mid-read. Clamping only moves you
  // when the page you're on stops existing.
  const safePage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => trades.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [trades, safePage],
  );

  // Balances are the one thing here that costs a request, so only the wallets
  // actually on screen get looked up instead of every wallet in the window.
  const wallets = useMemo(
    () => [...new Set(visible.map((t) => (t.wallet || "").toLowerCase()).filter(Boolean))],
    [visible],
  );
  const holdingsQ = useTraderHoldings(wallets, token, decimals, totalSupply);
  const holdings = holdingsQ.data;

  return (
    <section className="card-surface flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="live-dot" />
          <h2 className="text-sm font-medium">Live activity</h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">on-chain</span>
      </div>

      <div>
        {trades.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            {loading ? "Loading on-chain activity…" : "No recent on-chain activity indexed yet."}
          </div>
        ) : (
          <ul>
            {visible.map((t) => {
              const buy = t.side === "buy";
              const key = (t.wallet || "").toLowerCase();
              const p = profiles.get(key);
              const supplyPct = holdings?.[key];
              return (
                <li
                  key={t.id}
                  className="border-b border-border/40 px-3 py-2 transition-colors hover:bg-surface-elevated/50"
                >
                  {/* Line 1 — the trade */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 font-mono text-xs font-medium ${
                        buy ? "text-bull" : "text-bear"
                      }`}
                    >
                      {buy ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" />
                      )}
                      {t.symbol}
                    </span>
                    {p && (
                      <span
                        className={`chip !py-0 text-[9px] ${TIER_CLASS[p.tier]}`}
                        title={`Largest trade in view: ${formatUSD(p.biggestUsd)}`}
                      >
                        {p.tierLabel}
                      </span>
                    )}
                    <span className="num ml-auto text-xs">
                      {t.amountUsd > 0 ? formatUSD(t.amountUsd) : "—"}
                    </span>
                    <span className="num w-8 text-right text-[10px] text-muted-foreground">
                      {age(t.ms)}
                    </span>
                  </div>

                  {/* Line 2 — the trader */}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    {t.wallet ? (
                      <a
                        href={`${chain.explorerUrl}/address/${t.wallet}`}
                        target="_blank"
                        rel="noreferrer"
                        className="num inline-flex items-center gap-0.5 hover:text-foreground"
                      >
                        {shortAddr(t.wallet)}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      <span className="num">unknown wallet</span>
                    )}

                    {p && (
                      <>
                        <Dot />
                        <span title="Swaps by this wallet in the loaded window">
                          <span className="num text-foreground">{p.swaps}</span>{" "}
                          {p.swaps === 1 ? "swap" : "swaps"}
                        </span>

                        {p.pnlPct != null ? (
                          <>
                            <Dot />
                            <span
                              className={p.pnlPct >= 0 ? "text-bull" : "text-bear"}
                              title="Realised on what they bought AND sold in view — not a lifetime figure"
                            >
                              {p.pnlPct >= 0 ? "+" : ""}
                              {p.pnlPct.toFixed(1)}% realised
                            </span>
                          </>
                        ) : (
                          p.netUsd !== 0 && (
                            <>
                              <Dot />
                              <span
                                className={p.netUsd > 0 ? "text-bull" : "text-bear"}
                                title="Net flow across their trades in view. No P&L yet — they haven't both bought and sold here."
                              >
                                {p.netUsd > 0 ? "net buying" : "net selling"}{" "}
                                <span className="num">{formatUSD(Math.abs(p.netUsd))}</span>
                              </span>
                            </>
                          )
                        )}
                      </>
                    )}

                    {supplyPct != null && (
                      <>
                        <Dot />
                        <span title="Share of total supply this wallet holds now">
                          holds{" "}
                          <span className="num text-foreground">
                            {supplyPct < 0.01 ? "<0.01" : supplyPct.toFixed(2)}%
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Only when there is more than one page — a single-page feed shouldn't
          grow a control that does nothing. */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="text-[10px] text-muted-foreground">
            <span className="num text-foreground">{safePage * PAGE_SIZE + 1}</span>–
            <span className="num text-foreground">
              {Math.min(trades.length, (safePage + 1) * PAGE_SIZE)}
            </span>{" "}
            of <span className="num text-foreground">{trades.length}</span> trades
          </span>
          <div className="flex items-center gap-1">
            <PageBtn
              label="Newer trades"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </PageBtn>
            <span className="num px-1 text-[10px] text-muted-foreground">
              {safePage + 1}/{pageCount}
            </span>
            <PageBtn
              label="Older trades"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </PageBtn>
          </div>
        </div>
      )}
    </section>
  );
}

function PageBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="tap grid h-6 w-6 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  );
}

function Dot() {
  return <span className="text-muted-foreground/40">·</span>;
}
