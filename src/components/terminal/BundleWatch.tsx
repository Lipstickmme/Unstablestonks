import { useMemo } from "react";
import { Boxes, AlertTriangle } from "lucide-react";
import { formatUSD } from "@/lib/format";
import type { TradeEvent } from "@/lib/types";

/**
 * Bundle detection from the real trades feed. Trades that land in the same block
 * (same block timestamp) as multiple others are almost certainly a coordinated
 * bundle (sniper/MEV/launch bundle). We group by second and flag clusters ≥ 3.
 */
export function BundleWatch({ trades }: { trades: TradeEvent[] }) {
  const stats = useMemo(() => {
    const groups = new Map<number, TradeEvent[]>();
    for (const t of trades) {
      const sec = Math.floor(t.ms / 1000);
      const arr = groups.get(sec);
      if (arr) arr.push(t);
      else groups.set(sec, [t]);
    }
    const bundles = [...groups.values()].filter((g) => g.length >= 3);
    const bundledTrades = bundles.reduce((s, g) => s + g.length, 0);
    const largest = bundles.reduce((m, g) => Math.max(m, g.length), 0);
    const bundledUsd = bundles.reduce((s, g) => s + g.reduce((x, t) => x + t.amountUsd, 0), 0);
    const pct = trades.length ? (bundledTrades / trades.length) * 100 : 0;
    return { count: bundles.length, largest, bundledUsd, pct, sample: trades.length };
  }, [trades]);

  const risk = stats.pct >= 40 ? "high" : stats.pct >= 15 ? "elevated" : "low";
  const riskCls = risk === "high" ? "text-bear" : risk === "elevated" ? "text-warn" : "text-bull";

  return (
    <section className="card-surface p-4">
      <div className="flex items-center gap-2">
        <Boxes className="h-3.5 w-3.5 text-cto" />
        <h3 className="text-sm font-medium">Bundle detection</h3>
        <span
          className={`ml-auto inline-flex items-center gap-1 text-[11px] font-medium ${riskCls}`}
        >
          {risk !== "low" && <AlertTriangle className="h-3 w-3" />}
          {risk} risk
        </span>
      </div>

      {stats.sample === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          No trades in the recent window to analyze.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-border bg-background p-2">
              <div className="num text-lg font-light">{stats.count}</div>
              <div className="text-[10px] text-muted-foreground">bundles</div>
            </div>
            <div className="rounded-lg border border-border bg-background p-2">
              <div className="num text-lg font-light">{stats.pct.toFixed(0)}%</div>
              <div className="text-[10px] text-muted-foreground">bundled trades</div>
            </div>
            <div className="rounded-lg border border-border bg-background p-2">
              <div className="num text-lg font-light">{stats.largest || "—"}</div>
              <div className="text-[10px] text-muted-foreground">largest cluster</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">
            {stats.count > 0
              ? `${formatUSD(stats.bundledUsd)} traded in same-block clusters across the last ${stats.sample} swaps.`
              : `No same-block clusters in the last ${stats.sample} swaps.`}
          </div>
        </>
      )}
    </section>
  );
}
