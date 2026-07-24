import { Flame, ExternalLink, Loader2, Megaphone } from "lucide-react";
import { formatNum } from "@/lib/format";
import { useXSocial } from "@/lib/data/social";

// Crawls X for real posts + reach about the contract address. Backed by the
// server-side searchXSocial (official API when keyed, Nitter fallback). Reports
// its own source/status honestly and never shows fabricated posts.
export function XSocialPanel({
  address,
  symbol,
  shareOfVoice,
}: {
  address: string;
  symbol: string;
  /** 0..100 share of X mentions vs the chain's top tracked tokens (null = N/A). */
  shareOfVoice?: number | null;
}) {
  // Query on the exact contract address — that's what users paste in X posts.
  const { data, isLoading, isError } = useXSocial(address);

  const heat = data?.heat ?? 0;
  const sov = shareOfVoice ?? null;
  const timeAgo = (ms: number) => {
    const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  };

  return (
    <section className="card-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 text-hot" />
          <h3 className="text-sm font-medium">X · social intelligence</h3>
        </div>
        {data?.source && data.source !== "unavailable" && (
          <span className="chip !py-0 text-[9px]">
            via {data.source === "x-api" ? "X API" : "Nitter"}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="num text-3xl font-light">{isLoading ? "…" : heat}</div>
        <div className="flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-hot transition-all" style={{ width: `${heat}%` }} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>
              <span className="num text-foreground">{formatNum(data?.mentions ?? 0)}</span> posts
            </span>
            <span>
              <span className="num text-foreground">{formatNum(data?.uniqueAccounts ?? 0)}</span>{" "}
              accounts
            </span>
            {(data?.impressions ?? 0) > 0 && (
              <span>
                <span className="num text-foreground">{formatNum(data!.impressions)}</span>{" "}
                impressions
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Share of voice — this CA's mentions vs the chain's top tracked tokens */}
      {data?.ok && sov != null && (
        <div className="mt-3 rounded-lg border border-border bg-background p-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Megaphone className="h-3 w-3" /> Share of voice
            </span>
            <span className="num font-medium text-foreground">{sov.toFixed(1)}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full bg-primary transition-all duration-700 ${sov > 25 ? "intel-glow" : ""}`}
              style={{ width: `${Math.min(100, sov)}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            of X mentions across the top tokens tracked on this chain
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Crawling X for {symbol} mentions…
          </div>
        )}

        {!isLoading && (isError || !data?.ok || (data?.posts.length ?? 0) === 0) && (
          <p className="rounded-lg border border-border bg-background p-3 text-[11px] text-muted-foreground">
            {data?.note ??
              "No X posts found for this contract yet, or the crawl source is unreachable. Set X_BEARER_TOKEN for authoritative reach data."}
          </p>
        )}

        <ul className="space-y-2">
          {data?.posts.slice(0, 5).map((p, i) => (
            <li
              key={`${p.handle}-${i}`}
              className="rounded-lg border border-border bg-background p-2.5"
            >
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{p.handle}</span>
                <span className="flex items-center gap-2">
                  {p.engagement > 0 && <span className="num">{formatNum(p.engagement)} eng</span>}
                  <span className="num">{timeAgo(p.ts)}</span>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </span>
              </div>
              <div className="mt-0.5 line-clamp-3 text-foreground">{p.text}</div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
