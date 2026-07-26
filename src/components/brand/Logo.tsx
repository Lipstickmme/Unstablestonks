// UnstableStonks brand mark: the hosted artwork, with the original vector
// shades kept as a fallback so the header never renders an empty box if the
// gateway is slow or blocked.

import { BRAND_IMAGE_URL } from "@/config/brand";
import { BrandImage } from "./BrandImage";

export function ShadesMark({ className = "", size = 28 }: { className?: string; size?: number }) {
  // 16x6 pixel grid of the classic blocky sunglasses.
  const u = size / 16;
  const px = (x: number, y: number, w = 1, h = 1) => (
    <rect key={`${x}-${y}-${w}-${h}`} x={x * u} y={y * u} width={w * u} height={h * u} />
  );
  return (
    <svg
      width={size}
      height={size * (6 / 16)}
      viewBox={`0 0 ${size} ${size * (6 / 16)}`}
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      {/* top brow bar */}
      {px(0, 0, 16, 1)}
      {/* left lens */}
      {px(0, 1, 6, 1)}
      {px(0, 2, 6, 1)}
      {px(1, 3, 5, 1)}
      {px(2, 4, 3, 1)}
      {/* bridge */}
      {px(6, 1, 4, 1)}
      {/* right lens */}
      {px(10, 1, 6, 1)}
      {px(10, 2, 6, 1)}
      {px(10, 3, 5, 1)}
      {px(11, 4, 3, 1)}
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 select-none">
      <BrandImage
        src={BRAND_IMAGE_URL}
        alt="UnstableStonks"
        className="h-7 w-7 rounded-md object-cover"
        fallback={
          <span className="grid place-items-center rounded-md bg-foreground px-1.5 py-1 text-background">
            <ShadesMark size={22} />
          </span>
        }
      />
      {/* The wordmark stays as live text: the mark is a 193x184 square whose own
          lettering is unreadable at header size. A wide (~3:1) lockup could
          replace both — see BRAND_IMAGE_URL. */}
      {!compact && (
        <span className="font-mono text-sm font-bold tracking-tight leading-none">
          UNSTABLE<span className="text-primary">STONKS</span>
        </span>
      )}
    </span>
  );
}
