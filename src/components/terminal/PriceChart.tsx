import { useMemo } from "react";

export function PriceChart({ seed = 1, positive = true }: { seed?: number; positive?: boolean }) {
  const points = useMemo(() => {
    let s = seed;
    const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const n = 80;
    const arr: number[] = [];
    let v = 50;
    for (let i = 0; i < n; i++) {
      v += (rand() - 0.48) * 8 + (positive ? 0.15 : -0.15);
      arr.push(Math.max(10, Math.min(90, v)));
    }
    return arr;
  }, [seed, positive]);

  const w = 800, h = 260;
  const step = w / (points.length - 1);
  const min = Math.min(...points), max = Math.max(...points);
  const y = (p: number) => h - ((p - min) / (max - min || 1)) * (h - 20) - 10;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${y(p)}`).join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  const stroke = positive ? "var(--bull)" : "var(--bear)";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`g-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
        <pattern id={`grid-${seed}`} width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#grid-${seed})`} />
      <path d={area} fill={`url(#g-${seed})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}
