import { formatUSD } from "@/lib/mock-data";
import type { TradeEvent } from "@/lib/mock-data";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export function LiveTrades({ trades }: { trades: TradeEvent[] }) {
  return (
    <section className="card-surface flex flex-col overflow-hidden h-full">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="live-dot" />
          <h2 className="text-sm font-medium">Live swaps</h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">pool · fee 1%</span>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[420px]">
        <table className="w-full text-xs">
          <tbody>
            {trades.map((t) => {
              const buy = t.side === "buy";
              return (
                <tr key={t.id} className="border-b border-border/40 hover:bg-surface-elevated/50">
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 font-mono font-medium ${buy ? "text-bull" : "text-bear"}`}>
                      {buy ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {t.symbol}
                    </span>
                  </td>
                  <td className="px-2 py-2 num text-right">{formatUSD(t.amountUsd)}</td>
                  <td className="px-2 py-2 num text-right text-muted-foreground">
                    {t.priceImpact.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 num text-right text-muted-foreground">
                    {Math.max(1, Math.floor((Date.now() - t.ms) / 1000))}s
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
