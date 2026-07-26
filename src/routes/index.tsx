import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Header } from "@/components/terminal/Header";
import { StatsOverview } from "@/components/terminal/StatsOverview";
import { TokenTable } from "@/components/terminal/TokenTable";
import { HotSignals } from "@/components/terminal/HotSignals";
import { WhaleWatch } from "@/components/terminal/WhaleWatch";
import { BundleWatch } from "@/components/terminal/BundleWatch";
import {
  useChainStats,
  useTokens,
  useRowEnrichment,
  useTokenInsights,
  useChainTrades,
  useDyorTokens,
  applyDyor,
} from "@/lib/data/hooks";
import { analyzeBundlesByToken } from "@/lib/bundles";
import { useRotatingXHeat } from "@/lib/data/social";
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
  const topAddresses = useMemo(() => (tokensQ.data ?? []).map((t) => t.address), [tokensQ.data]);
  // Every token on the list gets crawled, a slice at a time (see the hook).
  const heat = useRotatingXHeat(topAddresses);
  const enrichQ = useRowEnrichment(tokensQ.data);
  const insightsQ = useTokenInsights(tokensQ.data);
  const dyorQ = useDyorTokens();

  const tokens = useMemo(() => {
    const rows = tokensQ.data ?? [];
    const enrich = enrichQ.data;
    const dyor = dyorQ.data;
    if (!Object.keys(heat).length && !enrich && !dyor) return rows;
    return rows.map((t) => {
      const h = heat[t.address];
      const e = enrich?.[t.address];
      const next = { ...t };
      // Real launchpad curve progress + graduation, where DYOR knows the token.
      const d = dyor?.[t.address];
      if (d) applyDyor(next, d);
      if (h?.ok) next.socialHeat = h.heat;
      if (e) {
        // Backfill only what the row is actually missing — never overwrite live
        // pool data with the enrichment pass.
        if (e.holders && !next.holders) next.holders = e.holders;
        if (e.dexName && !next.dexName) next.dexName = e.dexName;
        if (e.launchpadName && !next.launchpadName) next.launchpadName = e.launchpadName;
        if (e.ageMinutes != null && next.ageMinutes < 0) next.ageMinutes = e.ageMinutes;
        if (e.vol5m && !next.vol5m) next.vol5m = e.vol5m;
        if (e.vol1h && !next.vol1h) next.vol1h = e.vol1h;
        if (e.vol6h && !next.vol6h) next.vol6h = e.vol6h;
        if (e.buys24h && !next.buys24h) next.buys24h = e.buys24h;
        if (e.sells24h && !next.sells24h) next.sells24h = e.sells24h;
        if (e.sparkline && !next.sparkline) {
          next.sparkline = e.sparkline;
          next.priceChange24h = e.priceChange24h ?? next.priceChange24h;
          next.priceSource = "geckoterminal";
        }
      }
      return next;
    });
  }, [tokensQ.data, heat, enrichQ.data, dyorQ.data]);

  // Chain-wide 24h volume + whether the current run-rate is rising or falling.
  const volume = useMemo(() => {
    const total24h = tokens.reduce((s, t) => s + (t.vol24h || 0), 0);
    const total6h = tokens.reduce((s, t) => s + (t.vol6h || 0), 0);
    // 6h run-rate annualised to 24h vs the actual 24h figure = momentum.
    const change = total24h > 0 && total6h > 0 ? ((total6h * 4) / total24h - 1) * 100 : undefined;
    return { total24h, change };
  }, [tokens]);

  const tradesQ = useChainTrades(tokens);
  const chainTrades = useMemo(() => tradesQ.data ?? [], [tradesQ.data]);
  // Per-token bundle stats so every row in the list carries its own read.
  const bundlesByToken = useMemo(() => analyzeBundlesByToken(chainTrades), [chainTrades]);

  return (
    <div className="min-h-screen">
      <Header />

      <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-4 sm:px-5 sm:py-5">
        <div className="fade-up">
          <StatsOverview
            stats={statsQ.data}
            loading={statsQ.isLoading}
            vol24h={volume.total24h}
            vol24hChange={volume.change}
          />
        </div>

        <div className="fade-up" style={{ animationDelay: "60ms" }}>
          <HotSignals tokens={tokens} />
        </div>

        {/* Chain-wide flow intelligence over the busiest pools' real swaps. */}
        <div
          className="fade-up grid grid-cols-1 gap-4 md:grid-cols-2"
          style={{ animationDelay: "90ms" }}
        >
          <BundleWatch trades={chainTrades} tokens={tokens} />
          <WhaleWatch trades={chainTrades} />
        </div>

        {/* Full-width launches table — live activity moved to the token page. */}
        <div className="fade-up" style={{ animationDelay: "120ms" }}>
          <TokenTable
            tokens={tokens}
            loading={tokensQ.isLoading}
            error={tokensQ.isError}
            initialQuery={q}
            watchOnly={view === "watch"}
            bundles={bundlesByToken}
            insights={insightsQ.data}
          />
        </div>

        <div className="card-surface flex items-start gap-3 p-4 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warn" />
          <p>
            <span className="text-foreground font-medium">Risk notice.</span> Launchpad tokens are
            experimental, highly volatile, and often thinly traded. Figures are pulled live and can
            lag — verify against{" "}
            <a
              href={chain.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              the explorer
            </a>{" "}
            before trading.
          </p>
        </div>
      </div>
    </div>
  );
}
