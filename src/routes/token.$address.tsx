import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/terminal/Header";
import { SwapPanel } from "@/components/terminal/SwapPanel";
import { LiveTrades } from "@/components/terminal/LiveTrades";
import { Soon, TokenIcon } from "@/components/terminal/common";
import {
  EXPLORER,
  fetchHolders,
  fetchToken,
  fetchTokenTransfers,
  formatNum,
  formatUSD,
  shortAddr,
} from "@/lib/onchain";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Users,
  Flame,
} from "lucide-react";

export const Route = createFileRoute("/token/$address")({
  head: ({ params }) => ({
    meta: [
      { title: `${shortAddr(params.address)} · pons/terminal` },
      {
        name: "description",
        content: `Live on-chain view: transfers, holders, and market data for ${shortAddr(params.address)} on Robinhood Chain.`,
      },
      { property: "og:title", content: `${shortAddr(params.address)} · pons/terminal` },
      {
        property: "og:description",
        content: `Real-time on-chain intelligence for ${shortAddr(params.address)}.`,
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TokenDetail,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-bear">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8">Token not indexed.</div>,
});

function TokenDetail() {
  const { address } = Route.useParams();

  const tokenQ = useQuery({
    queryKey: ["token", address],
    queryFn: () => fetchToken(address),
    refetchInterval: 30_000,
  });
  const transfersQ = useQuery({
    queryKey: ["token-transfers", address],
    queryFn: () => fetchTokenTransfers(address),
    refetchInterval: 6_000,
  });
  const holdersQ = useQuery({
    queryKey: ["holders", address],
    queryFn: () => fetchHolders(address),
    refetchInterval: 60_000,
  });

  const token = tokenQ.data;

  if (tokenQ.isLoading) {
    return (
      <div className="min-h-screen">
        <Header />
        <div className="mx-auto max-w-[1600px] px-5 py-10 text-sm text-muted-foreground">
          Loading token from Blockscout…
        </div>
      </div>
    );
  }
  if (!token) {
    return (
      <div className="min-h-screen">
        <Header />
        <div className="mx-auto max-w-[1600px] px-5 py-10 text-sm text-muted-foreground">
          Token <span className="num">{shortAddr(address)}</span> not found on chain 4663.
        </div>
      </div>
    );
  }

  const transfers = transfersQ.data ?? [];
  const holders = holdersQ.data ?? [];
  const topPct = holders[0]?.pct ?? 0;

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
              <TokenIcon iconUrl={token.iconUrl} symbol={token.symbol} size={56} />
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-medium">{token.symbol}</h1>
                  <span className="text-muted-foreground">{token.name}</span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="num inline-flex items-center gap-1">
                    {shortAddr(token.address)}
                    <button onClick={() => navigator.clipboard.writeText(token.address)}>
                      <Copy className="h-3 w-3 hover:text-foreground" />
                    </button>
                    <a
                      href={`${EXPLORER}/token/${token.address}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="h-3 w-3 hover:text-foreground" />
                    </a>
                  </span>
                  <span>Decimals <span className="num text-foreground">{token.decimals}</span></span>
                  <span>·</span>
                  <span>Supply <span className="num text-foreground">{formatNum(token.totalSupply)}</span></span>
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="num text-3xl font-light">{formatUSD(token.price)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground inline-flex items-center gap-1">
                24h Δ <Soon label="soon" />
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-6">
            {[
              { l: "Market cap", v: formatUSD(token.mcap) },
              { l: "24h volume", v: formatUSD(token.vol24h) },
              { l: "Holders", v: formatNum(token.holders) },
              { l: "Top holder", v: topPct ? `${topPct.toFixed(1)}%` : "—" },
              { l: "Liquidity", soon: true },
              { l: "Launched", soon: true },
            ].map((s) => (
              <div key={s.l} className="bg-surface px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
                <div className="num mt-1 text-sm font-medium">
                  {"soon" in s && s.soon ? <Soon label="soon" /> : s.v}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            {/* Chart placeholder */}
            <section className="card-surface overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium">Price chart</h2>
                  <Soon label="deriving from Swap events" />
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf, i) => (
                    <button
                      key={tf}
                      className={`rounded px-2 py-1 ${i === 2 ? "bg-secondary text-foreground" : "hover:text-foreground"}`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid h-[320px] place-items-center p-6 text-xs text-muted-foreground">
                <div className="text-center">
                  <div className="text-lg text-foreground">Chart coming soon</div>
                  <p className="mt-2 max-w-md">
                    We build the price series client-side by replaying pool <span className="num">Swap</span> logs
                    against <span className="num">slot0</span>. Wiring in progress — the current price above is
                    the live Blockscout exchange rate.
                  </p>
                </div>
              </div>
            </section>

            {/* Graduation + social */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <section className="card-surface p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Graduation</h3>
                  <Soon />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Requires the PONS bonding-curve factory + fee-split view. Once wired, this
                  card shows raised ETH, progress to 4.2 ETH, unlock block, and fee split.
                </p>
              </section>

              <section className="card-surface p-4">
                <div className="flex items-center gap-2">
                  <Flame className="h-3.5 w-3.5 text-hot" />
                  <h3 className="text-sm font-medium">X · social intelligence</h3>
                  <span className="ml-auto"><Soon /></span>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Free X crawlers rate-limit aggressively. We're plumbing a rotating scraper that
                  scores unique accounts posting the exact CA in the last hour, with anti-spam filtering.
                </p>
              </section>
            </div>

            {/* Holders — real */}
            <section className="card-surface p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5" />
                  <h3 className="text-sm font-medium">Top holders</h3>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  live · Blockscout /holders
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                {holdersQ.isLoading && (
                  <p className="text-xs text-muted-foreground">Loading holders…</p>
                )}
                {holders.map((h, i) => (
                  <div key={h.address + i} className="flex items-center gap-3">
                    <span className="num w-4 text-[11px] text-muted-foreground">{i + 1}</span>
                    <a
                      href={`${EXPLORER}/address/${h.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="num text-xs hover:text-foreground text-muted-foreground"
                    >
                      {shortAddr(h.address)}
                    </a>
                    {h.contractName && (
                      <span className="chip text-primary border-primary/40 bg-primary/10 text-[9px]">
                        {h.contractName}
                      </span>
                    )}
                    <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-primary/70"
                        style={{ width: `${Math.min(100, h.pct)}%` }}
                      />
                    </div>
                    <span className="num text-xs text-muted-foreground w-14 text-right">
                      {h.pct.toFixed(2)}%
                    </span>
                  </div>
                ))}
                {!holdersQ.isLoading && holders.length === 0 && (
                  <p className="text-xs text-muted-foreground">No holder data available.</p>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <SwapPanel token={token} />
            <LiveTrades transfers={transfers} title="Transfers" />
          </div>
        </div>
      </div>
    </div>
  );
}
