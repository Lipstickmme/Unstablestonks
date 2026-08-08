import { Droplets, ExternalLink, Rocket } from "lucide-react";
import { formatUSD } from "@/lib/format";
import { venueHue, venueLogo } from "@/config/brand";
import { useChain } from "@/lib/chain-context";
import type { TokenPoolInfo } from "@/lib/data/geckoterminal";

/**
 * Where a token's liquidity actually sits.
 *
 * The header shows one liquidity number, but that number is a sum: a token can
 * be split across a Uniswap V3 pool, a DYORswap pool and whatever launchpad it
 * came from, and reading only the deepest one understated real depth badly
 * enough to be worth fixing (FEFER read $24k against $200k). Having fixed the
 * sum, this is the receipt for it — every venue, what it holds, and what share
 * of the total that is.
 *
 * It is also the honest answer to "can I get out". $200k spread over four pools
 * is not $200k of exit liquidity on any one of them, and a single figure hides
 * exactly that.
 */
export function PoolBreakdown({ pools, loading }: { pools: TokenPoolInfo[]; loading?: boolean }) {
  const { chain } = useChain();
  const total = pools.reduce((s, p) => s + p.reserveUsd, 0);

  return (
    <section className="card-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplets className="h-3.5 w-3.5" />
          <h3 className="text-sm font-medium">Liquidity by venue</h3>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {pools.length > 0
            ? `${pools.length} pool${pools.length === 1 ? "" : "s"} · ${formatUSD(total)}`
            : "live"}
        </span>
      </div>

      {pools.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">
          {loading
            ? "Finding pools…"
            : "No indexed pools yet — liquidity appears once a DEX indexer picks this token up."}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {pools.map((p) => {
            const share = total > 0 ? (p.reserveUsd / total) * 100 : 0;
            return (
              <li key={p.pool} className="flex items-center gap-2.5">
                <VenueIcon name={p.dexName} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium">{p.dexName}</span>
                    {p.isLaunchpad && (
                      <span
                        className="chip !py-0 text-[9px]"
                        title="Bonding-curve launchpad, not a plain AMM"
                      >
                        <Rocket className="mr-0.5 inline h-2.5 w-2.5" />
                        launchpad
                      </span>
                    )}
                    <a
                      href={`${chain.explorerUrl}/address/${p.pool}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto text-muted-foreground hover:text-foreground"
                      aria-label={`${p.dexName} pool on the explorer`}
                      title="View this pool on the explorer"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {/* Share bar — the point is proportion, so it gets the width. */}
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${Math.max(2, share)}%` }}
                      />
                    </div>
                    <span className="num w-16 text-right text-[11px]">
                      {formatUSD(p.reserveUsd)}
                    </span>
                    <span className="num w-10 text-right text-[10px] text-muted-foreground">
                      {share < 0.1 ? "<0.1" : share.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pools.length > 1 && (
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
          Liquidity is the sum across every venue. A position larger than the deepest single pool
          has to be split to exit without moving the price.
        </p>
      )}
    </section>
  );
}

/**
 * A venue's mark, or a lettermark when we have no artwork for it.
 *
 * New venues appear constantly — Robinhood Chain gained several launchpads in
 * weeks — so requiring a logo file before a venue can be drawn would mean the
 * newest and most interesting ones render as blanks. The lettermark is derived
 * from the name, so it is stable and distinct without anyone shipping an asset.
 */
export function VenueIcon({ name, size = 20 }: { name: string; size?: number }) {
  const src = venueLogo(name);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="flex-shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const hue = venueHue(name);
  const initials = name
    .replace(/\b(v[0-9]|dex|swap|finance)\b/gi, "")
    .trim()
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      title={name}
      className="grid flex-shrink-0 place-items-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, size * 0.42),
        background: `oklch(0.45 0.12 ${hue})`,
        color: "white",
      }}
    >
      {initials || "?"}
    </span>
  );
}
