import { useState } from "react";
import { useChain } from "@/lib/chain-context";

// Remember which image URLs failed (rate-limited / 404) so re-renders after a
// refresh show the fallback immediately instead of flashing blank again.
const failed = new Set<string>();

/**
 * Token avatar: real logo when it loads, the chain's own mark when it doesn't.
 *
 * Loading is deliberately eager rather than lazy. These icons are 24–48px and
 * sit inside a scrollable table, so `loading="lazy"` made every row below the
 * fold wait for a scroll before even starting its request — which is why new
 * Stable tokens (whose logos come from a slower CDN than Robinhood's explorer)
 * appeared blank for so long. Eager at this size costs almost nothing and lets
 * the browser fetch the whole visible list in parallel.
 *
 * A missing logo falls back to the chain mark rather than initials: a brand-new
 * launch usually has no artwork anywhere, and a grid of grey letter-tiles reads
 * as broken where a row of chain marks reads as "not set yet".
 */
export function TokenIcon({
  url,
  symbol,
  size = 28,
  className = "",
}: {
  url?: string;
  symbol: string;
  size?: number;
  className?: string;
}) {
  const { chain } = useChain();
  const [broken, setBroken] = useState(() => (url ? failed.has(url) : true));
  const [chainLogoBroken, setChainLogoBroken] = useState(false);
  const px = `${size}px`;

  const showToken = url && !broken;
  const showChain = !showToken && chain.logoUrl && !chainLogoBroken;

  return (
    <span
      className={`grid flex-shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground ${className}`}
      style={{ width: px, height: px, fontSize: Math.max(8, size * 0.36) }}
      title={symbol}
    >
      {showToken ? (
        <img
          src={url}
          alt=""
          loading="eager"
          decoding="async"
          // Some token CDNs reject requests carrying our referrer.
          referrerPolicy="no-referrer"
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => {
            failed.add(url);
            setBroken(true);
          }}
        />
      ) : showChain ? (
        <img
          src={chain.logoUrl}
          alt=""
          loading="eager"
          decoding="async"
          width={size}
          height={size}
          className="h-full w-full object-cover opacity-40"
          onError={() => setChainLogoBroken(true)}
        />
      ) : (
        (symbol || "?").slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
