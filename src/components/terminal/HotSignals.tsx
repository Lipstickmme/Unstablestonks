import { useEffect, useMemo, useState } from "react";
import {
  Flame,
  Users,
  Coins,
  MessageCircle,
  Pause,
  Play,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { formatNum, formatUSD } from "@/lib/format";
import type { TokenRow } from "@/lib/types";
import { TokenIcon } from "./TokenIcon";
import { useChain } from "@/lib/chain-context";
import { isQuoteAsset } from "@/lib/quote-assets";

/**
 * Four leaderboards, each reading the top 20 and showing 4 at a time.
 *
 * Twenty rows in a card this size would be a scroll nobody performs, and four
 * was leaving sixteen tokens invisible. So the card keeps its height and pages
 * through instead: five pages of four, swapping every few seconds with a soft
 * vertical slide, and dots to jump manually.
 *
 * The pages advance together across all four cards. Independent timers would
 * have the columns drifting out of phase, which reads as four separate things
 * twitching rather than one board turning over.
 */

const PER_PAGE = 4;
const DEPTH = 20;
const PAGES = DEPTH / PER_PAGE;
const ROTATE_MS = 6_500;

type Kind = "mcap" | "vol" | "holders" | "heat";

export function HotSignals({ tokens }: { tokens: TokenRow[] }) {
  const { chainKey } = useChain();
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);

  const cards = useMemo(() => {
    // A stablecoin tops "market cap" and "24h volume" on every chain, every
    // cycle, and tells you nothing. These boards are for launches.
    const pool = tokens.filter((t) => !isQuoteAsset(chainKey, t.address, t.symbol));
    const top = (pick: (t: TokenRow) => number) =>
      [...pool]
        .filter((t) => pick(t) > 0)
        .sort((a, b) => pick(b) - pick(a))
        .slice(0, DEPTH);

    return [
      {
        title: "Top market cap",
        icon: <Coins className="h-3.5 w-3.5 text-primary" />,
        items: top((t) => t.mcap),
        kind: "mcap" as Kind,
      },
      {
        title: "24h volume",
        icon: <Flame className="h-3.5 w-3.5 text-hot" />,
        items: top((t) => t.vol24h),
        kind: "vol" as Kind,
      },
      {
        title: "Most holders",
        icon: <Users className="h-3.5 w-3.5 text-grad" />,
        items: top((t) => t.holders),
        kind: "holders" as Kind,
      },
      {
        // Real crawl results only — tokens whose CA showed up on X this cycle.
        title: "X heat · CA mentions",
        icon: <MessageCircle className="intel-glow h-3.5 w-3.5 rounded-full text-hot" />,
        items: top((t) => t.socialHeat),
        kind: "heat" as Kind,
      },
    ];
  }, [tokens, chainKey]);

  // Only page as far as there is data to page through. A chain with six ranked
  // tokens shouldn't cycle through three empty screens.
  const pageCount = Math.max(
    1,
    Math.min(PAGES, Math.ceil(Math.max(...cards.map((c) => c.items.length), 0) / PER_PAGE)),
  );

  /** Move by one page, wrapping. Manual control always wins over the timer. */
  const step = (dir: 1 | -1) => {
    setPage((p) => (p + dir + pageCount) % pageCount);
    setPaused(true);
  };

  useEffect(() => {
    if (paused || pageCount < 2) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pageCount), ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, pageCount]);

  // A shrinking list must never leave the view stranded on a page that no
  // longer exists.
  useEffect(() => {
    setPage((p) => (p >= pageCount ? 0 : p));
  }, [pageCount]);

  return (
    <section>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => {
          const slice = c.items.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
          return (
            <div
              key={c.title}
              className="card-surface p-4"
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {c.icon}
                  <h3 className="text-sm font-medium">{c.title}</h3>
                </div>
                <span className="num text-[10px] text-muted-foreground">
                  {c.items.length > PER_PAGE ? `top ${Math.min(c.items.length, DEPTH)}` : ""}
                </span>
              </div>

              {/* Fixed height so the whole row of cards never jumps as pages of
                  different lengths come round. Four rows at 30px plus gaps. */}
              <ul className="mt-3 min-h-[132px] space-y-1.5">
                {c.items.length === 0 && (
                  <li className="py-2 text-xs text-muted-foreground">
                    {c.kind === "heat"
                      ? "Crawling X for contract mentions…"
                      : "No signal yet — feed is live."}
                  </li>
                )}
                {slice.map((t, i) => (
                  <li
                    // Keyed by page as well as address so React replaces the row
                    // rather than reusing it — which is what lets each page
                    // animate in instead of the numbers silently changing.
                    key={`${page}-${t.address}`}
                    className="row-in"
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <Link
                      to="/token/$address"
                      params={{ address: t.address }}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-elevated"
                    >
                      <span className="num w-5 text-[10px] text-muted-foreground">
                        {page * PER_PAGE + i + 1}
                      </span>
                      <TokenIcon url={t.logoUrl} symbol={t.symbol} size={20} />
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
          );
        })}
      </div>

      {/* One control strip for all four cards, since they turn together.
          Stepping manually pauses the rotation — otherwise the timer would drag
          you off the page you just chose, a second or two after you chose it. */}
      {pageCount > 1 && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            onClick={() => step(-1)}
            className="tap rounded-full border border-border p-1 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            aria-label="Previous four"
            title="Previous four"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            onClick={() => step(1)}
            className="tap rounded-full border border-border p-1 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            aria-label="Next four"
            title="Next four"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
          {/* Straight back to the top four from anywhere in the run. */}
          {page !== 0 && (
            <button
              onClick={() => {
                setPage(0);
                setPaused(true);
              }}
              className="tap rounded-full border border-border p-1 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              aria-label="Back to the top four"
              title="Back to top 4"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={() => setPaused((p) => !p)}
            className="tap rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={paused ? "Resume rotation" : "Pause rotation"}
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          </button>
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              onClick={() => {
                setPage(i);
                setPaused(true);
              }}
              aria-label={`Show ranks ${i * PER_PAGE + 1} to ${(i + 1) * PER_PAGE}`}
              aria-current={i === page}
              className={`h-1.5 rounded-full transition-all ${
                i === page ? "w-5 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground"
              }`}
            />
          ))}
          <span className="num ml-1 text-[10px] text-muted-foreground">
            {page * PER_PAGE + 1}–{(page + 1) * PER_PAGE}
          </span>
        </div>
      )}
    </section>
  );
}
