import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/terminal/Header";
import { StatsOverview } from "@/components/terminal/StatsOverview";
import { TokenTable } from "@/components/terminal/TokenTable";
import { LiveTrades } from "@/components/terminal/LiveTrades";
import { HotSignals } from "@/components/terminal/HotSignals";
import { useChainStats, useTokens, useRecentActivity } from "@/lib/data/hooks";
import { useChain } from "@/lib/chain-context";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "UnstableStonks — multichain launchpad terminal" },
      {
        name: "description",
        content:
          "Discover, monitor, and trade tokens across Robinhood Chain, Stable, and Arc. Live on-chain data, X social heat, and non-custodial swaps.",
      },
      { property: "og:title", content: "UnstableStonks — live multichain terminal" },
      {
        property: "og:description",
        content: "One terminal, three chains. All state derived from live on-chain sources.",
      },
    ],
  }),
  component: Terminal,
});

function Terminal() {
  const { chain } = useChain();
  const statsQ = useChainStats();
  const tokensQ = useTokens();
  const tradesQ = useRecentActivity(tokensQ.data);

  const tokens = tokensQ.data ?? [];

  return (
    <div className="min-h-screen">
      <Header />

      <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-4 sm:px-5 sm:py-5">
        <StatsOverview stats={statsQ.data} loading={statsQ.isLoading} />

        <HotSignals tokens={tokens} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <TokenTable tokens={tokens} loading={tokensQ.isLoading} error={tokensQ.isError} />
          <LiveTrades trades={tradesQ.data ?? []} loading={tradesQ.isLoading} />
        </div>

        <div className="card-surface flex items-start gap-3 p-4 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warn" />
          <p>
            <span className="text-foreground font-medium">Risk notice.</span> Launchpad tokens are
            experimental, highly volatile, and often thinly traded. Every figure here is pulled live
            from {chain.name}'s public RPC and block explorer — verify against{" "}
            <a
              href={chain.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              the explorer
            </a>{" "}
            before trading. This terminal never custodies funds and never requests keys.
          </p>
        </div>
      </div>
    </div>
  );
}
