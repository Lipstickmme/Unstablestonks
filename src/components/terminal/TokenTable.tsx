import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { formatAge, formatNum, formatUSD, shortAddr } from "@/lib/format";
import type { TokenRow, TokenStatus } from "@/lib/types";
import { useChain } from "@/lib/chain-context";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  Flame,
  Zap,
  Users,
  Rocket,
  Sparkles,
} from "lucide-react";

type SortKey =
  | "age"
  | "vol5m"
  | "vol1h"
  | "vol24h"
  | "mcap"
  | "graduationPct"
  | "socialHeat"
  | "priceChange24h";
type Filter = "all" | "new" | "trending" | "graduating" | "graduated";

const FILTERS: { key: Filter; label: string; icon?: React.ReactNode }[] = [
  { key: "all", label: "All launches" },
  { key: "new", label: "New", icon: <Sparkles className="h-3 w-3" /> },
  { key: "trending", label: "Trending", icon: <Flame className="h-3 w-3" /> },
  { key: "graduating", label: "On curve", icon: <Rocket className="h-3 w-3" /> },
  { key: "graduated", label: "Graduated" },
];

function StatusBadge({ s }: { s: TokenStatus }) {
  const map: Record<TokenStatus, { label: string; cls: string; icon?: React.ReactNode }> = {
    new: {
      label: "NEW",
      cls: "text-primary border-primary/40 bg-primary/10",
      icon: <Sparkles className="h-2.5 w-2.5" />,
    },
    trending: {
      label: "HOT",
      cls: "text-hot border-hot/40 bg-hot/10 intel-glow",
      icon: <Flame className="h-2.5 w-2.5" />,
    },
    graduating: { label: "CURVE", cls: "text-grad border-grad/40 bg-grad/10" },
    graduated: { label: "✓ GRAD", cls: "text-bull border-bull/40 bg-bull/10" },
    cto: {
      label: "CTO",
      cls: "text-cto border-cto/40 bg-cto/10",
      icon: <Zap className="h-2.5 w-2.5" />,
    },
  };
  const cfg = map[s];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider border ${cfg.cls}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function Delta({ v, known }: { v: number; known: boolean }) {
  if (!known) return <span className="num text-xs text-muted-foreground">—</span>;
  const pos = v >= 0;
  return (
    <span className={`num text-xs ${pos ? "text-bull" : "text-bear"}`}>
      {pos ? "+" : ""}
      {v.toFixed(1)}%
    </span>
  );
}

/** Tiny real-data trend: 5 points reconstructed from 5m/1h/6h/24h price changes. */
function Sparkline({ points, positive }: { points?: number[]; positive: boolean }) {
  if (!points || points.length < 2) {
    return <span className="num text-xs text-muted-foreground">—</span>;
  }
  const w = 64,
    h = 20;
  const min = Math.min(...points),
    max = Math.max(...points);
  const step = w / (points.length - 1);
  const y = (p: number) => h - ((p - min) / (max - min || 1)) * (h - 4) - 2;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${y(p).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <path
        d={d}
        fill="none"
        stroke={positive ? "var(--bull)" : "var(--bear)"}
        strokeWidth="1.5"
        strokeLinecap="round"
        className="spark-draw"
      />
    </svg>
  );
}

/** Venue cell: launchpad + graduation state, or the DEX the token trades on. */
function VenueCell({ t }: { t: TokenRow }) {
  if (t.launchpadName) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium">
          <Rocket className="h-3 w-3 text-grad" />
          {t.launchpadName}
        </span>
        <span className={`text-[10px] ${t.graduated ? "text-bull" : "text-muted-foreground"}`}>
          {t.graduated ? `✓ graduated → ${t.dexName ?? "DEX"}` : "on bonding curve"}
        </span>
      </div>
    );
  }
  if (t.dexName) {
    return <span className="text-[11px] text-muted-foreground">{t.dexName}</span>;
  }
  return <span className="text-[11px] text-muted-foreground">—</span>;
}

const usdOrDash = (v: number) => (v > 0 ? formatUSD(v) : "—");

export function TokenTable({
  tokens,
  loading,
  error,
}: {
  tokens: TokenRow[];
  loading?: boolean;
  error?: boolean;
}) {
  const { chain } = useChain();
  const [sort, setSort] = useState<SortKey>("vol24h");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    let r = tokens;
    if (filter !== "all") r = r.filter((t) => t.status.includes(filter));
    if (query) {
      const q = query.toLowerCase();
      r = r.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.address.toLowerCase().includes(q),
      );
    }
    const val = (t: TokenRow): number => (sort === "age" ? t.ageMinutes : t[sort]);
    return [...r].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      return dir === "desc" ? bv - av : av - bv;
    });
  }, [tokens, sort, dir, filter, query]);

  function toggleSort(k: SortKey) {
    if (sort === k) setDir(dir === "desc" ? "asc" : "desc");
    else {
      setSort(k);
      setDir("desc");
    }
  }

  const H = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors ${right ? "ml-auto" : ""}`}
    >
      {label}
      {sort === k &&
        (dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
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
                <span className="num text-[10px] text-muted-foreground">{rows.length}</span>
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
              <th className="w-[22%] px-4 py-2.5">
                <H k="age" label="Token" />
              </th>
              <th className="px-2 py-2.5">
                <H k="age" label="Age" />
              </th>
              <th className="px-2 py-2.5 text-right">
                <H k="priceChange24h" label="Price 24h" right />
              </th>
              <th className="px-2 py-2.5 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Trend
              </th>
              <th className="px-2 py-2.5 text-right">
                <H k="mcap" label="Mkt cap" right />
              </th>
              <th className="px-2 py-2.5 text-right">
                <H k="vol5m" label="V·5m" right />
              </th>
              <th className="px-2 py-2.5 text-right">
                <H k="vol1h" label="V·1h" right />
              </th>
              <th className="px-2 py-2.5 text-right">
                <H k="vol24h" label="V·24h" right />
              </th>
              <th className="px-2 py-2.5">
                <H k="graduationPct" label="Venue" />
              </th>
              <th className="px-2 py-2.5">
                <H k="socialHeat" label="Social" />
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                Trade
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-16 text-center text-sm text-muted-foreground">
                  {loading
                    ? "Loading live tokens from DEX indexers + block explorer…"
                    : error
                      ? "Couldn't reach the data sources for this chain. Retrying automatically."
                      : "No tokens indexed on this chain yet. Switch chains or check back — the feed is live."}
                </td>
              </tr>
            )}
            {rows.map((t) => (
              <tr
                key={t.address}
                className="group border-b border-border/60 transition-colors hover:bg-surface-elevated/60"
              >
                <td className="px-4 py-3">
                  <Link
                    to="/token/$address"
                    params={{ address: t.address }}
                    className="flex items-center gap-3"
                  >
                    <div className="grid h-9 w-9 flex-shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground">
                      {t.logoUrl ? (
                        <img
                          src={t.logoUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        t.logo
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{t.symbol}</span>
                        <span className="truncate text-xs text-muted-foreground">{t.name}</span>
                        <div className="flex gap-1">
                          {t.status.slice(0, 2).map((s) => (
                            <StatusBadge key={s} s={s} />
                          ))}
                        </div>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="num">{shortAddr(t.address)}</span>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            navigator.clipboard.writeText(t.address);
                          }}
                          className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <a
                          href={`${chain.explorerUrl}/token/${t.address}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  </Link>
                </td>
                <td className="num px-2 py-3 text-xs text-muted-foreground">
                  {formatAge(t.ageMinutes)}
                </td>
                <td className="px-2 py-3 text-right">
                  <div className="num text-xs">{t.price > 0 ? formatUSD(t.price) : "—"}</div>
                  <Delta v={t.priceChange24h} known={t.priceSource === "geckoterminal"} />
                </td>
                <td className="px-2 py-3 text-center">
                  <Sparkline points={t.sparkline} positive={t.priceChange24h >= 0} />
                </td>
                <td className="num px-2 py-3 text-right text-xs">{usdOrDash(t.mcap)}</td>
                <td className="num px-2 py-3 text-right text-xs">{usdOrDash(t.vol5m)}</td>
                <td className="num px-2 py-3 text-right text-xs">{usdOrDash(t.vol1h)}</td>
                <td className="num px-2 py-3 text-right text-xs">{usdOrDash(t.vol24h)}</td>
                <td className="px-2 py-3">
                  <VenueCell t={t} />
                </td>
                <td className="px-2 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={`h-full bg-hot transition-all duration-700 ${t.socialHeat > 40 ? "intel-glow" : ""}`}
                        style={{ width: `${t.socialHeat}%` }}
                      />
                    </div>
                    <span className="num flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Users className="h-2.5 w-2.5" />
                      {t.holders > 0 ? formatNum(t.holders) : "—"}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to="/token/$address"
                    params={{ address: t.address }}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
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
