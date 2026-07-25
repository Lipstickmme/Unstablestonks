import { useState } from "react";

// Remember which image URLs failed (rate-limited / 404) so re-renders after a
// refresh show the letter avatar immediately instead of flashing blank again.
const failed = new Set<string>();

/**
 * Token avatar: real logo when it loads, letter fallback otherwise. Never blank.
 * Keep it small by default so dense tables don't feel crowded.
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
  const [broken, setBroken] = useState(() => (url ? failed.has(url) : true));
  const letters = (symbol || "?").slice(0, 2).toUpperCase();
  const px = `${size}px`;

  return (
    <span
      className={`grid flex-shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground ${className}`}
      style={{ width: px, height: px, fontSize: Math.max(8, size * 0.36) }}
    >
      {url && !broken ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => {
            failed.add(url);
            setBroken(true);
          }}
        />
      ) : (
        letters
      )}
    </span>
  );
}
