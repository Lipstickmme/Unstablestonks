// UnstableStonks brand mark: pixel "deal-with-it" shades + wordmark.
// Reconstructed as vector so it stays crisp at any size and inherits currentColor.

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
      <span className="grid place-items-center rounded-md bg-foreground px-1.5 py-1 text-background">
        <ShadesMark size={22} />
      </span>
      {!compact && (
        <span className="font-mono text-sm font-bold tracking-tight leading-none">
          UNSTABLE<span className="text-primary">STONKS</span>
        </span>
      )}
    </span>
  );
}
