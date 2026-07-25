import { formatNum } from "@/lib/format";
import type { ChainStats } from "@/lib/types";
import { useChain } from "@/lib/chain-context";
import { AnimatedNumber } from "./AnimatedNumber";
import { ArrowUpRight } from "lucide-react";

interface Props {
  stats?: ChainStats;
  loading?: boolean;
}

interface Tile {
  label: string;
  value?: number;
  format: (n: number) => string;
}

export function StatsOverview({ stats, loading }: Props) {
  const { chain } = useChain();

  const gwei = (n: number) => `${n.toFixed(3)} gwei`;
  const pick = (n?: number) => (n && n > 0 ? n : undefined);

  // Block height + gas are always real (straight off JSON-RPC). Total txns /
  // addresses come from the explorer scrape and show "—" if it can't be parsed —
  // never a fabricated value.
  const tiles: Tile[] = [
    { label: "Block height", value: pick(stats?.blockNumber), format: formatNum },
    { label: "Gas price", value: pick(stats?.gasPriceGwei), format: gwei },
    { label: "Total transactions", value: pick(stats?.totalTransactions), format: formatNum },
    { label: "Total addresses", value: pick(stats?.totalAddresses), format: formatNum },
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

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="bg-surface p-4 sm:p-5">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className="num mt-2 text-2xl font-light tracking-tight sm:text-3xl md:text-4xl">
              {t.value == null ? (
                loading && !stats ? (
                  <span className="text-muted-foreground/40">···</span>
                ) : (
                  "—"
                )
              ) : (
                <AnimatedNumber value={t.value} format={t.format} />
              )}
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
