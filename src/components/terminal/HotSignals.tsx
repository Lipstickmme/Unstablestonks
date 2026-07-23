import { Flame, Zap, TrendingUp, MessageCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { formatUSD, type OnchainToken } from "@/lib/onchain";
import { Soon, TokenIcon } from "./common";

export function HotSignals({ tokens }: { tokens: OnchainToken[] }) {
  const leaders = [...tokens].sort((a, b) => b.vol24h - a.vol24h).slice(0, 5);

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* Real: 24h volume leaders */}
      <div className="card-surface p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-3.5 w-3.5 text-hot" />
            <h3 className="text-sm font-medium">Volume leaders · 24h</h3>
          </div>
          <TrendingUp className="h-3 w-3 text-muted-foreground" />
        </div>
        <ul className="mt-3 space-y-1.5">
          {leaders.map((t, i) => (
            <li key={t.address}>
              <Link
                to="/token/$address"
                params={{ address: t.address }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-elevated"
              >
                <span className="num w-4 text-[10px] text-muted-foreground">{i + 1}</span>
                <TokenIcon iconUrl={t.iconUrl} symbol={t.symbol} size={20} />
                <span className="text-xs font-medium">{t.symbol}</span>
                <span className="ml-auto num text-[11px] text-muted-foreground">
                  {formatUSD(t.vol24h)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* CTO – requires factory ownership tracking */}
      <div className="card-surface p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-cto" />
            <h3 className="text-sm font-medium">New CTOs</h3>
          </div>
          <Soon />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Community takeovers surface once the PONS factory ownership feed is wired. We watch
          <span className="num"> OwnershipTransferred</span> across launched tokens and cross-reference
          against original deployers.
        </p>
      </div>

      {/* X mentions – requires X/Twitter crawler */}
      <div className="card-surface p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-sm font-medium">X mentions · hot CA</h3>
          </div>
          <Soon />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Free X search hits daily rate limits fast — we're pluging in a rotating crawler
          that scores unique accounts posting the exact contract address in the last hour.
        </p>
      </div>
    </section>
  );
}
