// Provable fairness for RugRush.
//
// This is a line-for-line mirror of `RugRush.rugMultiplier` and `RugRush.multiplierAt` in
// Solidity. That is the whole point: a player pastes the revealed server seed into the
// verifier and recomputes the rug themselves, without trusting us or an RPC.
//
// Keep this file and contracts/contracts/RugRush.sol in lockstep — if one changes, the
// other is wrong.

import { encodePacked, keccak256 } from "viem";

/** Curve tick in milliseconds. */
export const TICK_MS = 100n;

/** Growth per tick, 1e18-scaled: 2^(1/60), so the price doubles every 6 seconds. */
export const GROWTH_PER_TICK = 1011619440000000000n;

/** Ceiling on the curve — 1200 ticks is 120 seconds, about 2^20. */
export const MAX_TICKS = 1200n;

/** One round in 101 rugs at 1.00x. That is the house edge, ~0.99%. */
export const INSTANT_RUG_DIVISOR = 101n;

const ONE = 10n ** 18n;

/** Fixed-point exponentiation by squaring — the same algorithm the contract runs. */
const pow = (base: bigint, exponent: bigint): bigint => {
  let result = ONE;
  let b = base;
  let e = exponent;

  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) / ONE;
    }

    e >>= 1n;

    if (e > 0n) {
      b = (b * b) / ONE;
    }
  }

  return result;
};

/** Multiplier after `elapsedMs`, 1e18-scaled. */
export const multiplierAt = (elapsedMs: number | bigint): bigint => {
  let ticks = BigInt(Math.max(0, Math.floor(Number(elapsedMs)))) / TICK_MS;

  if (ticks > MAX_TICKS) {
    ticks = MAX_TICKS;
  }

  return pow(GROWTH_PER_TICK, ticks);
};

/** Inverse of `multiplierAt` — when the curve reaches a multiplier, in ms. */
export const timeToReach = (multiplier: number): number => {
  if (multiplier <= 1) {
    return 0;
  }

  const growth = Number(GROWTH_PER_TICK) / 1e18;
  const ticks = Math.log(multiplier) / Math.log(growth);

  return Math.ceil(ticks) * Number(TICK_MS);
};

/** The rug multiplier for a round, 1e18-scaled. Identical to the on-chain derivation. */
export const rugMultiplier = (
  serverSeed: `0x${string}`,
  clientSeed: string,
  nonce: number | bigint,
): bigint => {
  const packed = encodePacked(
    ["bytes32", "string", "uint256"],
    [serverSeed, clientSeed, BigInt(nonce)],
  );
  const hash = BigInt(keccak256(packed));

  if (hash % INSTANT_RUG_DIVISOR === 0n) {
    return ONE;
  }

  const e = 1n << 52n;
  const h = hash >> 204n;
  const hundredths = (100n * e - h) / (e - h);

  return hundredths * 10n ** 16n;
};

/** 1e18-scaled multiplier to a display number, e.g. 2500000000000000000n -> 2.5. */
export const toDisplayMultiplier = (x18: bigint): number => Number(x18) / 1e18;

export const formatMultiplier = (x18: bigint | number): string => {
  const value = typeof x18 === "bigint" ? toDisplayMultiplier(x18) : x18;

  return `${value.toFixed(2)}×`;
};

/** Does a revealed seed match the hash the operator published before the round? */
export const verifyCommit = (
  serverSeed: `0x${string}`,
  publishedHash: `0x${string}`,
): boolean => keccak256(encodePacked(["bytes32"], [serverSeed])) === publishedHash;

export type RoundVerification = {
  matchesCommit: boolean;
  rugX18: bigint;
  rug: number;
  /** Where the operator said it rugged, when we have it to compare against. */
  reportedRug?: number;
  agrees: boolean;
};

/**
 * Everything the fairness page needs in one call: did the seed match the commit, and does
 * the rug it produces match what the round actually paid out at.
 */
export const verifyRound = (params: {
  serverSeed: `0x${string}`;
  serverSeedHash: `0x${string}`;
  clientSeed: string;
  nonce: number | bigint;
  reportedRugX18?: bigint;
}): RoundVerification => {
  const matchesCommit = verifyCommit(params.serverSeed, params.serverSeedHash);
  const rugX18 = rugMultiplier(params.serverSeed, params.clientSeed, params.nonce);
  const agrees =
    params.reportedRugX18 === undefined ? matchesCommit : matchesCommit && rugX18 === params.reportedRugX18;

  return {
    matchesCommit,
    rugX18,
    rug: toDisplayMultiplier(rugX18),
    reportedRug:
      params.reportedRugX18 === undefined ? undefined : toDisplayMultiplier(params.reportedRugX18),
    agrees,
  };
};

/**
 * Expected value per unit staked at a given auto-sell target, given the distribution the
 * rug formula produces. Shown on the game page so the edge is stated, not hidden.
 *
 * P(rug >= m) = (1 - 1/INSTANT_RUG_DIVISOR) * (1/m) for m > 1.
 */
export const expectedValue = (target: number): number => {
  if (target <= 1) {
    return 1;
  }

  const survives = (1 - 1 / Number(INSTANT_RUG_DIVISOR)) / target;

  return survives * target;
};

export const houseEdge = (): number => 1 / Number(INSTANT_RUG_DIVISOR);
