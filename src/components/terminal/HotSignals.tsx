import { Flame, Users, TrendingUp, Coins, MessageCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { formatNum, formatUSD } from "@/lib/format";
import type { TokenRow } from "@/lib/types";

export function HotSignals({ tokens }: { tokens: TokenRow[] }) {
  const byMcap = [...tokens]
    .filter((t) => t.mcap > 0)
    .sort((a, b) => b.mcap - a.mcap)
    .slice(0, 4);
  const byVol = [...tokens]
    .filter((t) => t.vol24h > 0)
    .sort((a, b) => b.vol24h - a.vol24h)
    .slice(0, 4);
  const byHolders = [...tokens]
    .filter((t) => t.holders > 0)
    .sort((a, b) => b.holders - a.holders)
    .slice(0, 4);
  // Real crawl results only — tokens whose CA showed up on X this cycle.
  const byHeat = [...tokens]
    .filter((t) => t.socialHeat > 0)
    .sort((a, b) => b.socialHeat - a.socialHeat)
    .slice(0, 4);

  const cards = [
    {
      title: "Top market cap",
      icon: <Coins className="h-3.5 w-3.5 text-primary" />,
      items: byMcap,
      kind: "mcap" as const,
    },
    {
      title: "24h volume",
      icon: <Flame className="h-3.5 w-3.5 text-hot" />,
      items: byVol,
      kind: "vol" as const,
    },
    {
      title: "Most holders",
      icon: <Users className="h-3.5 w-3.5 text-grad" />,
      items: byHolders,
      kind: "holders" as const,
    },
    {
      title: "X heat · CA mentions",
      icon: <MessageCircle className="intel-glow h-3.5 w-3.5 rounded-full text-hot" />,
      items: byHeat,
      kind: "heat" as const,
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <div key={c.title} className="card-surface p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {c.icon}
              <h3 className="text-sm font-medium">{c.title}</h3>
            </div>
            <TrendingUp className="h-3 w-3 text-muted-foreground" />
          </div>
          <ul className="mt-3 space-y-1.5">
            {c.items.length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">
                {c.kind === "heat"
                  ? "Crawling X for contract mentions…"
                  : "No signal yet — feed is live."}
              </li>
            )}
            {c.items.map((t, i) => (
              <li key={t.address}>
                <Link
                  to="/token/$address"
                  params={{ address: t.address }}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-elevated"
                >
                  <span className="num w-4 text-[10px] text-muted-foreground">{i + 1}</span>
                  <span className="grid h-5 w-5 flex-shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-[9px] font-semibold text-muted-foreground">
                    {t.logoUrl ? (
                      <img src={t.logoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      t.logo
                    )}
                  </span>
                  <span className="truncate text-xs font-medium">{t.symbol}</span>
                  <span className="num ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {c.kind === "mcap" && formatUSD(t.mcap)}
                    {c.kind === "holders" && formatNum(t.holders)}
                    {c.kind === "vol" && formatUSD(t.vol24h)}
                    {c.kind === "heat" && (
                      <>
                        <span className="inline-block h-1 w-8 overflow-hidden rounded-full bg-secondary align-middle">
                          <span
                            className="block h-full bg-hot"
                            style={{ width: `${t.socialHeat}%` }}
                          />
                        </span>
                        {t.socialHeat}
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
