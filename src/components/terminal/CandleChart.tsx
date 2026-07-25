import { useMemo } from "react";
import type { Candle } from "@/lib/data/geckoterminal";

/** Real OHLC candlestick chart (SVG). Green = close ≥ open, red = close < open. */
export function CandleChart({ candles }: { candles: Candle[] }) {
  const w = 800;
  const h = 300;
  const pad = 8;

  const geo = useMemo(() => {
    if (candles.length < 2) return null;
    const lo = Math.min(...candles.map((c) => c.l));
    const hi = Math.max(...candles.map((c) => c.h));
    const range = hi - lo || 1;
    const y = (p: number) => pad + (1 - (p - lo) / range) * (h - pad * 2);
    const slot = w / candles.length;
    const bodyW = Math.max(1, Math.min(10, slot * 0.6));
    return { y, slot, bodyW };
  }, [candles]);

  if (!geo) return null;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" preserveAspectRatio="none">
      <defs>
        <pattern id="cgrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="var(--border)"
            strokeWidth="0.5"
            opacity="0.35"
          />
        </pattern>
      </defs>
      <rect width={w} height={h} fill="url(#cgrid)" />
      {candles.map((c, i) => {
        const up = c.c >= c.o;
        const color = up ? "var(--bull)" : "var(--bear)";
        const cx = i * geo.slot + geo.slot / 2;
        const yO = geo.y(c.o);
        const yC = geo.y(c.c);
        const top = Math.min(yO, yC);
        const bodyH = Math.max(1, Math.abs(yC - yO));
        return (
          <g key={c.t + "-" + i}>
            <line x1={cx} x2={cx} y1={geo.y(c.h)} y2={geo.y(c.l)} stroke={color} strokeWidth="1" />
            <rect
              x={cx - geo.bodyW / 2}
              y={top}
              width={geo.bodyW}
              height={bodyH}
              fill={color}
              opacity={up ? 0.9 : 0.85}
            />
          </g>
        );
      })}
    </svg>
  );
}
