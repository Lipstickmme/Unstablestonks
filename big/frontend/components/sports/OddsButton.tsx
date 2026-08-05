"use client";

import { useEffect, useRef, useState } from "react";

import { formatOdds, OutcomeState } from "@/lib/azuro";

type Props = {
  label: string;
  odds: number;
  state: OutcomeState;
  selected: boolean;
  onClick: () => void;
};

/**
 * One price. Flashes green/red for a beat when the odds move so a bettor watching a live
 * market can see which way it went without diffing numbers themselves.
 */
export function OddsButton({ label, odds, state, selected, onClick }: Props) {
  const previous = useRef(odds);
  const [drift, setDrift] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (previous.current !== odds) {
      setDrift(odds > previous.current ? "up" : "down");
      previous.current = odds;

      const timer = setTimeout(() => setDrift(null), 1200);

      return () => clearTimeout(timer);
    }
  }, [odds]);

  const disabled = state !== OutcomeState.Active;

  const driftClass =
    drift === "up"
      ? "ring-1 ring-emerald-500 bg-emerald-500/10"
      : drift === "down"
        ? "ring-1 ring-red-500 bg-red-500/10"
        : "";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${
        selected
          ? "border-orange-500 bg-orange-500/15 text-orange-600 dark:text-orange-300"
          : "border-gray-200 hover:border-orange-400 dark:border-white/10 dark:hover:border-orange-500/60"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""} ${driftClass}`}
      aria-pressed={selected}
    >
      <span className="truncate text-gray-600 dark:text-neutral-400">{label}</span>
      <span className="font-semibold tabular-nums">
        {disabled ? "—" : formatOdds(odds)}
      </span>
    </button>
  );
}
