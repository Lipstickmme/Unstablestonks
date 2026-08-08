import { formatNum, formatUSD } from "@/lib/format";
import type { ChainStats } from "@/lib/types";
import { useChain } from "@/lib/chain-context";
import { AnimatedNumber } from "./AnimatedNumber";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";

interface Props {
  stats?: ChainStats;
  loading?: boolean;
  /** Chain-wide 24h DEX volume, summed from live pool data. */
  vol24h?: number;
  /** % the current 6h run-rate is above/below the 24h average. */
  vol24hChange?: number;
}

interface Tile {
  label: string;
  value?: number;
  format: (n: number) => string;
  change?: number;
  changeNote?: string;
  /** Explains the figure on hover — used to date a carried-forward counter. */
  hint?: string;
  /** Shown under the number when the reading is older than the page. */
  note?: string;
}

const clock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function StatsOverview({ stats, loading, vol24h, vol24hChange }: Props) {
  const { chain } = useChain();

  const gwei = (n: number) => `${n.toFixed(3)} gwei`;
  const pick = (n?: number) => (n && n > 0 ? n : undefined);

  // The network totals are monotonic counters held across refreshes (see
  // mergeCounters), so they tick up in place instead of vanishing whenever the
  // explorer scrape misses a cycle. When a reading does go stale, say so under
  // the number rather than letting it pass as current.
  const counterAgeMs = stats?.countersAt ? Date.now() - stats.countersAt.getTime() : undefined;
  const counterStale = counterAgeMs != null && counterAgeMs > 120_000;
  const counterHint = stats?.countersAt
    ? `Network counter, last read from the explorer at ${clock(stats.countersAt)}. Held between reads — it only moves forward.`
    : "Network counter — no explorer read has succeeded yet.";
  const counterNote =
    counterStale && stats?.countersAt ? `as of ${clock(stats.countersAt)}` : undefined;

  // 24h volume is summed from live pool data; its change is the current 6h
  // run-rate vs the 24h average. Totals come from the explorer and show "—"
  // only when no read has ever succeeded — never a fabricated value.
  const tiles: Tile[] = [
    {
      label: "24h volume",
      value: pick(vol24h),
      format: formatUSD,
      change: vol24hChange,
      changeNote: "6h run-rate vs 24h avg",
    },
    {
      label: "Total transactions",
      value: pick(stats?.totalTransactions),
      format: formatNum,
      hint: counterHint,
      note: counterNote,
    },
    {
      label: "Total addresses",
      value: pick(stats?.totalAddresses),
      format: formatNum,
      hint: counterHint,
      note: counterNote,
    },
    { label: "Gas price", value: pick(stats?.gasPriceGwei), format: gwei },
  ];

  const updated = stats?.updatedAt ?? new Date();

  return (
    <section className="card-surface p-5 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight sm:text-3xl md:text-4xl">
            Protocol analytics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live on-chain reporting for {chain.name}.{" "}
            <span className="text-muted-foreground/70">{chain.tagline}</span>
          </p>
          <p
            className="mt-2 font-mono text-[11px] text-muted-foreground/80"
            title={
              stats?.statSources?.length
                ? `Totals from: ${stats.statSources.join(", ")}`
                : "Explorer totals unavailable — no source responded."
            }
          >
            <span
              className={`mr-2 inline-block align-middle ${stats?.live ? "live-dot" : "opacity-40"}`}
            />
            {stats?.live ? "Live" : loading ? "Connecting…" : "Source unreachable"}
            {stats?.blockNumber ? ` · block #${formatNum(stats.blockNumber)}` : ""} · updated{" "}
            {updated.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}{" "}
            · RPC {chain.rpcUrls[0].replace(/^https?:\/\//, "")}
          </p>
        </div>

        <a
          href={chain.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 self-start rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-elevated"
        >
          View on explorer <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
        {tiles.map((t) => {
          const up = (t.change ?? 0) >= 0;
          return (
            <div key={t.label} className="bg-surface p-4 sm:p-5" title={t.hint}>
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className="num mt-2 text-2xl font-light tracking-tight sm:text-3xl md:text-4xl">
                {t.value == null ? (
                  loading && !stats ? (
                    // A shimmering bar the width the figure will occupy, so the
                    // tile doesn't jump when the number lands.
                    <span className="shimmer block h-7 w-20 rounded-md sm:h-8 md:h-9" />
                  ) : (
                    "—"
                  )
                ) : (
                  <AnimatedNumber value={t.value} format={t.format} />
                )}
              </div>
              {t.value != null && t.note && (
                <div className="mt-1 text-[11px] text-muted-foreground">{t.note}</div>
              )}
              {t.value != null && t.change != null && isFinite(t.change) && (
                <div
                  className={`mt-1 flex items-center gap-1 text-[11px] ${up ? "text-bull" : "text-bear"}`}
                  title={t.changeNote}
                >
                  {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  <span className="num">
                    {up ? "+" : ""}
                    {t.change.toFixed(1)}%
                  </span>
                  <span className="text-muted-foreground">{t.changeNote}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Metrics are read directly from {chain.name}'s block explorer and JSON-RPC. Market/DEX
        figures appear where a pricing source indexes the chain; otherwise on-chain counters are
        shown. Verify any figure against the explorer.
      </p>
    </section>
  );
}
