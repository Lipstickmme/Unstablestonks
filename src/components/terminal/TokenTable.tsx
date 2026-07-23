import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  formatAge, formatNum, formatUSD, shortAddr, type TokenRow, type TokenStatus,
} from "@/lib/mock-data";
import {
  ArrowDown, ArrowUp, Copy, ExternalLink, Flame, Zap, Users, Lock, Unlock,
  Twitter, Send, Globe, Sparkles,
} from "lucide-react";

type SortKey = "age" | "vol5m" | "vol1h" | "vol24h" | "mcap" | "graduationPct" | "socialHeat" | "priceChange24h";
type Filter = "all" | "new" | "trending" | "graduating" | "graduated" | "cto";

const FILTERS: { key: Filter; label: string; icon?: React.ReactNode }[] = [
  { key: "all", label: "All launches" },
  { key: "new", label: "New", icon: <Sparkles className="h-3 w-3" /> },
  { key: "trending", label: "Trending", icon: <Flame className="h-3 w-3" /> },
  { key: "graduating", label: "Graduating" },
  { key: "graduated", label: "Graduated" },
  { key: "cto", label: "CTO", icon: <Zap className="h-3 w-3" /> },
];

function StatusBadge({ s }: { s: TokenStatus }) {
  const map: Record<TokenStatus, { label: string; cls: string; icon?: React.ReactNode }> = {
    new: { label: "NEW", cls: "text-primary border-primary/40 bg-primary/10", icon: <Sparkles className="h-2.5 w-2.5" /> },
    trending: { label: "HOT", cls: "text-hot border-hot/40 bg-hot/10", icon: <Flame className="h-2.5 w-2.5" /> },
    graduating: { label: "GRAD", cls: "text-grad border-grad/40 bg-grad/10" },
    graduated: { label: "✓ GRAD", cls: "text-bull border-bull/40 bg-bull/10" },
    cto: { label: "CTO", cls: "text-cto border-cto/40 bg-cto/10", icon: <Zap className="h-2.5 w-2.5" /> },
  };
  const cfg = map[s];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider border ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function Delta({ v }: { v: number }) {
  const pos = v >= 0;
  return (
    <span className={`num text-xs ${pos ? "text-bull" : "text-bear"}`}>
      {pos ? "+" : ""}{v.toFixed(1)}%
    </span>
  );
}

function GradBar({ pct }: { pct: number }) {
  const done = pct >= 100;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full ${done ? "bg-bull" : "bg-primary"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="num text-[11px] text-muted-foreground w-9 text-right">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

export function TokenTable({ tokens }: { tokens: TokenRow[] }) {
  const [sort, setSort] = useState<SortKey>("vol24h");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    let r = tokens;
    if (filter !== "all") r = r.filter((t) => t.status.includes(filter));
    if (query) {
      const q = query.toLowerCase();
      r = r.filter((t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
      );
    }
    return [...r].sort((a, b) => {
      const av = (a as any)[sort];
      const bv = (b as any)[sort];
      return dir === "desc" ? bv - av : av - bv;
    });
  }, [tokens, sort, dir, filter, query]);

  function toggleSort(k: SortKey) {
    if (sort === k) setDir(dir === "desc" ? "asc" : "desc");
    else { setSort(k); setDir("desc"); }
  }

  const H = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors ${right ? "ml-auto" : ""}`}
    >
      {label}
      {sort === k && (dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
    </button>
  );

  return (
    <section className="card-surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                filter === f.key
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.icon}
              {f.label}
              {filter === f.key && (
                <span className="num text-[10px] text-muted-foreground">
                  {rows.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-44 rounded-full border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-ring"
          />
          <span className="chip">
            <span className="live-dot" /> live
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-elevated/40 text-left">
              <th className="px-4 py-2.5 w-[24%]"><H k={"age" as any} label="Token" /></th>
              <th className="px-2 py-2.5"><H k="age" label="Age" /></th>
              <th className="px-2 py-2.5 text-right"><H k="priceChange24h" label="Price 24h" right /></th>
              <th className="px-2 py-2.5 text-right"><H k="mcap" label="Mkt cap" right /></th>
              <th className="px-2 py-2.5 text-right"><H k="vol5m" label="V·5m" right /></th>
              <th className="px-2 py-2.5 text-right"><H k="vol1h" label="V·1h" right /></th>
              <th className="px-2 py-2.5 text-right"><H k="vol24h" label="V·24h" right /></th>
              <th className="px-2 py-2.5"><H k="graduationPct" label="Graduation" /></th>
              <th className="px-2 py-2.5"><H k="socialHeat" label="Social" /></th>
              <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted-foreground">Trade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.address}
                className="group border-b border-border/60 hover:bg-surface-elevated/60 transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    to="/token/$address"
                    params={{ address: t.address }}
                    className="flex items-center gap-3"
                  >
                    <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-secondary text-lg">
                      {t.logo}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{t.symbol}</span>
                        <span className="text-xs text-muted-foreground truncate">{t.name}</span>
                        <div className="flex gap-1">
                          {t.status.slice(0, 2).map((s) => <StatusBadge key={s} s={s} />)}
                        </div>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="num">{shortAddr(t.address)}</span>
                        <button
                          onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(t.address); }}
                          className="opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <a href="#" onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        {t.socials.twitter && <Twitter className="h-3 w-3 opacity-60" />}
                        {t.socials.telegram && <Send className="h-3 w-3 opacity-60" />}
                        {t.socials.website && <Globe className="h-3 w-3 opacity-60" />}
                        {t.lockedLiquidity ? (
                          <Lock className="h-3 w-3 text-bull opacity-70" />
                        ) : (
                          <Unlock className="h-3 w-3 text-warn opacity-70" />
                        )}
                      </div>
                    </div>
                  </Link>
                </td>
                <td className="px-2 py-3 num text-xs text-muted-foreground">{formatAge(t.ageMinutes)}</td>
                <td className="px-2 py-3 text-right">
                  <div className="num text-xs">{formatUSD(t.price)}</div>
                  <Delta v={t.priceChange24h} />
                </td>
                <td className="px-2 py-3 num text-right text-xs">{formatUSD(t.mcap)}</td>
                <td className="px-2 py-3 num text-right text-xs">{formatUSD(t.vol5m)}</td>
                <td className="px-2 py-3 num text-right text-xs">{formatUSD(t.vol1h)}</td>
                <td className="px-2 py-3 num text-right text-xs">{formatUSD(t.vol24h)}</td>
                <td className="px-2 py-3"><GradBar pct={t.graduationPct} /></td>
                <td className="px-2 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-14 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-hot"
                        style={{ width: `${t.socialHeat}%` }}
                      />
                    </div>
                    <span className="num text-[11px] text-muted-foreground flex items-center gap-1">
                      <Users className="h-2.5 w-2.5" />
                      {formatNum(t.holders)}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to="/token/$address"
                    params={{ address: t.address }}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    <Zap className="h-3 w-3" /> Buy
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
