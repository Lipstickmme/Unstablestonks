import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Boxes, AlertTriangle, Copy } from "lucide-react";
import { formatUSD, shortAddr } from "@/lib/format";
import type { TradeEvent, TokenRow } from "@/lib/types";
import { analyzeBundles, analyzeBundlesByToken } from "@/lib/bundles";

/**
 * Bundle detection from the real trades feed. Swaps landing in the same block as
 * several others are almost certainly coordinated (sniper/MEV/launch bundle).
 *
 * On the terminal this lists the actual launches carrying bundles — newest
 * first, with each token's CA — rather than only chain-wide statistics.
 */
export function BundleWatch({ trades, tokens }: { trades: TradeEvent[]; tokens?: TokenRow[] }) {
  const stats = useMemo(() => analyzeBundles(trades), [trades]);
  const perToken = useMemo(() => analyzeBundlesByToken(trades), [trades]);

  // Tokens that actually have bundles, newest launch first.
  const flagged = useMemo(() => {
    const byAddr = new Map((tokens ?? []).map((t) => [t.address, t]));
    return Object.entries(perToken)
      .filter(([, s]) => s.count > 0)
      .map(([address, s]) => {
        const token = byAddr.get(address);
        return {
          address,
          stats: s,
          symbol: token?.symbol ?? shortAddr(address),
          ageMinutes: token?.ageMinutes ?? -1,
        };
      })
      .sort((a, b) => {
        // Newest launches first; unknown ages fall to the bottom.
        const aAge = a.ageMinutes < 0 ? Number.MAX_SAFE_INTEGER : a.ageMinutes;
        const bAge = b.ageMinutes < 0 ? Number.MAX_SAFE_INTEGER : b.ageMinutes;
        return aAge - bAge;
      })
      .slice(0, 6);
  }, [perToken, tokens]);

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

          {/* The launches actually carrying bundles, newest first. */}
          {flagged.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {flagged.map((f) => (
                <li key={f.address} className="flex items-center gap-2 text-xs">
                  <Link
                    to="/token/$address"
                    params={{ address: f.address }}
                    className="font-medium hover:text-primary"
                  >
                    {f.symbol}
                  </Link>
                  <button
                    onClick={() => navigator.clipboard.writeText(f.address)}
                    title="Copy contract address"
                    className="num inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {shortAddr(f.address)}
                    <Copy className="h-2.5 w-2.5" />
                  </button>
                  <span
                    className={`num ml-auto text-[11px] font-medium ${
                      f.stats.risk === "high"
                        ? "text-bear"
                        : f.stats.risk === "elevated"
                          ? "text-warn"
                          : "text-muted-foreground"
                    }`}
                    title={`${f.stats.count} cluster(s), largest ${f.stats.largest} swaps`}
                  >
                    {f.stats.pct.toFixed(0)}% · {f.stats.count}x
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2 text-[10px] text-muted-foreground">
              No same-block clusters in the last {stats.sample} swaps.
            </div>
          )}

          {flagged.length > 0 && (
            <div className="mt-2 text-[10px] text-muted-foreground">
              {formatUSD(stats.bundledUsd)} traded in same-block clusters across the last{" "}
              {stats.sample} swaps.
            </div>
          )}
        </>
      )}
    </section>
  );
}
