// Round state machine for RugRush.
//
// Pure functions only — the hook layer feeds it on-chain round data and a clock, and it
// returns what the UI should paint. Keeping it pure means the curve can be unit-tested
// against the Solidity implementation without a chain.

import { multiplierAt, toDisplayMultiplier } from "./fairness";
import type { TokenIdentity } from "./tokens";

/** Mirrors `RugRush.RoundState`. */
export enum RoundState {
  None = 0,
  Committed = 1,
  Running = 2,
  Revealed = 3,
  Voided = 4,
}

export type OnChainRound = {
  roundId: bigint;
  serverSeedHash: `0x${string}`;
  serverSeed: `0x${string}`;
  clientSeed: string;
  startedAt: bigint;
  revealDeadline: bigint;
  rugX18: bigint;
  totalStaked: bigint;
  totalPaid: bigint;
  state: RoundState;
};

export type Phase =
  | { kind: "idle" }
  /** Betting is open; the token is known, the launch has not started. */
  | { kind: "betting"; token: TokenIdentity }
  /** Curve is climbing. */
  | { kind: "running"; token: TokenIdentity; multiplier: number; elapsedMs: number }
  /** Rug revealed. */
  | { kind: "rugged"; token: TokenIdentity; rug: number }
  /** Operator never revealed; stakes are refundable. */
  | { kind: "voided"; token: TokenIdentity };

export type Position = {
  stake: bigint;
  autoSellX18: bigint;
  soldAtX18: bigint;
  settled: boolean;
};

/**
 * What phase a round is in right now.
 *
 * `nowMs` is passed in rather than read from `Date.now()` so the caller can drive it off
 * an animation frame and so tests are deterministic.
 */
export const resolvePhase = (
  round: OnChainRound | null,
  token: TokenIdentity | null,
  nowMs: number,
): Phase => {
  if (!round || !token || round.state === RoundState.None) {
    return { kind: "idle" };
  }

  if (round.state === RoundState.Committed) {
    return { kind: "betting", token };
  }

  if (round.state === RoundState.Voided) {
    return { kind: "voided", token };
  }

  if (round.state === RoundState.Revealed) {
    return { kind: "rugged", token, rug: toDisplayMultiplier(round.rugX18) };
  }

  const elapsedMs = Math.max(0, nowMs - Number(round.startedAt) * 1000);

  return {
    kind: "running",
    token,
    multiplier: toDisplayMultiplier(multiplierAt(elapsedMs)),
    elapsedMs,
  };
};

/**
 * Points for the chart, sampled at a fixed cadence up to `elapsedMs`.
 *
 * Sampling every 100ms would mean 1200 points at the ceiling, which is more than the
 * canvas can usefully show, so the step widens as the round runs on.
 */
export const sampleCurve = (
  elapsedMs: number,
  maxPoints = 240,
): { t: number; multiplier: number }[] => {
  const step = Math.max(100, Math.ceil(elapsedMs / maxPoints / 100) * 100);
  const points: { t: number; multiplier: number }[] = [];

  for (let t = 0; t <= elapsedMs; t += step) {
    points.push({ t, multiplier: toDisplayMultiplier(multiplierAt(t)) });
  }

  // Always pin the head to the exact current value, or the line lags the readout.
  points.push({ t: elapsedMs, multiplier: toDisplayMultiplier(multiplierAt(elapsedMs)) });

  return points;
};

export type PositionOutcome =
  | { kind: "none" }
  | { kind: "holding" }
  | { kind: "sold"; at: number; payout: bigint }
  | { kind: "auto-armed"; target: number }
  | { kind: "rugged"; lost: bigint }
  | { kind: "won"; at: number; payout: bigint }
  | { kind: "refundable"; amount: bigint };

const ONE = 10n ** 18n;

/** What a player's position is worth, given the round's current state. */
export const resolvePosition = (
  round: OnChainRound | null,
  position: Position | null,
  maxPayout: bigint,
): PositionOutcome => {
  if (!round || !position || position.stake === 0n) {
    return { kind: "none" };
  }

  const cap = (payout: bigint) => (payout > maxPayout ? maxPayout : payout);

  if (round.state === RoundState.Voided) {
    return { kind: "refundable", amount: position.stake };
  }

  if (round.state === RoundState.Revealed) {
    const exit =
      position.soldAtX18 > 0n
        ? position.soldAtX18 <= round.rugX18
          ? position.soldAtX18
          : 0n
        : position.autoSellX18 > 0n && position.autoSellX18 <= round.rugX18
          ? position.autoSellX18
          : 0n;

    if (exit === 0n) {
      return { kind: "rugged", lost: position.stake };
    }

    return {
      kind: "won",
      at: toDisplayMultiplier(exit),
      payout: cap((position.stake * exit) / ONE),
    };
  }

  if (position.soldAtX18 > 0n) {
    return {
      kind: "sold",
      at: toDisplayMultiplier(position.soldAtX18),
      payout: cap((position.stake * position.soldAtX18) / ONE),
    };
  }

  if (round.state === RoundState.Running) {
    return { kind: "holding" };
  }

  if (position.autoSellX18 > 0n) {
    return { kind: "auto-armed", target: toDisplayMultiplier(position.autoSellX18) };
  }

  return { kind: "holding" };
};

/** Launch events that have already scrolled past at the current multiplier. */
export const firedEvents = (token: TokenIdentity, multiplier: number) =>
  token.events.filter((event) => event.at <= multiplier);
