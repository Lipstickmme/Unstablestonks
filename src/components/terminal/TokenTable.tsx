import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { formatAge, formatNum, formatUSD, shortAddr } from "@/lib/format";
import type { TokenRow, TokenStatus } from "@/lib/types";
import type { BundleStats } from "@/lib/bundles";
import { useSourceCounts, type TokenInsight } from "@/lib/data/hooks";
import { BASE_BOT_URL } from "@/config/links";
import { venueLogo } from "@/config/brand";
import { BrandImage } from "@/components/brand/BrandImage";
import { useChain } from "@/lib/chain-context";
import { useWallet } from "@/lib/wallet";
import { useWatchlist } from "@/lib/watchlist";
import { QuickBuyModal } from "./QuickBuyModal";
import { TokenIcon } from "./TokenIcon";
import {
  Activity,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Copy,
  PieChart,
  Store,
  UserCog,
  Users,
  ExternalLink,
  Flame,
  Zap,
  Rocket,
  Boxes,
  Sparkles,
  Star,
  BadgeCheck,
  Send,
} from "lucide-react";

type SortKey =
  | "age"
  | "vol5m"
  | "vol1h"
  | "vol24h"
  | "mcap"
  | "graduationPct"
  | "socialHeat"
  | "priceChange24h"
  | "holders";
type Filter = "all" | "new" | "trending";

const FILTERS: { key: Filter; label: string; icon?: React.ReactNode }[] = [
  { key: "all", label: "All launches" },
  { key: "new", label: "New", icon: <Sparkles className="h-3 w-3" /> },
  { key: "trending", label: "Trending", icon: <Flame className="h-3 w-3" /> },
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

/**
 * Venue cell — which DEX/launchpad the token trades on. Bonding-curve progress
 * and graduation are intentionally NOT shown: they can't be tracked reliably
 * across all three chains, and a wrong label is worse than none.
 */
function VenueCell({ t }: { t: TokenRow }) {
  const venue = t.launchpadName ?? t.dexName;
  if (!venue) return <span className="text-[11px] text-muted-foreground">—</span>;
  const logo = venueLogo(venue);
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      {t.launchpadName && <Rocket className="h-3 w-3 text-grad" />}
      {/* Venues we have artwork for show the mark alone; the rest keep their
          name, so an unbranded DEX is never reduced to a blank cell. */}
      <BrandImage
        src={logo}
        alt={venue}
        className="h-3.5 w-3.5 rounded-sm object-contain"
        fallback={<span className="truncate">{venue}</span>}
      />
      {logo && <span className="sr-only">{venue}</span>}
    </span>
  );
}

/** Per-row bundle read — same analysis as the panel, condensed to one cell. */
/**
 * Which data source produced how many rows on the last refresh. Only shown when
 * something is actually missing, so a healthy terminal stays uncluttered — but
 * when the list looks thin it names the dead hop instead of leaving you to guess.
 */
function SourceReadout() {
  const c = useSourceCounts();
  if (!c) return null;
  const entries: [string, number][] = [
    ["gecko", c.geckoterminal],
    ["dexscreener", c.dexscreener],
    ["blockscout", c.blockscout],
    ["explorer", c.explorer],
    ["on-chain", c.onchain],
  ];
  const dead = entries.filter(([, n]) => n === 0);
  if (!dead.length) return null;
  return (
    <span
      className="chip !py-0 text-[9px] text-muted-foreground"
      title={entries.map(([k, n]) => `${k}: ${n}`).join(" · ") + (c.note ? ` — ${c.note}` : "")}
    >
      {entries.length - dead.length}/{entries.length} sources
    </span>
  );
}

/**
 * A share-of-supply figure. Blank until the check has run — an unchecked token
 * must not read as 0%. Turns amber past `warnAbove`, the point where the
 * concentration is worth a second look.
 */
function SupplyPct({ pct, warnAbove }: { pct?: number; warnAbove: number }) {
  if (pct == null) return <span className="text-[11px] text-muted-foreground">—</span>;
  const hot = pct >= warnAbove;
  return (
    <span className={`num text-xs ${hot ? "text-warn" : "text-muted-foreground"}`}>
      {pct < 0.01 ? "<0.01%" : `${pct.toFixed(pct < 10 ? 2 : 1)}%`}
    </span>
  );
}

/**
 * DexScreener paid-listing state. `undefined` means the chain isn't indexed by
 * DexScreener at all, which is not the same as "unpaid" — that shows as "—".
 */
function DexPaidCell({ paid }: { paid?: boolean }) {
  if (paid == null)
    return (
      <span className="text-[11px] text-muted-foreground" title="Not indexed by DexScreener">
        —
      </span>
    );
  return paid ? (
    <span
      className="chip border-bull/40 bg-bull/10 !py-0 text-[9px] text-bull"
      title="Enhanced token info paid for"
    >
      <BadgeCheck className="h-2.5 w-2.5" /> paid
    </span>
  ) : (
    <span
      className="chip !py-0 text-[9px] text-muted-foreground"
      title="No approved DexScreener order"
    >
      unpaid
    </span>
  );
}

function BundleCell({ stats }: { stats?: BundleStats }) {
  if (!stats || stats.sample === 0) {
    return <span className="num text-xs text-muted-foreground">—</span>;
  }
  if (stats.count === 0) {
    return <span className="text-[11px] text-bull">clean</span>;
  }
  const cls =
    stats.risk === "high" ? "text-bear" : stats.risk === "elevated" ? "text-warn" : "text-bull";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${cls}`}
      title={`${stats.count} same-block cluster(s), largest ${stats.largest} swaps, ${formatUSD(stats.bundledUsd)} bundled`}
    >
      <Boxes className="h-3 w-3" />
      <span className="num">{stats.pct.toFixed(0)}%</span>
    </span>
  );
}

const usdOrDash = (v: number) => (v > 0 ? formatUSD(v) : "—");

/** 24h buy/sell counts — a real "recent activity" momentum read. */
function Txns24h({ buys, sells }: { buys: number; sells: number }) {
  if (buys + sells <= 0) return <span className="num text-xs text-muted-foreground">—</span>;
  return (
    <span className="num text-[11px]">
      <span className="text-bull">{formatNum(buys)}</span>
      <span className="text-muted-foreground">/</span>
      <span className="text-bear">{formatNum(sells)}</span>
    </span>
  );
}

export function TokenTable({
  tokens,
  loading,
  error,
  initialQuery,
  watchOnly,
  bundles,
  insights,
}: {
  tokens: TokenRow[];
  loading?: boolean;
  error?: boolean;
  initialQuery?: string;
  watchOnly?: boolean;
  /** Per-token bundle stats, keyed by address. */
  bundles?: Record<string, BundleStats>;
  /** Distribution + listing intel, keyed by token address. */
  insights?: Record<string, TokenInsight>;
}) {
  const { chain } = useChain();
  const wallet = useWallet();
  const watchlist = useWatchlist();
  const [sort, setSort] = useState<SortKey>("vol24h");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [buyToken, setBuyToken] = useState<TokenRow | null>(null);

  // Reflect a search submitted from the header.
  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);

  const rows = useMemo(() => {
    let r = tokens;
    if (watchOnly) r = r.filter((t) => watchlist.has(t.address));
    // "New" is an age question, not a badge question: the NEW badge only lasts
    // an hour, but a launch scanned off the chain minutes ago has no volume yet
    // and would otherwise never appear under any tab.
    if (filter === "new") {
      r = r.filter(
        (t) => t.status.includes("new") || (t.ageMinutes >= 0 && t.ageMinutes < 24 * 60),
      );
    } else if (filter !== "all") {
      r = r.filter((t) => t.status.includes(filter));
    }
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
  }, [tokens, sort, dir, filter, query, watchOnly, watchlist]);

  function toggleSort(k: SortKey) {
    if (sort === k) setDir(dir === "desc" ? "asc" : "desc");
    else {
      setSort(k);
      setDir("desc");
    }
  }

  /**
   * Sortable column header. Long labels are replaced by an icon with the words
   * moved into the tooltip — the header text was setting the minimum width of
   * columns holding two or three characters of data, which is what pushed the
   * Buy button off-screen.
   */
  const H = ({
    k,
    label,
    icon,
    right,
  }: {
    k: SortKey;
    label: string;
    icon?: React.ReactNode;
    right?: boolean;
  }) => (
    <button
      onClick={() => toggleSort(k)}
      title={label}
      className={`flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors ${right ? "ml-auto" : ""}`}
    >
      {icon ?? label}
      {sort === k &&
        (dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
    </button>
  );

  /** Non-sortable icon header. */
  const Ico = ({
    label,
    icon,
    center,
  }: {
    label: string;
    icon: React.ReactNode;
    center?: boolean;
  }) => (
    <span
      title={label}
      className={`flex items-center text-muted-foreground ${center ? "justify-center" : "justify-end"}`}
    >
      {icon}
    </span>
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
          <SourceReadout />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-elevated/40 text-left">
              <th className="w-[168px] px-3 py-2">
                <H k="age" label="Token" />
              </th>
              <th className="px-1.5 py-2">
                <H k="age" label="Age" />
              </th>
              <th className="px-1.5 py-2 text-right">
                <H k="priceChange24h" label="Price / 24h change" icon={<>PRICE</>} right />
              </th>
              <th className="px-1.5 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <Ico label="Trend" icon={<Activity className="h-3.5 w-3.5" />} center />
              </th>
              <th className="px-1.5 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <H k="mcap" label="Market cap" icon={<>MC</>} />
                  <span className="text-[10px] text-muted-foreground/40">/</span>
                  <H k="vol24h" label="24h volume" icon={<>VOL</>} />
                </div>
              </th>
              <th className="px-1.5 py-2 text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <Ico
                    label="Buys / sells, 24h"
                    icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
                  />
                  <span className="text-[10px] text-muted-foreground/40">/</span>
                  <H k="holders" label="Holders" icon={<Users className="h-3.5 w-3.5" />} />
                </div>
              </th>
              <th className="px-1.5 py-2 text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <Ico
                    label="Dev holding / top 10 holders, as a share of supply"
                    icon={<UserCog className="h-3.5 w-3.5" />}
                  />
                  <span className="text-[10px] text-muted-foreground/40">/</span>
                  <Ico label="Top 10 holders" icon={<PieChart className="h-3.5 w-3.5" />} />
                </div>
              </th>
              <th className="px-1.5 py-2 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <Ico label="Same-block bundles" icon={<Boxes className="h-3.5 w-3.5" />} center />
                  <span className="text-[10px] text-muted-foreground/40">/</span>
                  <Ico
                    label="DexScreener paid listing"
                    icon={<BadgeCheck className="h-3.5 w-3.5" />}
                    center
                  />
                </div>
              </th>
              <th className="px-1.5 py-2">
                <div className="flex items-center gap-1.5">
                  <Ico label="Trading venue" icon={<Store className="h-3.5 w-3.5" />} center />
                  <span className="text-[10px] text-muted-foreground/40">/</span>
                  <H
                    k="socialHeat"
                    label="X social heat"
                    icon={<Flame className="h-3.5 w-3.5" />}
                  />
                </div>
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                Trade
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-16 text-center text-sm text-muted-foreground">
                  {watchOnly
                    ? "Your watchlist is empty. Tap the ☆ on any token to add it."
                    : loading
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
                <td className="px-3 py-2">
                  <Link
                    to="/token/$address"
                    params={{ address: t.address }}
                    className="flex items-center gap-2"
                  >
                    <TokenIcon url={t.logoUrl} symbol={t.symbol} size={26} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">{t.symbol}</span>
                        {t.status.slice(0, 1).map((st) => (
                          <StatusBadge key={st} s={st} />
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="num truncate">{shortAddr(t.address)}</span>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            navigator.clipboard.writeText(t.address);
                          }}
                          title="Copy contract address"
                          className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <a
                          href={`${chain.explorerUrl}/token/${t.address}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="View on explorer"
                          className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            watchlist.toggle(t.address);
                          }}
                          title={
                            watchlist.has(t.address) ? "Remove from watchlist" : "Add to watchlist"
                          }
                          className={`transition-opacity hover:text-foreground ${
                            watchlist.has(t.address)
                              ? "text-primary opacity-100"
                              : "opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          <Star
                            className={`h-3 w-3 ${watchlist.has(t.address) ? "fill-current" : ""}`}
                          />
                        </button>
                      </div>
                    </div>
                  </Link>
                </td>
                <td className="num px-1.5 py-2 text-xs text-muted-foreground">
                  {formatAge(t.ageMinutes)}
                </td>
                <td className="px-1.5 py-2 text-right">
                  <div className="num text-xs leading-tight">
                    {t.price > 0 ? formatUSD(t.price) : "—"}
                  </div>
                  <Delta v={t.priceChange24h} known={t.priceSource === "geckoterminal"} />
                </td>
                <td className="px-1.5 py-2 text-center">
                  <Sparkline points={t.sparkline} positive={t.priceChange24h >= 0} />
                </td>
                {/* Market cap over 24h volume — one column, two figures. */}
                <td className="px-1.5 py-2 text-right">
                  <div className="num text-xs leading-tight">{usdOrDash(t.mcap)}</div>
                  <div className="num text-[11px] leading-tight text-muted-foreground">
                    {usdOrDash(t.vol24h)}
                  </div>
                </td>
                {/* Buys/sells over holders. */}
                <td className="px-1.5 py-2 text-right">
                  <Txns24h buys={t.buys24h} sells={t.sells24h} />
                  <div className="num text-[11px] leading-tight text-muted-foreground">
                    {t.holders > 0 ? formatNum(t.holders) : "—"}
                  </div>
                </td>
                {/* Dev holding over top-10 concentration. */}
                <td className="px-1.5 py-2 text-right leading-tight">
                  <div>
                    <SupplyPct pct={insights?.[t.address]?.devHoldingPct} warnAbove={5} />
                  </div>
                  <div>
                    <SupplyPct pct={insights?.[t.address]?.top10Pct} warnAbove={50} />
                  </div>
                </td>
                {/* Bundle risk over DexScreener paid state. */}
                <td className="px-1.5 py-2 text-center leading-tight">
                  <div>
                    <BundleCell stats={bundles?.[t.address]} />
                  </div>
                  <div>
                    <DexPaidCell paid={insights?.[t.address]?.dexPaid} />
                  </div>
                </td>
                {/* Venue over social heat. */}
                <td className="px-1.5 py-2 leading-tight">
                  <VenueCell t={t} />
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <div className="h-1 w-10 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={`h-full bg-hot transition-all duration-700 ${t.socialHeat > 40 ? "intel-glow" : ""}`}
                        style={{ width: `${t.socialHeat}%` }}
                      />
                    </div>
                    <span className="num text-[10px] text-muted-foreground">
                      {t.socialHeat > 0 ? t.socialHeat : "—"}
                    </span>
                  </div>
                </td>
                {/* Actions side by side so the row stays one line tall. */}
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => {
                        // Kick off the wallet prompt from this real click (a user
                        // gesture) so the wallet doesn't reject it, then open the
                        // buy modal. No navigation to the token page.
                        if (!wallet.address) void wallet.connect();
                        setBuyToken(t);
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      <Zap className="h-3 w-3" /> Buy
                    </button>
                    <a
                      href={BASE_BOT_URL}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="Open BaseBot on Telegram"
                      className="inline-flex items-center rounded-md border border-border p-1 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      <Send className="h-3 w-3" />
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {buyToken && <QuickBuyModal token={buyToken} onClose={() => setBuyToken(null)} />}
    </section>
  );
}
