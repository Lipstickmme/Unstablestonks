import { formatNum, formatUSD } from "@/lib/format";
import type { ChainStats } from "@/lib/types";
import { useChain } from "@/lib/chain-context";
import { ArrowUpRight } from "lucide-react";

interface Props {
  stats?: ChainStats;
  loading?: boolean;
}

export function StatsOverview({ stats, loading }: Props) {
  const { chain } = useChain();

  const items = [
    {
      label: "24h transactions",
      value: stats && stats.trades24h > 0 ? formatNum(stats.trades24h) : "—",
    },
    {
      label: "Total addresses",
      value: stats?.totalAddresses ? formatNum(stats.totalAddresses) : "—",
    },
    {
      label: stats?.vol24h ? "24h DEX volume" : "Gas price",
      value: stats?.vol24h
        ? formatUSD(stats.vol24h)
        : stats?.gasPriceGwei
          ? `${stats.gasPriceGwei.toFixed(3)} gwei`
          : "—",
    },
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
          <p className="mt-2 font-mono text-[11px] text-muted-foreground/80">
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
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-elevated"
        >
          View on explorer <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.label} className="bg-surface p-5">
            <div className="text-xs text-muted-foreground">{it.label}</div>
            <div className="num mt-2 text-3xl font-light tracking-tight sm:text-4xl md:text-5xl">
              {loading && !stats ? <span className="text-muted-foreground/40">···</span> : it.value}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Metrics are read directly from {chain.name}'s block explorer and JSON-RPC. Market/DEX
        figures appear where a pricing source indexes the chain; otherwise on-chain counters are
        shown. Verify any figure against the explorer.
      </p>
    </section>
  );
}
