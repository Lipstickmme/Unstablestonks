import { useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/data/geckoterminal";

/**
 * Real OHLC candlestick chart. Renders in the container's actual pixel space
 * (measured via ResizeObserver) so candles are never stretched/distorted, with
 * non-scaling 1px wicks. Green = close ≥ open, red = close < open.
 */
export function CandleChart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 800, h: 300 });

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => {
      setDim({ w: el.clientWidth || 800, h: el.clientHeight || 300 });
    });
    ro.observe(el);
    setDim({ w: el.clientWidth || 800, h: el.clientHeight || 300 });
    return () => ro.disconnect();
  }, []);

  const { w, h } = dim;
  const padY = 10;

  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
  }
  const range = hi - lo || 1;
  const y = (p: number) => padY + (1 - (p - lo) / range) * (h - padY * 2);
  const slot = candles.length ? w / candles.length : w;
  const bodyW = Math.max(2, Math.min(14, slot * 0.62));

  return (
    <div ref={ref} className="h-full w-full">
      {candles.length >= 2 && (
        <svg width={w} height={h} className="block">
          <defs>
            <pattern id="cgrid" width="48" height="40" patternUnits="userSpaceOnUse">
              <path
                d="M 48 0 L 0 0 0 40"
                fill="none"
                stroke="var(--border)"
                strokeWidth="0.5"
                opacity="0.3"
              />
            </pattern>
          </defs>
          <rect width={w} height={h} fill="url(#cgrid)" />
          {candles.map((c, i) => {
            const up = c.c >= c.o;
            const color = up ? "var(--bull)" : "var(--bear)";
            const cx = i * slot + slot / 2;
            const yO = y(c.o);
            const yC = y(c.c);
            const top = Math.min(yO, yC);
            const bodyH = Math.max(1, Math.abs(yC - yO));
            return (
              <g key={`${c.t}-${i}`}>
                <line
                  x1={cx}
                  x2={cx}
                  y1={y(c.h)}
                  y2={y(c.l)}
                  stroke={color}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={cx - bodyW / 2}
                  y={top}
                  width={bodyW}
                  height={bodyH}
                  fill={color}
                  rx={0.5}
                />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
