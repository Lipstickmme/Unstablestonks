import { formatUSD, formatNum } from "@/lib/mock-data";
import { ArrowUpRight } from "lucide-react";

interface Props {
  vol24h: number;
  launches24h: number;
  trades24h: number;
  updatedAt: Date;
}

export function StatsOverview({ vol24h, launches24h, trades24h, updatedAt }: Props) {
  const items = [
    { label: "24h volume", value: formatUSD(vol24h), delta: -18.5 },
    { label: "24h launches", value: formatNum(launches24h), delta: -14.9 },
    { label: "24h trades", value: formatNum(trades24h), delta: -9.6 },
  ];
  return (
    <section className="card-surface p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">Protocol analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Independent onchain reporting for pons markets on Robinhood Chain.
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground/80">
            <span className="live-dot mr-2 inline-block align-middle" />
            Live · block feed updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} UTC{'\u00A0'}·{'\u00A0'}RPC rpc.mainnet.chain.robinhood.com
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full border border-border bg-surface p-1 text-xs">
            <button className="rounded-full bg-secondary px-3 py-1 font-medium">24h</button>
            <button className="rounded-full px-3 py-1 text-muted-foreground hover:text-foreground">All time</button>
          </div>
          <a
            href="#"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-elevated"
          >
            View on explorer <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
        {items.map((it) => (
          <div key={it.label} className="bg-surface p-5">
            <div className="text-xs text-muted-foreground">{it.label}</div>
            <div className="mt-2 num text-4xl font-light tracking-tight md:text-5xl">
              {it.value}
            </div>
            <div className={`mt-3 text-xs ${it.delta >= 0 ? "text-bull" : "text-bear"}`}>
              {it.delta >= 0 ? "+" : ""}
              {it.delta}% from prior day
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Data derived client-side from factory TokenLaunched + pool Swap events. The 24h view uses the latest completed UTC day. Verify any figure against the block explorer.
      </p>
    </section>
  );
}
