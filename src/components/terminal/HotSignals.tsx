import { Flame, Zap, TrendingUp, MessageCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { formatUSD, type TokenRow } from "@/lib/mock-data";

export function HotSignals({ tokens }: { tokens: TokenRow[] }) {
  const spikes = [...tokens].sort((a, b) => b.vol5m - a.vol5m).slice(0, 4);
  const ctos = tokens.filter((t) => t.status.includes("cto")).slice(0, 3);
  const social = [...tokens].sort((a, b) => b.socialHeat - a.socialHeat).slice(0, 4);

  const cards = [
    { title: "Volume spikes · 5m", icon: <Flame className="h-3.5 w-3.5 text-hot" />, items: spikes, kind: "vol" as const },
    { title: "New CTOs", icon: <Zap className="h-3.5 w-3.5 text-cto" />, items: ctos, kind: "cto" as const },
    { title: "X mentions · hot CA", icon: <MessageCircle className="h-3.5 w-3.5 text-primary" />, items: social, kind: "social" as const },
  ];

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
              <li className="text-xs text-muted-foreground py-2">No signal yet — feed live.</li>
            )}
            {c.items.map((t, i) => (
              <li key={t.address}>
                <Link
                  to="/token/$address"
                  params={{ address: t.address }}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-elevated"
                >
                  <span className="num w-4 text-[10px] text-muted-foreground">{i + 1}</span>
                  <span className="text-base">{t.logo}</span>
                  <span className="text-xs font-medium">{t.symbol}</span>
                  <span className="ml-auto num text-[11px] text-muted-foreground">
                    {c.kind === "vol" && formatUSD(t.vol5m)}
                    {c.kind === "cto" && t.ctoAt && `${Math.floor((Date.now() - t.ctoAt) / 3600000)}h ago`}
                    {c.kind === "social" && (
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1 w-8 rounded-full bg-secondary overflow-hidden inline-block align-middle">
                          <span className="block h-full bg-hot" style={{ width: `${t.socialHeat}%` }} />
                        </span>
                        {t.socialHeat}
                      </span>
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
