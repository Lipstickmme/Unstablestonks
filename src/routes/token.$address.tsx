import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo } from "react";
import { Header } from "@/components/terminal/Header";
import { SwapPanel } from "@/components/terminal/SwapPanel";
import { PriceChart } from "@/components/terminal/PriceChart";
import { LiveTrades } from "@/components/terminal/LiveTrades";
import {
  formatAge, formatNum, formatUSD, generateTokens, generateTrades, shortAddr,
} from "@/lib/mock-data";
import {
  ArrowLeft, Copy, ExternalLink, Twitter, Send, Globe, Lock, Unlock, Users, Zap, Flame, Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/token/$address")({
  head: ({ params }) => ({
    meta: [
      { title: `${shortAddr(params.address)} · pons/terminal` },
      { name: "description", content: `Live on-chain view: swaps, holders, CTO status, social heat, and non-custodial trading for ${shortAddr(params.address)} on PONS.` },
      { property: "og:title", content: `${shortAddr(params.address)} · pons/terminal` },
      { property: "og:description", content: `Real-time PONS launchpad intelligence for ${shortAddr(params.address)}.` },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ params }) => {
    const tokens = generateTokens(48);
    const token = tokens.find((t) => t.address.toLowerCase() === params.address.toLowerCase()) ?? tokens[0];
    if (!token) throw notFound();
    return { token, tokens };
  },
  component: TokenDetail,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-bear">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Token not indexed.</div>,
});

function TokenDetail() {
  const { token, tokens } = Route.useLoaderData();
  const trades = useMemo(() => generateTrades([token, ...tokens.slice(0, 5)], 40), [token, tokens]);
  const positive = token.priceChange24h >= 0;

  return (
    <div className="min-h-screen">
      <Header />

      <div className="mx-auto max-w-[1600px] space-y-4 px-5 py-5">
        <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to terminal
        </Link>

        {/* Token header */}
        <section className="card-surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-secondary text-3xl">
                {token.logo}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-medium">{token.symbol}</h1>
                  <span className="text-muted-foreground">{token.name}</span>
                  {token.status.includes("cto") && (
                    <span className="chip text-cto border-cto/40 bg-cto/10">
                      <Zap className="h-2.5 w-2.5" /> New CTO
                    </span>
                  )}
                  {token.status.includes("new") && (
                    <span className="chip text-primary border-primary/40 bg-primary/10">
                      <Sparkles className="h-2.5 w-2.5" /> Just launched
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="num inline-flex items-center gap-1">
                    {shortAddr(token.address)}
                    <button onClick={() => navigator.clipboard.writeText(token.address)}>
                      <Copy className="h-3 w-3 hover:text-foreground" />
                    </button>
                    <a href="#"><ExternalLink className="h-3 w-3 hover:text-foreground" /></a>
                  </span>
                  <span>Deployed {formatAge(token.ageMinutes)} ago</span>
                  <span>·</span>
                  <span>Deployer <span className="num text-foreground">{shortAddr(token.deployer)}</span></span>
                  <div className="flex items-center gap-2 ml-2">
                    {token.socials.twitter && <Twitter className="h-3.5 w-3.5 hover:text-foreground cursor-pointer" />}
                    {token.socials.telegram && <Send className="h-3.5 w-3.5 hover:text-foreground cursor-pointer" />}
                    {token.socials.website && <Globe className="h-3.5 w-3.5 hover:text-foreground cursor-pointer" />}
                  </div>
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="num text-3xl font-light">{formatUSD(token.price)}</div>
              <div className={`num text-sm ${positive ? "text-bull" : "text-bear"}`}>
                {positive ? "+" : ""}{token.priceChange24h.toFixed(2)}% 24h
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-6">
            {[
              { l: "Market cap", v: formatUSD(token.mcap) },
              { l: "FDV", v: formatUSD(token.fdv) },
              { l: "Liquidity", v: `${token.liquidityEth.toFixed(2)} ETH` },
              { l: "24h volume", v: formatUSD(token.vol24h) },
              { l: "Holders", v: formatNum(token.holders) },
              { l: "Top holder", v: `${token.topHolderPct.toFixed(1)}%` },
            ].map((s) => (
              <div key={s.l} className="bg-surface px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
                <div className="num mt-1 text-sm font-medium">{s.v}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            {/* Chart */}
            <section className="card-surface overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium">Price · derived from Swap events</h2>
                  <span className="chip"><span className="live-dot" /> live</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf, i) => (
                    <button key={tf}
                      className={`rounded px-2 py-1 ${i === 2 ? "bg-secondary text-foreground" : "hover:text-foreground"}`}>
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[320px] p-2">
                <PriceChart seed={parseInt(token.address.slice(2, 8), 16) % 999} positive={positive} />
              </div>
            </section>

            {/* Graduation + on-chain profile */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <section className="card-surface p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Graduation</h3>
                  <span className="num text-xs text-muted-foreground">
                    {token.graduationPct >= 100 ? "Graduated" : `${token.graduationPct.toFixed(1)}% → 4.2 ETH`}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full ${token.graduationPct >= 100 ? "bg-bull" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, token.graduationPct)}%` }}
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <Field label="Fee split" value={<span className="num">{token.feeSplit}</span>} />
                  <Field
                    label="Liquidity"
                    value={
                      token.lockedLiquidity ? (
                        <span className="inline-flex items-center gap-1 text-bull"><Lock className="h-3 w-3" /> Locked</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-warn"><Unlock className="h-3 w-3" /> Unlocked</span>
                      )
                    }
                  />
                  <Field label="Restrictions"
                    value={token.restrictionsEndBlock
                      ? <span className="num">ends #{token.restrictionsEndBlock}</span>
                      : <span className="text-muted-foreground">expired</span>} />
                  <Field label="Buys / sells 24h" value={
                    <span className="num">
                      <span className="text-bull">{formatNum(token.buys24h)}</span>
                      {" / "}
                      <span className="text-bear">{formatNum(token.sells24h)}</span>
                    </span>
                  } />
                </div>
              </section>

              <section className="card-surface p-4">
                <div className="flex items-center gap-2">
                  <Flame className="h-3.5 w-3.5 text-hot" />
                  <h3 className="text-sm font-medium">X · social intelligence</h3>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="num text-3xl font-light">{token.socialHeat}</div>
                  <div className="flex-1">
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full bg-hot" style={{ width: `${token.socialHeat}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      unique accounts posting CA · last hour
                    </div>
                  </div>
                </div>
                <ul className="mt-3 space-y-2 text-xs">
                  {[
                    { h: "@0xdegen · 4.2k eng", t: `just aped ${token.symbol}, CA verified on-chain, 90/10 split` },
                    { h: "@memecapo · 1.1k eng", t: `${token.symbol} chart looks primed, liquidity locked` },
                    { h: "@onchainowl · 780 eng", t: `deployer wallet clean, previous launches: 3` },
                  ].map((p) => (
                    <li key={p.h} className="rounded-lg border border-border bg-background p-2.5">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{p.h}</span>
                        <Twitter className="h-3 w-3" />
                      </div>
                      <div className="mt-0.5 text-foreground">{p.t}</div>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {/* Holders */}
            <section className="card-surface p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5" />
                  <h3 className="text-sm font-medium">Top holders</h3>
                </div>
                <span className="text-[11px] text-muted-foreground">from Transfer events · client-side</span>
              </div>
              <div className="mt-3 space-y-1.5">
                {Array.from({ length: 6 }).map((_, i) => {
                  const pct = Math.max(1, token.topHolderPct - i * (token.topHolderPct / 8));
                  const isDeployer = i === 2;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="num w-4 text-[11px] text-muted-foreground">{i + 1}</span>
                      <span className="num text-xs">{shortAddr(`0x${((i + 7) * 91238471234).toString(16)}00000000`)}</span>
                      {isDeployer && <span className="chip text-warn border-warn/40 bg-warn/10">deployer</span>}
                      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-primary/70" style={{ width: `${(pct / token.topHolderPct) * 100}%` }} />
                      </div>
                      <span className="num text-xs text-muted-foreground w-12 text-right">{pct.toFixed(2)}%</span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <SwapPanel token={token} />
            <LiveTrades trades={trades} />
          </div>
        </div>
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
