import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Header } from "@/components/terminal/Header";
import { StatsOverview } from "@/components/terminal/StatsOverview";
import { TokenTable } from "@/components/terminal/TokenTable";
import { LiveTrades } from "@/components/terminal/LiveTrades";
import { HotSignals } from "@/components/terminal/HotSignals";
import { generateTokens, generateTrades } from "@/lib/mock-data";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "pons/terminal — live PONS launches on Robinhood Chain" },
      { name: "description", content: "Discover, monitor, and trade every token launched on PONS. Sub-second on-chain intelligence, CTO detection, social heat, and non-custodial swaps." },
      { property: "og:title", content: "pons/terminal — live PONS launches" },
      { property: "og:description", content: "The fastest terminal for the PONS launchpad. All state derived from on-chain sources of truth." },
    ],
  }),
  component: Terminal,
});

function Terminal() {
  const tokens = useMemo(() => generateTokens(48), []);
  const [trades, setTrades] = useState(() => generateTrades(tokens, 40));
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => {
      setTrades((prev) => [...generateTrades(tokens, 3), ...prev].slice(0, 60));
      setNow(new Date());
    }, 2500);
    return () => clearInterval(id);
  }, [tokens]);

  const vol24h = tokens.reduce((s, t) => s + t.vol24h, 0);
  const trades24h = tokens.reduce((s, t) => s + t.buys24h + t.sells24h, 0);

  return (
    <div className="min-h-screen">
      <Header />

      <div className="mx-auto max-w-[1600px] space-y-4 px-5 py-5">
        <StatsOverview
          vol24h={vol24h}
          launches24h={tokens.filter((t) => t.ageMinutes < 60 * 24).length * 400}
          trades24h={trades24h}
          updatedAt={now}
        />

        <HotSignals tokens={tokens} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <TokenTable tokens={tokens} />
          <LiveTrades trades={trades} />
        </div>

        <div className="card-surface flex items-start gap-3 p-4 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warn" />
          <p>
            <span className="text-foreground font-medium">Risk notice.</span> Launchpad tokens are experimental, highly volatile, and often thinly traded. Copycat names, unlocked liquidity, and early deployer sells are common. Every figure here is derived client-side from the public RPC — verify against the block explorer before trading. This terminal never custodies funds and never requests keys.
          </p>
        </div>
      </div>
    </div>
  );
}
