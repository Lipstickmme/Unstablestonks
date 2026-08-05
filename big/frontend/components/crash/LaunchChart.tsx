"use client";

import { useEffect, useRef } from "react";

import { sampleCurve } from "@/lib/games/crash/engine";
import { marketCapAt, type TokenIdentity } from "@/lib/games/crash/tokens";

type Props = {
  token: TokenIdentity;
  elapsedMs: number;
  multiplier: number;
  /** Set once the round has rugged — the line drops and goes red. */
  rug?: number;
  /** Where the player's auto-sell sits, drawn as a target line. */
  autoSell?: number;
  /** Where the player actually got out. */
  soldAt?: number;
};

/**
 * The launch chart. Reads as a token's market cap going vertical and then falling off a
 * cliff, which is the whole conceit of the game — but the y-axis is the same multiplier
 * the contract computes, so nothing here is decorative maths.
 */
export function LaunchChart({ token, elapsedMs, multiplier, rug, autoSell, soldAt }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const padding = { left: 8, right: 56, top: 16, bottom: 24 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    const points = sampleCurve(elapsedMs);
    const peak = Math.max(multiplier, rug ?? 0, autoSell ?? 0, 1.4);

    // Log scale on y, or the early game is a flat line and the late game is a wall.
    const yFor = (value: number) => {
      const normalized = Math.log(Math.max(value, 1)) / Math.log(peak * 1.08);

      return padding.top + plotHeight - normalized * plotHeight;
    };

    const xFor = (t: number) => {
      const span = Math.max(elapsedMs, 3_000);

      return padding.left + (t / span) * plotWidth;
    };

    // Gridlines at each doubling.
    context.strokeStyle = "rgba(128,128,128,0.15)";
    context.fillStyle = "rgba(128,128,128,0.7)";
    context.font = "10px system-ui, sans-serif";
    context.lineWidth = 1;

    for (let value = 2; value <= peak * 1.08; value *= 2) {
      const y = yFor(value);
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(padding.left + plotWidth, y);
      context.stroke();
      context.fillText(`${value}×`, padding.left + plotWidth + 6, y + 3);
    }

    const rugged = rug !== undefined;
    const lineColor = rugged ? "#ef4444" : token.accent;

    // Fill under the curve.
    const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
    gradient.addColorStop(0, `${lineColor}55`);
    gradient.addColorStop(1, `${lineColor}00`);

    context.beginPath();
    context.moveTo(xFor(0), padding.top + plotHeight);
    points.forEach((point) => context.lineTo(xFor(point.t), yFor(point.multiplier)));
    context.lineTo(xFor(elapsedMs), padding.top + plotHeight);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();

    // The curve.
    context.beginPath();
    points.forEach((point, index) => {
      const x = xFor(point.t);
      const y = yFor(point.multiplier);

      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.strokeStyle = lineColor;
    context.lineWidth = 2.5;
    context.lineJoin = "round";
    context.stroke();

    // The rug: straight down from the last point.
    if (rugged) {
      const x = xFor(elapsedMs);
      context.beginPath();
      context.moveTo(x, yFor(rug));
      context.lineTo(x, padding.top + plotHeight);
      context.strokeStyle = "#ef4444";
      context.lineWidth = 2.5;
      context.stroke();
    }

    const marker = (value: number, color: string, label: string) => {
      const y = yFor(value);
      context.beginPath();
      context.setLineDash([4, 4]);
      context.moveTo(padding.left, y);
      context.lineTo(padding.left + plotWidth, y);
      context.strokeStyle = color;
      context.lineWidth = 1;
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = color;
      context.fillText(label, padding.left + 4, y - 4);
    };

    if (autoSell && !soldAt) {
      marker(autoSell, "#eab308", `auto ${autoSell.toFixed(2)}×`);
    }

    if (soldAt) {
      marker(soldAt, "#22c55e", `sold ${soldAt.toFixed(2)}×`);
    }

    // Head of the curve.
    if (!rugged) {
      const x = xFor(elapsedMs);
      const y = yFor(multiplier);
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fillStyle = lineColor;
      context.fill();
    }
  }, [token, elapsedMs, multiplier, rug, autoSell, soldAt]);

  return (
    <div className="relative h-64 w-full sm:h-80">
      <canvas ref={canvasRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`text-5xl font-bold tabular-nums sm:text-6xl ${
            rug !== undefined ? "text-red-500" : ""
          }`}
          style={rug === undefined ? { color: token.accent } : undefined}
        >
          {(rug ?? multiplier).toFixed(2)}×
        </span>
        <span className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
          {rug !== undefined
            ? "rugged"
            : `mcap ${formatCompact(marketCapAt(token, multiplier))}`}
        </span>
      </div>
    </div>
  );
}

const formatCompact = (value: number): string => {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }

  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }

  return `$${value.toFixed(0)}`;
};
