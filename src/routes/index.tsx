import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Header } from "@/components/terminal/Header";
import { StatsOverview } from "@/components/terminal/StatsOverview";
import { TokenTable } from "@/components/terminal/TokenTable";
import { HotSignals } from "@/components/terminal/HotSignals";
import { useChainStats, useTokens } from "@/lib/data/hooks";
import { useXSocialHeatMap } from "@/lib/data/social";
import { useChain } from "@/lib/chain-context";
import { AlertTriangle } from "lucide-react";

interface HomeSearch {
  q?: string;
  view?: "all" | "watch";
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    view: search.view === "watch" ? "watch" : "all",
  }),
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
  const { q, view } = Route.useSearch();
  const statsQ = useChainStats();
  const tokensQ = useTokens();

  // Crawl X for the CAs of the top tokens by 24h volume; merge heat into rows.
  const topAddresses = useMemo(
    () =>
      (tokensQ.data ?? [])
        .filter((t) => t.vol24h > 0)
        .slice(0, 5)
        .map((t) => t.address),
    [tokensQ.data],
  );
  const heatQ = useXSocialHeatMap(topAddresses);

  const tokens = useMemo(() => {
    const rows = tokensQ.data ?? [];
    const heat = heatQ.data;
    if (!heat) return rows;
    return rows.map((t) => {
      const h = heat[t.address];
      return h?.ok ? { ...t, socialHeat: h.heat } : t;
    });
  }, [tokensQ.data, heatQ.data]);

  return (
    <div className="min-h-screen">
      <Header />

      <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-4 sm:px-5 sm:py-5">
        <div className="fade-up">
          <StatsOverview stats={statsQ.data} loading={statsQ.isLoading} />
        </div>

        <div className="fade-up" style={{ animationDelay: "60ms" }}>
          <HotSignals tokens={tokens} />
        </div>

        {/* Full-width launches table — live activity moved to the token page. */}
        <div className="fade-up" style={{ animationDelay: "120ms" }}>
          <TokenTable
            tokens={tokens}
            loading={tokensQ.isLoading}
            error={tokensQ.isError}
            initialQuery={q}
            watchOnly={view === "watch"}
          />
        </div>

        <div className="card-surface flex items-start gap-3 p-4 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warn" />
          <p>
            <span className="text-foreground font-medium">Risk notice.</span> Launchpad tokens are
            experimental, highly volatile, and often thinly traded. Every figure here is pulled live
            from {chain.name}'s public RPC, block explorer, and DEX indexers — verify against{" "}
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
