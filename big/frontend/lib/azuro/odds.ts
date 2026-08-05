// Odds arithmetic.
//
// The protocol quotes odds as an integer scaled by 1e12 (ODDS_DECIMALS). Everything that
// touches money stays in that integer form; only the display helpers drop to `number`.

import { formatUnits, parseUnits } from "viem";

import { ODDS_COMBO_FEE_MODIFIER, ODDS_DECIMALS } from "./config";
import type { Selection } from "./types";

/** Raw protocol odds (1e12-scaled) to a decimal price, e.g. 1850000000000n -> 1.85. */
export const oddsToDecimal = (raw: string | bigint): number =>
  Number(formatUnits(BigInt(raw), ODDS_DECIMALS));

/** Decimal price to raw protocol odds, e.g. 1.85 -> 1850000000000n. */
export const decimalToOdds = (decimal: number | string): bigint =>
  parseUnits(String(decimal), ODDS_DECIMALS);

export const formatOdds = (raw: string | bigint | number, fractionDigits = 2): string => {
  const decimal = typeof raw === "number" ? raw : oddsToDecimal(raw);

  return decimal.toFixed(fractionDigits);
};

/** American odds, for bettors who read prices as +150 / -200. */
export const toAmericanOdds = (decimal: number): string => {
  if (decimal <= 1) {
    return "—";
  }

  const american = decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1);

  return `${american > 0 ? "+" : ""}${Math.round(american)}`;
};

/** Fractional odds, e.g. 2.5 -> "3/2". */
export const toFractionalOdds = (decimal: number): string => {
  if (decimal <= 1) {
    return "—";
  }

  const profit = decimal - 1;
  // Denominators past 100 stop being readable, so approximate against a small ladder.
  let bestNumerator = 1;
  let bestDenominator = 1;
  let bestError = Infinity;

  for (let denominator = 1; denominator <= 100; denominator++) {
    const numerator = Math.round(profit * denominator);
    const error = Math.abs(profit - numerator / denominator);

    if (error < bestError - 1e-9) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
    }
  }

  return `${bestNumerator}/${bestDenominator}`;
};

export const impliedProbability = (decimal: number): number => (decimal > 0 ? 1 / decimal : 0);

/**
 * Combo (parlay) price: legs multiply, and every leg past the first is shaded by the
 * protocol's combo fee modifier.
 */
export const calcComboOdds = (legOdds: number[]): number => {
  if (!legOdds.length) {
    return 0;
  }

  const product = legOdds.reduce((acc, odds) => acc * odds, 1);

  if (legOdds.length === 1) {
    return product;
  }

  return product * ODDS_COMBO_FEE_MODIFIER ** (legOdds.length - 1);
};

/**
 * Floor price the relayer must beat, given the bettor's slippage tolerance.
 *
 * Odds move between quote and settlement; `minOdds` is the bettor's protection. The
 * protocol rejects anything at or below 1.0, so we clamp just above it.
 */
export const calcMinOdds = (quotedOdds: number, slippagePercent: number): bigint => {
  const tolerance = Math.max(0, Math.min(slippagePercent, 100)) / 100;
  const floorDecimal = quotedOdds * (1 - tolerance);
  const raw = decimalToOdds(floorDecimal.toFixed(ODDS_DECIMALS));
  const minimum = decimalToOdds("1.000000000001");

  return raw > minimum ? raw : minimum;
};

export type PayoutBreakdown = {
  stake: number;
  odds: number;
  /** Stake x odds — what lands in the wallet on a win. */
  payout: number;
  /** Payout minus stake. */
  profit: number;
};

export const calcPayout = (stake: number, odds: number): PayoutBreakdown => {
  const payout = stake * odds;

  return { stake, odds, payout, profit: payout - stake };
};

/**
 * Bookmaker margin baked into a set of prices. 0.05 means the book is priced at 105%.
 * Useful for showing bettors how sharp a market is.
 */
export const calcMargin = (decimalOdds: number[]): number => {
  const book = decimalOdds.reduce((acc, odds) => acc + impliedProbability(odds), 0);

  return book - 1;
};

/** Two selections conflict if they resolve on the same condition — combos can't hold both. */
export const isSameCondition = (a: Selection, b: Selection): boolean =>
  a.conditionId === b.conditionId;

export const selectionKey = (selection: Selection): string =>
  `${selection.conditionId}-${selection.outcomeId}`;
