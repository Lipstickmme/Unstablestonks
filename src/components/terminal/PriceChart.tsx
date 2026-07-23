import { useMemo } from "react";

/** Renders a real close-price series. When no indexed OHLCV exists, the parent
 * shows an empty state instead — we never draw a synthetic price line. */
export function PriceChart({ points, positive = true }: { points: number[]; positive?: boolean }) {
  const seed = points.length;
  const w = 800,
    h = 260;

  const path = useMemo(() => {
    if (points.length < 2) return { line: "", area: "" };
    const step = w / (points.length - 1);
    const min = Math.min(...points),
      max = Math.max(...points);
    const y = (p: number) => h - ((p - min) / (max - min || 1)) * (h - 20) - 10;
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${y(p)}`).join(" ");
    return { line, area: `${line} L ${w} ${h} L 0 ${h} Z` };
  }, [points]);

  const stroke = positive ? "var(--bull)" : "var(--bear)";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`g-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
        <pattern id={`grid-${seed}`} width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="var(--border)"
            strokeWidth="0.5"
            opacity="0.4"
          />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#grid-${seed})`} />
      <path d={path.area} fill={`url(#g-${seed})`} />
      <path d={path.line} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}
