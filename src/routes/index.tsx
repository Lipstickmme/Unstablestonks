import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Header } from "@/components/terminal/Header";
import { Footer } from "@/components/terminal/Footer";
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
import { isQuoteAsset } from "@/lib/quote-assets";
import { useRotatingXHeat } from "@/lib/data/social";
import { useChain } from "@/lib/chain-context";
import { AlertTriangle } from "lucide-react";

interface HomeSearch {
  q?: string;
  /** Which face of the terminal is showing. Lives in the URL so the mobile tab
   *  bar survives a reload and a tab can be linked to. */
  view?: "all" | "watch" | "portfolio";
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    view: search.view === "watch" ? "watch" : search.view === "portfolio" ? "portfolio" : "all",
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
  const { chain, chainKey } = useChain();
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
        // Identity fields: backfill only, never overwrite live pool data.
        if (e.holders && !next.holders) next.holders = e.holders;
        if (e.dexName && !next.dexName) next.dexName = e.dexName;
        if (e.launchpadName && !next.launchpadName) next.launchpadName = e.launchpadName;
        if (e.ageMinutes != null && next.ageMinutes < 0) next.ageMinutes = e.ageMinutes;

        // AGGREGATES are different, and treating them like the rest was the
        // second half of the liquidity bug. The enrichment pass sums across
        // EVERY pool a token trades in; the row it is merging into was built
        // from the network-wide pool list, which is paginated by volume and so
        // usually knows one venue. Backfilling only when empty meant a row that
        // already had a single pool's $24k never received the $200k total.
        //
        // A sum over all venues is strictly more complete than a sum over some
        // of them, so the larger figure wins. It can only ever be the fuller
        // one — a subset cannot exceed its superset.
        const fuller = (cur: number | undefined, add: number | undefined) =>
          add != null && add > (cur ?? 0) ? add : cur;

        next.vol5m = fuller(next.vol5m, e.vol5m) ?? next.vol5m;
        next.vol1h = fuller(next.vol1h, e.vol1h) ?? next.vol1h;
        next.vol6h = fuller(next.vol6h, e.vol6h) ?? next.vol6h;
        next.vol24h = fuller(next.vol24h, e.vol24h) ?? next.vol24h;
        next.buys24h = fuller(next.buys24h, e.buys24h) ?? next.buys24h;
        next.sells24h = fuller(next.sells24h, e.sells24h) ?? next.sells24h;
        next.liquidityUsd = fuller(next.liquidityUsd, e.liquidityUsd);
        if (e.poolCount != null) next.poolCount = e.poolCount;

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
  // Drop the money side once, here, so every panel downstream — whale watch,
  // bundle detection, the portfolio's activity — inherits a feed about tokens
  // rather than about settlement.
  const chainTrades = useMemo(
    () => (tradesQ.data ?? []).filter((t) => !isQuoteAsset(chainKey, t.tokenAddress, t.symbol)),
    [tradesQ.data, chainKey],
  );
  // Per-token bundle stats so every row in the list carries its own read.
  const bundlesByToken = useMemo(() => analyzeBundlesByToken(chainTrades), [chainTrades]);

  return (
    <div className="app-shell min-h-screen">
      <Header />

      <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-4 sm:px-5 sm:py-5">
        {/* The page had no h1 at all — a crawler had nothing but the <title> to
            work out what this is. Visually it's a one-line strapline above the
            stats; structurally it's the document heading, and it names the
            chain in view so the heading changes with the content. */}
        <h1 className="sr-only sm:not-sr-only sm:mb-1 sm:block sm:text-sm sm:font-normal sm:text-muted-foreground">
          <span className="text-foreground font-medium">UnstableStonks</span> — live {chain.name}{" "}
          launchpad terminal: new token discovery, whale tracking, X social heat and non-custodial
          swaps.
        </h1>

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
            // Always named, so leaving the portfolio tab actually leaves it:
            // with undefined the table kept whatever tab it was last on, and
            // tapping Watchlist from Portfolio showed the portfolio again.
            forceTab={view === "portfolio" ? "portfolio" : "all"}
            bundles={bundlesByToken}
            insights={insightsQ.data}
            trades={chainTrades}
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

      <Footer />
    </div>
  );
}
