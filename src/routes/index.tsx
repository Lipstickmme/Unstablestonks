import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Header } from "@/components/terminal/Header";
import { StatsOverview } from "@/components/terminal/StatsOverview";
import { TokenTable } from "@/components/terminal/TokenTable";
import { LiveTrades } from "@/components/terminal/LiveTrades";
import { HotSignals } from "@/components/terminal/HotSignals";
import {
  fetchChainStats,
  fetchGlobalTransfers,
  fetchTokens,
} from "@/lib/onchain";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "pons/terminal — live PONS launches on Robinhood Chain" },
      {
        name: "description",
        content:
          "Discover, monitor, and trade every token launched on PONS. Sub-second on-chain intelligence with real Blockscout data on Robinhood Chain 4663.",
      },
      { property: "og:title", content: "pons/terminal — live PONS launches" },
      {
        property: "og:description",
        content:
          "The fastest terminal for the PONS launchpad. All state derived from on-chain sources of truth.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Terminal,
});

function Terminal() {
  const tokensQ = useQuery({
    queryKey: ["tokens"],
    queryFn: fetchTokens,
    refetchInterval: 30_000,
  });
  const transfersQ = useQuery({
    queryKey: ["transfers"],
    queryFn: fetchGlobalTransfers,
    refetchInterval: 6_000,
  });
  const statsQ = useQuery({
    queryKey: ["chainStats"],
    queryFn: fetchChainStats,
    refetchInterval: 15_000,
  });

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 5_000);
    return () => clearInterval(id);
  }, []);

  const tokens = tokensQ.data ?? [];
  const transfers = transfersQ.data ?? [];
  const vol24h = tokens.reduce((s, t) => s + t.vol24h, 0);

  return (
    <div className="min-h-screen">
      <Header />

      <div className="mx-auto max-w-[1600px] space-y-4 px-5 py-5">
        <StatsOverview
          vol24h={vol24h}
          tokenCount={tokens.length}
          stats={statsQ.data ?? null}
          updatedAt={now}
        />

        <HotSignals tokens={tokens} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <TokenTable tokens={tokens} />
          <LiveTrades transfers={transfers} />
        </div>

        <div className="card-surface flex items-start gap-3 p-4 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warn" />
          <p>
            <span className="text-foreground font-medium">Risk notice.</span> Every figure is queried
            live from the public Blockscout indexer on Robinhood Chain (4663). Volatile tokens, unlocked
            liquidity, and early deployer sells are common. Verify against the block explorer. This terminal
            never custodies funds and never requests keys.
          </p>
        </div>
      </div>
    </div>
  );
}
