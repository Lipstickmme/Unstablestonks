import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Header } from "@/components/terminal/Header";
import { SwapPanel } from "@/components/terminal/SwapPanel";
import { PriceChart } from "@/components/terminal/PriceChart";
import { LiveTrades } from "@/components/terminal/LiveTrades";
import { XSocialPanel } from "@/components/terminal/XSocialPanel";
import { WhaleWatch } from "@/components/terminal/WhaleWatch";
import { BundleWatch } from "@/components/terminal/BundleWatch";
import { TokenIcon } from "@/components/terminal/TokenIcon";
import { formatAge, formatNum, formatUSD, shortAddr } from "@/lib/format";
import {
  useTokenDetail,
  useTokens,
  useTokenCandles,
  useTokenActivity,
  useTokenInsights,
  type ChartTimeframe,
} from "@/lib/data/hooks";
import { baseBotUrl } from "@/config/links";
import { venueLogo } from "@/config/brand";
import { BrandImage } from "@/components/brand/BrandImage";
import { useShareOfVoice } from "@/lib/data/social";
import { useChain } from "@/lib/chain-context";
import { ArrowLeft, BadgeCheck, Copy, ExternalLink, Rocket, Send, Users } from "lucide-react";

const TIMEFRAMES: { key: ChartTimeframe; label: string }[] = [
  { key: "minute", label: "1m" },
  { key: "hour", label: "1h" },
  { key: "day", label: "1d" },
];

export const Route = createFileRoute("/token/$address")({
  head: ({ params }) => ({
    meta: [
      { title: `${shortAddr(params.address)} · UnstableStonks` },
      {
        name: "description",
        content: `Live on-chain view: market data, holders, X social heat, and non-custodial trading for ${shortAddr(params.address)}.`,
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TokenDetail,
});

function TokenDetail() {
  const { address } = Route.useParams();
  const { chain } = useChain();
  const { data, isLoading, isError, error } = useTokenDetail(address);
  const [tf, setTf] = useState<ChartTimeframe>("hour");
  const candlesQ = useTokenCandles(data?.pool ?? null, tf);
  const candles = candlesQ.data ?? [];

  // Peers for share-of-voice: this chain's top tokens by 24h volume.
  const tokensQ = useTokens();
  const peers = (tokensQ.data ?? [])
    .filter((t) => t.vol24h > 0)
    .slice(0, 4)
    .map((t) => t.address);
  const shareOfVoice = useShareOfVoice(address, peers);

  const token = data?.token;
  // Holders + trades load behind the core so the header, stats and chart paint
  // as soon as identity and market data are known.
  const activityQ = useTokenActivity(address, token, data?.pool ?? null);
  const holders = activityQ.data?.holders ?? data?.holders ?? [];
  const trades = activityQ.data?.trades ?? data?.trades ?? [];
  // Distribution + listing intel for this one token, on the shared slow cycle.
  const insightsQ = useTokenInsights(token ? [token] : undefined);
  const insight = token ? insightsQ.data?.[token.address] : undefined;
  const positive = (token?.priceChange24h ?? 0) >= 0;
  const closes = candles.map((c) => c.c);

  return (
    <div className="min-h-screen">
      <Header />

      <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-4 sm:px-5 sm:py-5">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to terminal
        </Link>

        {isLoading && (
          <div className="card-surface p-16 text-center text-sm text-muted-foreground">
            Loading token from {chain.name}…
          </div>
        )}

        {isError && (
          <div className="card-surface p-16 text-center text-sm text-bear">
            {error instanceof Error ? error.message : "Token not found on this chain."} — try
            switching chains.
          </div>
        )}

        {token && (
          <>
            {/* Token header */}
            <section className="card-surface p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <TokenIcon url={token.logoUrl} symbol={token.symbol} size={48} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-2xl font-medium">{token.symbol}</h1>
                      <span className="text-muted-foreground">{token.name}</span>
                      <span className="chip !py-0 text-[9px]">
                        {token.priceSource === "geckoterminal"
                          ? "DEX-priced"
                          : token.priceSource === "explorer"
                            ? "explorer-priced"
                            : "unpriced"}
                      </span>
                      {token.launchpadName ? (
                        <span className="chip border-grad/40 bg-grad/10 !py-0 text-[9px] text-grad">
                          <Rocket className="h-2.5 w-2.5" /> {token.launchpadName}
                        </span>
                      ) : (
                        token.dexName && (
                          <span className="chip !py-0 text-[9px]">
                            <BrandImage
                              src={venueLogo(token.dexName)}
                              alt={token.dexName}
                              className="h-3 w-3 rounded-sm object-contain"
                              fallback={<></>}
                            />
                            {token.dexName}
                          </span>
                        )
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="num inline-flex items-center gap-1">
                        {shortAddr(token.address)}
                        <button onClick={() => navigator.clipboard.writeText(token.address)}>
                          <Copy className="h-3 w-3 hover:text-foreground" />
                        </button>
                        <a
                          href={`${chain.explorerUrl}/token/${token.address}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="h-3 w-3 hover:text-foreground" />
                        </a>
                      </span>
                      {token.ageMinutes > 0 && (
                        <span>Deployed {formatAge(token.ageMinutes)} ago</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="num text-3xl font-light">
                    {token.price > 0 ? formatUSD(token.price) : "—"}
                  </div>
                  {token.price > 0 && (
                    <div className={`num text-sm ${positive ? "text-bull" : "text-bear"}`}>
                      {positive ? "+" : ""}
                      {token.priceChange24h.toFixed(2)}% 24h
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-6">
                {[
                  { l: "Market cap", v: token.mcap > 0 ? formatUSD(token.mcap) : "—" },
                  { l: "FDV", v: token.fdv > 0 ? formatUSD(token.fdv) : "—" },
                  {
                    l: "Liquidity",
                    v: token.liquidityUsd ? formatUSD(token.liquidityUsd) : "—",
                  },
                  { l: "24h volume", v: token.vol24h > 0 ? formatUSD(token.vol24h) : "—" },
                  { l: "Holders", v: token.holders > 0 ? formatNum(token.holders) : "—" },
                  {
                    // Comes from the activity query once it lands; the row's own
                    // figure covers the gap so the tile isn't blank on arrival.
                    l: "Top holder",
                    v: (() => {
                      const pct = holders[0]?.pct ?? token.topHolderPct;
                      return pct > 0 ? `${pct.toFixed(1)}%` : "—";
                    })(),
                  },
                ].map((s) => (
                  <div key={s.l} className="bg-surface px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {s.l}
                    </div>
                    <div className="num mt-1 text-sm font-medium">{s.v}</div>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
              <div className="space-y-4">
                {/* Chart */}
                <section className="card-surface fade-up overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-medium">Price</h2>
                      {candles.length > 1 && (
                        <span className="chip">
                          <span className="live-dot" /> live
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {TIMEFRAMES.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => setTf(t.key)}
                          className={`rounded px-2 py-1 transition-colors ${
                            tf === t.key ? "bg-secondary text-foreground" : "hover:text-foreground"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="h-[260px] p-2 sm:h-[320px]">
                    {closes.length > 1 ? (
                      <PriceChart points={closes} positive={positive} />
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
                        {candlesQ.isLoading && data.pool
                          ? "Loading price history…"
                          : `Price history appears once a DEX indexes this pool on ${chain.name}. Live on-chain activity below still populates from the explorer.`}
                      </div>
                    )}
                  </div>
                </section>

                {/* On-chain profile */}
                <section className="card-surface p-4">
                  <h3 className="text-sm font-medium">On-chain profile</h3>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                    <Field
                      label="Total supply"
                      value={<span className="num">{formatNum(token.totalSupply ?? 0)}</span>}
                    />
                    <Field
                      label="Decimals"
                      value={<span className="num">{token.decimals ?? "—"}</span>}
                    />
                    <Field
                      label="Holders"
                      value={<span className="num">{formatNum(token.holders)}</span>}
                    />
                    <Field
                      label="Price source"
                      value={<span className="num">{token.priceSource ?? "none"}</span>}
                    />
                    <Field
                      label="Dev holding"
                      value={
                        <span className="num">
                          {insight?.devHoldingPct == null
                            ? "—"
                            : `${insight.devHoldingPct.toFixed(2)}%`}
                        </span>
                      }
                    />
                    <Field
                      label="Top 10 holders"
                      value={
                        <span className="num">
                          {insight?.top10Pct == null ? "—" : `${insight.top10Pct.toFixed(1)}%`}
                        </span>
                      }
                    />
                    <Field
                      label="DEX paid"
                      value={
                        insight?.dexUnsupported ? (
                          <span className="num text-muted-foreground">
                            chain not on DexScreener
                          </span>
                        ) : insight?.dexPaid == null ? (
                          <span className="num text-muted-foreground">—</span>
                        ) : insight.dexPaid ? (
                          <span className="inline-flex items-center gap-1 text-bull">
                            <BadgeCheck className="h-3 w-3" /> paid
                          </span>
                        ) : (
                          <span className="text-muted-foreground">unpaid</span>
                        )
                      }
                    />
                  </div>
                </section>

                {/* Holders */}
                <section className="card-surface p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5" />
                      <h3 className="text-sm font-medium">Top holders</h3>
                    </div>
                    <span className="text-[11px] text-muted-foreground">from explorer · live</span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {holders.length === 0 && (
                      <p className="py-2 text-xs text-muted-foreground">
                        {activityQ.isLoading
                          ? "Loading holder distribution…"
                          : "Holder distribution not indexed yet."}
                      </p>
                    )}
                    {holders.map((h, i) => (
                      <div key={h.address + i} className="flex items-center gap-3">
                        <span className="num w-4 text-[11px] text-muted-foreground">{i + 1}</span>
                        <a
                          href={`${chain.explorerUrl}/address/${h.address}`}
                          target="_blank"
                          rel="noreferrer"
                          className="num text-xs hover:text-primary"
                        >
                          {shortAddr(h.address)}
                        </a>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full bg-primary/70"
                            style={{
                              width: `${Math.min(100, (h.pct / (holders[0]?.pct || 1)) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="num w-14 text-right text-xs text-muted-foreground">
                          {h.pct.toFixed(2)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Activity reads as a continuation of the holder list, so it
                    sits under it in the main column rather than in the rail. */}
                <LiveTrades
                  trades={trades}
                  loading={activityQ.isLoading}
                  token={token.address}
                  decimals={token.decimals ?? 18}
                  totalSupply={token.totalSupply ?? 0}
                />
              </div>

              <div className="space-y-4">
                <SwapPanel token={token} />
                <a
                  href={baseBotUrl(token.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface py-2.5 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-surface-elevated"
                >
                  <Send className="h-3.5 w-3.5" /> Buy {token.symbol} on BaseBot
                </a>
                <XSocialPanel
                  address={token.address}
                  symbol={token.symbol}
                  shareOfVoice={shareOfVoice}
                />
                <BundleWatch trades={trades} />
                <WhaleWatch trades={trades} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs font-medium">{value}</div>
    </div>
  );
}
