import { formatNum, formatUSD, type ChainStats } from "@/lib/onchain";
import { ArrowUpRight } from "lucide-react";
import { Soon } from "./common";

interface Props {
  vol24h: number;
  tokenCount: number;
  stats: ChainStats | null;
  updatedAt: Date;
}

export function StatsOverview({ vol24h, tokenCount, stats, updatedAt }: Props) {
  const items = [
    { label: "Tracked 24h volume", value: formatUSD(vol24h), sub: "sum of ERC-20 volume_24h" },
    { label: "Tracked tokens", value: formatNum(tokenCount), sub: "from Blockscout token registry" },
    {
      label: stats ? "Chain tx today" : "Chain tx today",
      value: stats ? formatNum(stats.transactionsToday) : "—",
      sub: stats ? `block #${formatNum(stats.blockNumber)} · gas ${stats.gasPriceGwei.toFixed(2)} gwei` : "loading…",
    },
  ];
  return (
    <section className="card-surface p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">Protocol analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Independent on-chain reporting for pons markets on Robinhood Chain.
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground/80">
            <span className="live-dot mr-2 inline-block align-middle" />
            Live · updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}{" "}
            · Blockscout + rpc.mainnet.chain.robinhood.com
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full border border-border bg-surface p-1 text-xs">
            <button className="rounded-full bg-secondary px-3 py-1 font-medium">24h</button>
            <button className="rounded-full px-3 py-1 text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              All time <Soon label="soon" />
            </button>
          </div>
          <a
            href="https://robinhoodchain.blockscout.com"
            target="_blank"
            rel="noreferrer"
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
            <div className="mt-2 num text-4xl font-light tracking-tight md:text-5xl">{it.value}</div>
            <div className="mt-3 text-[11px] text-muted-foreground">{it.sub}</div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Derived from the public Blockscout indexer (all ERC-20s on chain 4663). A dedicated PONS
        factory feed — launch times, graduation curve, fee split, deployer profile — is <Soon label="wiring" />.
      </p>
    </section>
  );
}
