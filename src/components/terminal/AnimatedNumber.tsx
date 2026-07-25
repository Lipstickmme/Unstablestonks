import { useEffect, useRef, useState } from "react";

/**
 * Tweens between values when the number changes — the digits roll up (or down)
 * to the new figure. Purely presentational; the value itself is real data.
 */
export function AnimatedNumber({
  value,
  format,
  durationMs = 900,
  className,
}: {
  value: number | null | undefined;
  format: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState<number | null>(value ?? null);
  const fromRef = useRef<number>(value ?? 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (value == null) return;
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic
      const e = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * e;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = to;
    };
  }, [value, durationMs]);

  if (display == null) return <span className={className}>—</span>;
  return <span className={className}>{format(display)}</span>;
}
