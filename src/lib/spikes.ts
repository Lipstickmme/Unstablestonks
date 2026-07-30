import { useEffect, useRef, useState } from "react";
import type { TokenRow } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// "Something just happened here."
//
// The terminal refreshes every 30 seconds and the numbers simply change. A jump
// from $4k to $90k of volume looks exactly like a jump from $4k to $4.1k unless
// you happen to be staring at that row. This watches the values BETWEEN
// refreshes and marks the rows that actually moved, so the UI can shake them.
//
// It is deliberately hard to trigger. An attention effect that fires on every
// tick is noise, and noise is worse than nothing — so a spike needs both a large
// relative jump AND enough absolute size to matter, and a row that has fired
// stays quiet for a cooldown afterwards.
//
// Nothing here is a prediction. It reports a change that already happened in
// data the app already had.
// ─────────────────────────────────────────────────────────────────────────────

export type SpikeKind = "volume" | "mcap" | "price" | "whales";

export interface Spike {
  kind: SpikeKind;
  /** Multiple of the previous value, e.g. 3.2 = tripled. */
  factor: number;
  at: number;
}

/** How long a spike stays "fresh" — the shake and the badge both last this. */
const SPIKE_TTL = 12_000;
/** A row that just fired can't fire again for this long. */
const COOLDOWN = 90_000;

/**
 * Thresholds. Relative catches the interesting move; absolute stops a token
 * going from $3 to $30 of volume from screaming for attention.
 */
const RULES: Record<Exclude<SpikeKind, "whales">, { factor: number; floor: number }> = {
  // Volume is the loudest real signal on a launchpad, and the noisiest, so it
  // needs the most room: a tripling, and at least five figures of it.
  volume: { factor: 3, floor: 10_000 },
  mcap: { factor: 1.5, floor: 50_000 },
  price: { factor: 1.35, floor: 0 },
};

/** Whale holders appearing at all is the signal — no ratio applies. */
const WHALE_JUMP = 2;

interface Snapshot {
  vol24h: number;
  mcap: number;
  price: number;
  whales: number;
}

/**
 * Rows that just moved, keyed by address.
 *
 * Pass the live list plus whatever whale counts are known. The returned map only
 * ever holds fresh spikes; entries expire on their own, which is what lets a
 * consumer render the effect without any teardown of its own.
 */
export function useSpikes(
  tokens: TokenRow[],
  whaleCounts?: Record<string, number | undefined>,
): Record<string, Spike> {
  const previous = useRef(new Map<string, Snapshot>());
  const lastFired = useRef(new Map<string, number>());
  const [spikes, setSpikes] = useState<Record<string, Spike>>({});

  useEffect(() => {
    if (!tokens.length) return;
    const now = Date.now();
    const found: Record<string, Spike> = {};

    for (const t of tokens) {
      const key = t.address.toLowerCase();
      const next: Snapshot = {
        vol24h: t.vol24h || 0,
        mcap: t.mcap || 0,
        price: t.price || 0,
        whales: whaleCounts?.[t.address] ?? 0,
      };
      const prev = previous.current.get(key);
      previous.current.set(key, next);

      // First sighting is not a spike — everything would fire on load.
      if (!prev) continue;
      if (now - (lastFired.current.get(key) ?? 0) < COOLDOWN) continue;

      const spike = detect(prev, next, now);
      if (spike) {
        found[key] = spike;
        lastFired.current.set(key, now);
      }
    }

    if (Object.keys(found).length === 0) return;
    setSpikes((cur) => ({ ...cur, ...found }));

    const timer = setTimeout(() => {
      setSpikes((cur) => {
        const kept = Object.fromEntries(
          Object.entries(cur).filter(([, s]) => Date.now() - s.at < SPIKE_TTL),
        );
        return Object.keys(kept).length === Object.keys(cur).length ? cur : kept;
      });
    }, SPIKE_TTL + 200);
    return () => clearTimeout(timer);
  }, [tokens, whaleCounts]);

  return spikes;
}

function detect(prev: Snapshot, next: Snapshot, at: number): Spike | null {
  // Whales first: a wallet crossing five figures into a token outranks any
  // percentage move, because it is somebody's actual decision rather than drift.
  if (next.whales - prev.whales >= WHALE_JUMP) {
    return { kind: "whales", factor: next.whales - prev.whales, at };
  }

  for (const kind of ["volume", "mcap", "price"] as const) {
    const rule = RULES[kind];
    const before = kind === "volume" ? prev.vol24h : kind === "mcap" ? prev.mcap : prev.price;
    const after = kind === "volume" ? next.vol24h : kind === "mcap" ? next.mcap : next.price;

    // A value arriving from nothing is a source filling in a blank, not a move.
    if (before <= 0 || after <= 0) continue;
    if (after < rule.floor) continue;
    const factor = after / before;
    if (factor >= rule.factor) return { kind, factor, at };
  }
  return null;
}

/** Words for the badge. Kept short — it sits inside a table row. */
export function spikeLabel(s: Spike): string {
  switch (s.kind) {
    case "whales":
      return `+${s.factor} whales`;
    case "volume":
      return `${s.factor.toFixed(1)}× volume`;
    case "mcap":
      return `${s.factor.toFixed(1)}× mcap`;
    case "price":
      return `+${((s.factor - 1) * 100).toFixed(0)}% price`;
  }
}
