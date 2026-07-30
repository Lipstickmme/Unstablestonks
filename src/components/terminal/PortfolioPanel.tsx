import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  ExternalLink,
  Layers,
  Loader2,
  PieChart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { formatCompactToken, formatUSD, shortAddr } from "@/lib/format";
import type { TokenRow, TradeEvent } from "@/lib/types";
import {
  useWalletActivity,
  useWalletPortfolio,
  type Portfolio,
  type PortfolioPosition,
} from "@/lib/data/hooks";
import { profileTraders } from "@/lib/traders";
import { useChain } from "@/lib/chain-context";
import { useWallet } from "@/lib/wallet";
import { trackEvent } from "@/lib/store";
import { QuickBuyModal } from "./QuickBuyModal";
import { TokenIcon } from "./TokenIcon";
import { WhaleIcon } from "@/components/brand/WhaleIcon";

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio — what the connected wallet actually holds on this chain, what it
// is worth, and what the wallet has been doing.
//
// Two independent sources, deliberately kept apart:
//   Holdings   balanceOf per listed token, priced with the terminal's own live
//              prices. This is the truth about the position right now.
//   Activity   the explorer's record of this wallet's transfers. Independent of
//              the pool trade feed, which only watches the eight busiest pools
//              and would leave most wallets looking inactive.
//
// Nothing is modelled. A position with no price shows its balance and no dollar
// figure; unrealised P&L is absent entirely because the entry price isn't
// knowable from any source the terminal reads.
// ─────────────────────────────────────────────────────────────────────────────

function Delta({ pct }: { pct: number }) {
  const pos = pct >= 0;
  return (
    <span className={`num text-xs ${pos ? "text-bull" : "text-bear"}`}>
      {pos ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

function Tile({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  tone?: "bull" | "bear";
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={`num mt-1 text-base font-semibold leading-none ${
          tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : ""
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/**
 * Where the money is, and how each slice is doing.
 *
 * A donut plus a ranked bar list, because they answer different questions: the
 * ring shows concentration at a glance (one dominant arc is a very different
 * portfolio from eight even ones), and the bars carry the names, weights and
 * 24h moves the ring can't.
 *
 * Colours come from the design tokens rather than a rainbow: this is a terminal,
 * and hue already means something here (green up, red down), so allocation uses
 * a single hue stepped by opacity and lets the delta text carry direction.
 */
function AllocationChart({ portfolio }: { portfolio: Portfolio }) {
  const slices = useMemo(() => {
    const parts: { key: string; label: string; usd: number; change?: number }[] = [];
    if (portfolio.native.valueUsd && portfolio.native.valueUsd > 0) {
      parts.push({
        key: "native",
        label: portfolio.native.symbol,
        usd: portfolio.native.valueUsd,
      });
    }
    for (const pos of portfolio.positions) {
      if (pos.valueUsd <= 0) continue;
      parts.push({
        key: pos.token.address,
        label: pos.token.symbol,
        usd: pos.valueUsd,
        change: pos.token.priceChange24h,
      });
    }
    parts.sort((a, b) => b.usd - a.usd);

    // Everything past the sixth is one "rest" slice — beyond that the arcs are
    // too thin to read and the legend stops being a legend.
    const head = parts.slice(0, 6);
    const tail = parts.slice(6);
    if (tail.length) {
      head.push({
        key: "rest",
        label: `${tail.length} more`,
        usd: tail.reduce((s, x) => s + x.usd, 0),
      });
    }
    const total = head.reduce((s, x) => s + x.usd, 0) || 1;
    return head.map((x, i) => ({ ...x, pct: (x.usd / total) * 100, i }));
  }, [portfolio]);

  if (slices.length < 2) return null;

  // Donut geometry: one circle, dash offsets walked round it. Cheaper and
  // sharper than arc paths, and it animates for free via stroke-dasharray.
  const R = 42;
  const C = 2 * Math.PI * R;
  let walked = 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <PieChart className="h-3 w-3" />
        Allocation
      </div>

      <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
        <svg viewBox="0 0 100 100" className="h-32 w-32 flex-shrink-0 -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--border)" strokeWidth="11" />
          {slices.map((s) => {
            const len = (s.pct / 100) * C;
            const offset = -walked;
            walked += len;
            return (
              <circle
                key={s.key}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke="var(--primary)"
                strokeOpacity={Math.max(0.22, 1 - s.i * 0.14)}
                strokeWidth="11"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={offset}
                className="donut-draw"
                style={{ animationDelay: `${s.i * 70}ms` }}
              />
            );
          })}
        </svg>

        <ul className="w-full space-y-1.5">
          {slices.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-sm bg-primary"
                style={{ opacity: Math.max(0.22, 1 - s.i * 0.14) }}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
              {s.change != null && <Delta pct={s.change} />}
              <span className="num w-12 text-right text-muted-foreground">{s.pct.toFixed(0)}%</span>
              <span className="num w-16 text-right">{formatUSD(s.usd)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function timeAgo(ms: number) {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function PortfolioPanel({
  tokens,
  trades,
  loading,
}: {
  tokens: TokenRow[];
  /** Chain-wide pool trades — used only for this wallet's own realised P&L. */
  trades: TradeEvent[];
  /** True while the token list itself is still resolving. */
  loading?: boolean;
}) {
  const { chain } = useChain();
  const wallet = useWallet();
  const address = wallet.address?.toLowerCase() ?? null;
  const [buyToken, setBuyToken] = useState<TokenRow | null>(null);

  const portfolioQ = useWalletPortfolio(address, tokens);
  const activityQ = useWalletActivity(address);
  const p = portfolioQ.data;

  // One counter per browser session, so "how many people open the portfolio"
  // isn't distorted by tab-flipping. No address is sent.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.sessionStorage.getItem("ustonks.ev.portfolio")) return;
      window.sessionStorage.setItem("ustonks.ev.portfolio", "1");
    } catch {
      return;
    }
    void trackEvent({ data: { name: "portfolio" } }).catch(() => {});
  }, []);

  // Realised P&L, but only if this wallet traded inside the loaded feed window.
  // Absent is the honest answer otherwise — see traders.ts.
  const profile = useMemo(() => {
    if (!address) return undefined;
    return profileTraders(trades.filter((t) => (t.wallet || "").toLowerCase() === address)).get(
      address,
    );
  }, [trades, address]);

  const symbolOf = useMemo(() => {
    const m = new Map<string, TokenRow>();
    for (const t of tokens) m.set(t.address.toLowerCase(), t);
    return m;
  }, [tokens]);

  if (!address) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
        <Wallet className="h-6 w-6 text-muted-foreground" />
        <p className="max-w-xs text-sm text-muted-foreground">
          Connect a wallet to see your {chain.name} holdings, their live value, and your on-chain
          activity.
        </p>
        <button
          onClick={() => wallet.requestPicker()}
          className="tap rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Connect wallet
        </button>
      </div>
    );
  }

  const busy = portfolioQ.isLoading || loading;
  const positions = p?.positions ?? [];
  const activity = activityQ.data ?? [];
  const whaleSized = p != null && p.totalUsd >= 5_000;

  return (
    <div className="space-y-4 p-3 sm:p-4">
      {/* ── Analytics ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label="Portfolio value"
          icon={<Wallet className="h-3 w-3" />}
          value={
            busy && !p ? <Loader2 className="h-4 w-4 animate-spin" /> : formatUSD(p?.totalUsd ?? 0)
          }
          sub={
            <span className="inline-flex items-center gap-1">
              <a
                href={`${chain.explorerUrl}/address/${address}`}
                target="_blank"
                rel="noreferrer"
                className="num hover:text-primary"
              >
                {shortAddr(address)}
              </a>
              {whaleSized && (
                <span className="chip !py-0 border-primary/40 bg-primary/10 text-[9px] text-primary">
                  <WhaleIcon size={10} /> whale
                </span>
              )}
            </span>
          }
        />
        <Tile
          label="24h change"
          icon={
            (p?.change24hPct ?? 0) >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )
          }
          tone={p?.change24hPct == null ? undefined : p.change24hPct >= 0 ? "bull" : "bear"}
          value={
            p?.change24hPct == null ? (
              "—"
            ) : (
              <>
                {p.change24hPct >= 0 ? "+" : ""}
                {p.change24hPct.toFixed(1)}%
              </>
            )
          }
          sub={
            p?.change24hUsd
              ? `${p.change24hUsd >= 0 ? "+" : "−"}${formatUSD(Math.abs(p.change24hUsd))}`
              : "no priced moves"
          }
        />
        <Tile
          label="Positions"
          icon={<Layers className="h-3 w-3" />}
          value={positions.length}
          sub={p ? `of ${p.scanned} listed tokens checked` : "—"}
        />
        <Tile
          label="Realised P&L"
          icon={<Coins className="h-3 w-3" />}
          tone={profile?.pnlPct == null ? undefined : profile.pnlPct >= 0 ? "bull" : "bear"}
          value={
            profile?.pnlPct == null ? (
              "—"
            ) : (
              <>
                {profile.pnlPct >= 0 ? "+" : ""}
                {profile.pnlPct.toFixed(1)}%
              </>
            )
          }
          sub={
            profile
              ? `${profile.swaps} swap${profile.swaps === 1 ? "" : "s"} in the live window`
              : "no swaps in the live window"
          }
        />
      </div>

      {/* ── Allocation ──────────────────────────────────────────────────── */}
      {p && p.totalUsd > 0 && <AllocationChart portfolio={p} />}

      {/* Best and worst, when there is more than one priced position to rank. */}
      {p?.best && p.worst && p.best.token.address !== p.worst.token.address && (
        <div className="grid grid-cols-2 gap-2">
          {(
            [["Best 24h", p.best] as const, ["Worst 24h", p.worst] as const] satisfies [
              string,
              PortfolioPosition,
            ][]
          ).map(([label, pos]) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2"
            >
              <TokenIcon url={pos.token.logoUrl} symbol={pos.token.symbol} size={22} />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {label}
                </div>
                <div className="truncate text-xs font-medium">{pos.token.symbol}</div>
              </div>
              <span className="ml-auto">
                <Delta pct={pos.token.priceChange24h} />
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Holdings ────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-surface-elevated/40 px-3 py-2">
          <h3 className="text-xs font-medium">Holdings</h3>
          <span className="ml-auto text-[10px] text-muted-foreground">
            Balances read on chain · priced live
          </span>
        </div>

        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[540px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="sticky left-0 z-10 w-[132px] bg-surface-elevated px-3 py-2">
                  Token
                </th>
                <th className="px-2 py-2 text-right">Balance</th>
                <th className="px-2 py-2 text-right">Value</th>
                <th className="px-2 py-2 text-right">24h</th>
                <th className="px-2 py-2 text-right">Weight</th>
                <th className="px-3 py-2 text-right">Trade</th>
              </tr>
            </thead>
            <tbody>
              {/* The gas asset sits at the top: it is what every swap spends. */}
              {p && p.native.balance > 0 && (
                <tr className="border-b border-border/60">
                  <td className="sticky left-0 z-10 bg-background px-3 py-2">
                    <div className="flex items-center gap-2">
                      <TokenIcon symbol={p.native.symbol} size={24} />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{p.native.symbol}</div>
                        <div className="text-[10px] text-muted-foreground">Gas</div>
                      </div>
                    </div>
                  </td>
                  <td className="num px-2 py-2 text-right text-xs">
                    {formatCompactToken(p.native.balance)}
                  </td>
                  <td className="num px-2 py-2 text-right text-xs">
                    {p.native.valueUsd == null ? "—" : formatUSD(p.native.valueUsd)}
                  </td>
                  <td className="px-2 py-2 text-right text-xs text-muted-foreground">—</td>
                  <td className="num px-2 py-2 text-right text-xs text-muted-foreground">
                    {p.totalUsd > 0 && p.native.valueUsd != null
                      ? `${((p.native.valueUsd / p.totalUsd) * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              )}

              {positions.map((pos) => (
                <tr
                  key={pos.token.address}
                  className="group border-b border-border/60 transition-colors hover:bg-surface-elevated/60"
                >
                  <td className="sticky left-0 z-10 bg-background px-3 py-2 group-hover:bg-surface-elevated">
                    <Link
                      to="/token/$address"
                      params={{ address: pos.token.address }}
                      className="flex items-center gap-2"
                    >
                      <TokenIcon url={pos.token.logoUrl} symbol={pos.token.symbol} size={24} />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{pos.token.symbol}</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {pos.supplyPct != null && pos.supplyPct >= 0.01
                            ? `${pos.supplyPct.toFixed(2)}% of supply`
                            : pos.token.name}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="num px-2 py-2 text-right text-xs">
                    {formatCompactToken(pos.balance)}
                  </td>
                  <td className="num px-2 py-2 text-right text-xs">
                    {pos.valueUsd > 0 ? formatUSD(pos.valueUsd) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Delta pct={pos.token.priceChange24h} />
                  </td>
                  <td className="num px-2 py-2 text-right text-xs text-muted-foreground">
                    {pos.weightPct > 0 ? `${pos.weightPct.toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setBuyToken(pos.token)}
                      className="tap rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      Trade
                    </button>
                  </td>
                </tr>
              ))}

              {positions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    {busy
                      ? "Reading your balances on chain…"
                      : `No listed ${chain.name} tokens in this wallet yet. Buy one from the launches tab and it appears here.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Activity ────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-surface-elevated/40 px-3 py-2">
          <h3 className="text-xs font-medium">Your activity</h3>
          <span className="ml-auto text-[10px] text-muted-foreground">
            Token transfers from the {chain.name} explorer
          </span>
        </div>

        {activity.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            {activityQ.isLoading
              ? "Loading your transfers…"
              : "No token transfers recorded for this wallet yet."}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {activity.slice(0, 20).map((a, i) => {
              const row = symbolOf.get(a.tokenAddress);
              const usd = row && row.price > 0 ? a.amount * row.price : 0;
              const incoming = a.direction === "in";
              return (
                <li
                  key={`${a.txHash ?? "t"}-${i}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs"
                >
                  <span
                    className={`inline-flex items-center gap-1 font-medium ${
                      incoming ? "text-bull" : "text-bear"
                    }`}
                  >
                    {incoming ? (
                      <ArrowDownLeft className="h-3 w-3" />
                    ) : (
                      <ArrowUpRight className="h-3 w-3" />
                    )}
                    {incoming ? "In" : "Out"}
                  </span>

                  {row ? (
                    <Link
                      to="/token/$address"
                      params={{ address: a.tokenAddress }}
                      className="font-medium hover:text-primary"
                    >
                      {a.symbol}
                    </Link>
                  ) : (
                    <span className="font-medium">{a.symbol}</span>
                  )}

                  <span className="num text-muted-foreground">{formatCompactToken(a.amount)}</span>
                  {usd > 0 && <span className="num font-medium">{formatUSD(usd)}</span>}

                  <a
                    href={`${chain.explorerUrl}/address/${a.counterparty}`}
                    target="_blank"
                    rel="noreferrer"
                    className="num text-[11px] text-muted-foreground hover:text-primary"
                    title={incoming ? "From" : "To"}
                  >
                    {incoming ? "from" : "to"} {shortAddr(a.counterparty)}
                  </a>

                  <span className="num ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                    {timeAgo(a.ms)}
                    {a.txHash && (
                      <a
                        href={`${chain.explorerUrl}/tx/${a.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-primary"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {buyToken && <QuickBuyModal token={buyToken} onClose={() => setBuyToken(null)} />}
    </div>
  );
}
