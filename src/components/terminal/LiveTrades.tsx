import { formatAgo, formatUSD, shortAddr, type OnchainTransfer } from "@/lib/onchain";
import { ArrowDownRight, ArrowUpRight, Repeat } from "lucide-react";

export function LiveTrades({
  transfers,
  title = "Live transfers",
}: {
  transfers: OnchainTransfer[];
  title?: string;
}) {
  return (
    <section className="card-surface flex flex-col overflow-hidden h-full">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="live-dot" />
          <h2 className="text-sm font-medium">{title}</h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">chain 4663</span>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[420px]">
        <table className="w-full text-xs">
          <tbody>
            {transfers.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={4}>
                  Waiting for transfer events…
                </td>
              </tr>
            )}
            {transfers.map((t) => {
              const swap = t.poolTagged;
              const buy = swap && t.from.startsWith("0x00")
                ? true
                : swap && t.to.length > 0
                  ? t.to.toLowerCase().endsWith("0000")
                  : true;
              return (
                <tr
                  key={t.id}
                  className="border-b border-border/40 hover:bg-surface-elevated/50"
                >
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1 font-mono font-medium ${
                        swap ? (buy ? "text-bull" : "text-bear") : "text-foreground"
                      }`}
                    >
                      {swap ? (
                        buy ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />
                      ) : (
                        <Repeat className="h-3 w-3 text-muted-foreground" />
                      )}
                      {t.symbol}
                    </span>
                  </td>
                  <td className="px-2 py-2 num text-right">
                    {t.amountUsd != null ? formatUSD(t.amountUsd) : `${t.amount.toFixed(2)}`}
                  </td>
                  <td className="px-2 py-2 num text-right text-muted-foreground">
                    {shortAddr(t.from)}
                  </td>
                  <td className="px-3 py-2 num text-right text-muted-foreground">
                    {formatAgo(t.timestampMs)}
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
