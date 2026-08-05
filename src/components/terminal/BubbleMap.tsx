import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Coins, Flame } from "lucide-react";
import { formatNum, formatUSD } from "@/lib/format";
import type { TokenRow } from "@/lib/types";
import { TokenIcon } from "./TokenIcon";

/**
 * The whole chain at a glance: one bubble per token, area proportional to the
 * chosen metric, tinted by the 24h move.
 *
 * A table answers "what is this token worth"; this answers "what does the chain
 * look like" — where the weight sits, how concentrated it is, whether the big
 * names are up while the tail bleeds. Neither replaces the other, which is why
 * it lives as a tab beside the list rather than instead of it.
 *
 * AREA, not radius, carries the value. Scaling radius by value makes a token
 * worth 4x look 16x bigger, which is the classic way a bubble chart lies. The
 * square root fixes that, and it is the whole reason these read honestly.
 */

type Metric = "mcap" | "vol24h";

const METRICS: { key: Metric; label: string; icon: React.ReactNode }[] = [
  { key: "mcap", label: "Market cap", icon: <Coins className="h-3 w-3" /> },
  { key: "vol24h", label: "24h volume", icon: <Flame className="h-3 w-3" /> },
];

/** Enough to fill the canvas; past this the bubbles are unreadable anyway. */
const MAX_BUBBLES = 60;

/** Canvas is described in abstract units and scaled by CSS, so it's responsive. */
const W = 1000;
const H = 460;

interface Bubble {
  token: TokenRow;
  x: number;
  y: number;
  r: number;
  value: number;
}

/**
 * Greedy spiral packing.
 *
 * Largest first, each one placed at the first spot on an outward spiral where it
 * touches nothing already placed. Deterministic — the same list always produces
 * the same picture, so the map doesn't reshuffle itself on every 30-second
 * refresh and make the page feel unstable.
 */
function pack(items: { token: TokenRow; value: number }[]): Bubble[] {
  if (!items.length) return [];

  const max = items[0].value;
  const min = items[items.length - 1].value;
  // Radii span a fixed range so a chain with one dominant token still shows its
  // tail, and area (not radius) tracks value between those bounds.
  const R_MIN = 16;
  const R_MAX = 88;
  const scale = (v: number) => {
    if (max <= min) return (R_MIN + R_MAX) / 2;
    const t = Math.sqrt(v / max);
    const tMin = Math.sqrt(min / max);
    return R_MIN + ((t - tMin) / (1 - tMin || 1)) * (R_MAX - R_MIN);
  };

  const placed: Bubble[] = [];
  const cx = W / 2;
  const cy = H / 2;

  for (const item of items) {
    const r = scale(item.value);
    let found = false;

    // Step out in rings; within a ring, walk the angle. The step scales with the
    // bubble so big ones don't crawl the whole spiral in tiny increments.
    for (let ring = 0; ring < 260 && !found; ring++) {
      const dist = ring * Math.max(4, r * 0.22);
      const steps = ring === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * dist) / (r * 0.9)));
      for (let s = 0; s < steps; s++) {
        // Offset each ring's start angle so successive rings interleave rather
        // than stacking their seams in a visible line.
        const a = (s / steps) * Math.PI * 2 + ring * 0.7;
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist * (H / W) * 1.35;
        if (x - r < 4 || x + r > W - 4 || y - r < 4 || y + r > H - 4) continue;
        const clash = placed.some((p) => {
          const dx = p.x - x;
          const dy = p.y - y;
          return Math.hypot(dx, dy) < p.r + r + 4;
        });
        if (!clash) {
          placed.push({ token: item.token, x, y, r, value: item.value });
          found = true;
          break;
        }
      }
    }
  }
  return placed;
}

export function BubbleMap({ tokens, loading }: { tokens: TokenRow[]; loading?: boolean }) {
  const [metric, setMetric] = useState<Metric>("mcap");
  const [hover, setHover] = useState<string | null>(null);

  const bubbles = useMemo(() => {
    const items = tokens
      .map((t) => ({ token: t, value: metric === "mcap" ? t.mcap : t.vol24h }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_BUBBLES);
    return pack(items);
  }, [tokens, metric]);

  const total = bubbles.reduce((s, b) => s + b.value, 0);

  return (
    <div className="p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1 text-xs">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`tap inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors ${
                metric === m.key ? "bg-secondary text-foreground" : "text-muted-foreground"
              }`}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {bubbles.length} tokens · bubble area is {metric === "mcap" ? "market cap" : "24h volume"}
          {total > 0 && ` · ${formatUSD(total)} total`}
        </span>
        <span className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-bull" /> up 24h
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-bear" /> down 24h
          </span>
        </span>
      </div>

      {bubbles.length === 0 ? (
        <div className="grid h-[300px] place-items-center text-sm text-muted-foreground">
          {loading
            ? "Loading the chain…"
            : `No token has a ${metric === "mcap" ? "market cap" : "24h volume"} to plot yet.`}
        </div>
      ) : (
        <div
          className="relative w-full overflow-hidden rounded-xl border border-border bg-background"
          style={{ aspectRatio: `${W} / ${H}` }}
        >
          {bubbles.map((b, i) => {
            const t = b.token;
            const up = t.priceChange24h >= 0;
            const known = t.priceChange24h !== 0;
            const active = hover === t.address;
            // Percentages, so the whole map scales with its container and stays
            // correct on a phone without recomputing the layout.
            const left = (b.x / W) * 100;
            const top = (b.y / H) * 100;
            const size = ((b.r * 2) / W) * 100;

            return (
              <Link
                key={t.address}
                to="/token/$address"
                params={{ address: t.address }}
                onMouseEnter={() => setHover(t.address)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(t.address)}
                onBlur={() => setHover(null)}
                aria-label={`${t.symbol} — ${formatUSD(b.value)}`}
                className="absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center transition-transform duration-200 hover:z-20 hover:scale-[1.06]"
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  width: `${size}%`,
                  aspectRatio: "1",
                }}
              >
                {/* The skin carries the colour and the entrance animation; the
                    link above carries position and hover. Keeping them apart is
                    what lets both work at once. */}
                <span
                  aria-hidden="true"
                  className="bubble-in absolute inset-0 rounded-full"
                  style={
                    {
                      "--i": i,
                      // Tint and ring both come from the 24h move; a token with
                      // no known change stays neutral rather than being coloured
                      // green by a default of zero.
                      background: known
                        ? `radial-gradient(circle at 50% 35%, color-mix(in oklab, var(--${up ? "bull" : "bear"}) 26%, transparent), color-mix(in oklab, var(--${up ? "bull" : "bear"}) 8%, transparent))`
                        : "color-mix(in oklab, var(--muted) 40%, transparent)",
                      boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, var(--${known ? (up ? "bull" : "bear") : "border"}) ${active ? 90 : 55}%, transparent)`,
                    } as React.CSSProperties
                  }
                />
                <span className="relative flex flex-col items-center gap-0.5 px-1 text-center leading-none">
                  {b.r > 30 && (
                    <TokenIcon
                      url={t.logoUrl}
                      symbol={t.symbol}
                      size={Math.round(b.r * 0.55)}
                      className="opacity-90"
                    />
                  )}
                  <span
                    className="max-w-full truncate font-semibold text-foreground"
                    style={{ fontSize: `${Math.max(7, Math.min(13, b.r * 0.26))}px` }}
                  >
                    {t.symbol}
                  </span>
                  {b.r > 22 && (
                    <span
                      className={`num ${known ? (up ? "text-bull" : "text-bear") : "text-muted-foreground"}`}
                      style={{ fontSize: `${Math.max(6, Math.min(11, b.r * 0.2))}px` }}
                    >
                      {formatUSD(b.value)}
                    </span>
                  )}
                </span>

                {/* Hover card. Rendered inside the bubble so it follows it, and
                    flipped to the other side near the edges so it never leaves
                    the canvas. */}
                {active && (
                  <span
                    className={`pointer-events-none absolute z-30 w-44 rounded-lg border border-border bg-popover p-2 text-left shadow-xl ${
                      top < 45 ? "top-full mt-2" : "bottom-full mb-2"
                    } ${left > 70 ? "right-0" : left < 30 ? "left-0" : "left-1/2 -translate-x-1/2"}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <TokenIcon url={t.logoUrl} symbol={t.symbol} size={16} />
                      <span className="truncate text-xs font-medium">{t.symbol}</span>
                      <span
                        className={`num ml-auto text-[10px] ${known ? (up ? "text-bull" : "text-bear") : "text-muted-foreground"}`}
                      >
                        {known ? `${up ? "+" : ""}${t.priceChange24h.toFixed(1)}%` : "—"}
                      </span>
                    </span>
                    <span className="mt-1.5 block space-y-0.5 text-[10px] text-muted-foreground">
                      <Row label="Market cap" value={t.mcap > 0 ? formatUSD(t.mcap) : "—"} />
                      <Row label="24h volume" value={t.vol24h > 0 ? formatUSD(t.vol24h) : "—"} />
                      <Row label="Price" value={t.price > 0 ? formatUSD(t.price) : "—"} />
                      <Row label="Holders" value={t.holders > 0 ? formatNum(t.holders) : "—"} />
                    </span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="num text-foreground">{value}</span>
    </span>
  );
}
