import { useMemo } from "react";
import { Boxes, AlertTriangle } from "lucide-react";
import { formatUSD } from "@/lib/format";
import type { TradeEvent } from "@/lib/types";
import { analyzeBundles } from "@/lib/bundles";

/**
 * Bundle detection from the real trades feed. Trades that land in the same block
 * (same block timestamp) as multiple others are almost certainly a coordinated
 * bundle (sniper/MEV/launch bundle). We group by second and flag clusters ≥ 3.
 */
export function BundleWatch({ trades }: { trades: TradeEvent[] }) {
  // Same analyzer the terminal list uses, so panel and rows always agree.
  const stats = useMemo(() => analyzeBundles(trades), [trades]);

  const risk = stats.risk === "none" ? "low" : stats.risk;
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
