import { formatUSD } from "@/lib/format";
import type { TradeEvent } from "@/lib/types";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export function LiveTrades({ trades, loading }: { trades: TradeEvent[]; loading?: boolean }) {
  return (
    <section className="card-surface flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="live-dot" />
          <h2 className="text-sm font-medium">Live activity</h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">on-chain</span>
      </div>
      <div className="max-h-[420px] flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="px-4 py-12 text-center text-xs text-muted-foreground">
            {loading ? "Loading on-chain activity…" : "No recent on-chain activity indexed yet."}
          </div>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {trades.map((t) => {
                const buy = t.side === "buy";
                return (
                  <tr key={t.id} className="border-b border-border/40 hover:bg-surface-elevated/50">
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 font-mono font-medium ${buy ? "text-bull" : "text-bear"}`}
                      >
                        {buy ? (
                          <ArrowUpRight className="h-3 w-3" />
                        ) : (
                          <ArrowDownRight className="h-3 w-3" />
                        )}
                        {t.symbol}
                      </span>
                    </td>
                    <td className="num px-2 py-2 text-right">
                      {t.amountUsd > 0 ? formatUSD(t.amountUsd) : "—"}
                    </td>
                    <td className="num px-3 py-2 text-right text-muted-foreground">
                      {Math.max(1, Math.floor((Date.now() - t.ms) / 1000))}s
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
