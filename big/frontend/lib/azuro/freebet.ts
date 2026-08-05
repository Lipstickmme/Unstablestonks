// Freebets and bonuses.
//
// A freebet is a house-funded stake: the operator (the affiliate address) puts up the
// money, and the bettor signs an order with `isBetSponsored`. Two flavours matter —
// `AllWin` returns stake + profit, `OnlyWin` returns profit alone — and each carries
// restrictions (min odds, prematch-vs-live, sport/league/market filters) the betslip has
// to enforce before offering it.

import type { Address } from "viem";

import { AFFILIATE_ADDRESS, getChainData } from "./config";
import { calcComboOdds } from "./odds";
import {
  BetRestrictionType,
  BonusStatus,
  type Freebet,
  FreebetType,
  GameState,
  type Selection,
} from "./types";

const postJson = async <T>(url: string, body: unknown): Promise<T | null> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Azuro bonus request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
};

/** Every bonus held by an account, regardless of what is in the betslip. */
export const getBonuses = async (
  chainId: number,
  account: Address,
  affiliate: Address = AFFILIATE_ADDRESS,
  status: BonusStatus = BonusStatus.Available,
): Promise<Freebet[]> => {
  const { api } = getChainData(chainId);
  const data = await postJson<Freebet[]>(`${api}/bonus/get-by-addresses`, {
    bettorAddress: account,
    poolAddress: affiliate,
    status,
  });

  return data ?? [];
};

/** Only the freebets that are actually valid for the current selections. */
export const getAvailableFreebets = async (
  chainId: number,
  account: Address,
  selections: Selection[],
  affiliate: Address = AFFILIATE_ADDRESS,
): Promise<Freebet[]> => {
  const { api, environment } = getChainData(chainId);
  const data = await postJson<Freebet[]>(`${api}/bonus/freebet/get-available`, {
    environment,
    bettorAddress: account,
    poolAddress: affiliate,
    selections: selections.map(({ conditionId, outcomeId }) => ({
      conditionId,
      outcomeId: Number(outcomeId),
    })),
  });

  return data ?? [];
};

export type FreebetEligibility = { eligible: true } | { eligible: false; reason: string };

export type BetContext = {
  selections: (Selection & {
    odds: number;
    sportId: string;
    leagueSlug: string;
    gameState: GameState;
  })[];
};

/**
 * Client-side gate so the betslip can grey out a freebet with a reason instead of letting
 * the relayer reject the order after the bettor has already signed.
 *
 * The API is authoritative — this mirrors its rules for a better UX, it does not replace
 * them.
 */
export const checkFreebetEligibility = (
  freebet: Freebet,
  context: BetContext,
): FreebetEligibility => {
  const { selections } = context;

  if (!selections.length) {
    return { eligible: false, reason: "Add a selection first" };
  }

  if (freebet.status !== BonusStatus.Available) {
    return { eligible: false, reason: "Already used" };
  }

  if (freebet.expiresAt * 1000 < Date.now()) {
    return { eligible: false, reason: "Expired" };
  }

  const isCombo = selections.length > 1;
  const restriction = freebet.settings.betRestriction;

  if (restriction.type === BetRestrictionType.Ordinar && isCombo) {
    return { eligible: false, reason: "Single bets only" };
  }

  if (restriction.type === BetRestrictionType.Combo && !isCombo) {
    return { eligible: false, reason: "Combo bets only" };
  }

  const odds = isCombo
    ? calcComboOdds(selections.map((selection) => selection.odds))
    : selections[0].odds;

  if (restriction.minOdds && odds < Number(restriction.minOdds)) {
    return { eligible: false, reason: `Minimum odds ${Number(restriction.minOdds).toFixed(2)}` };
  }

  if (restriction.maxOdds && odds > Number(restriction.maxOdds)) {
    return { eligible: false, reason: `Maximum odds ${Number(restriction.maxOdds).toFixed(2)}` };
  }

  const eventRestriction = freebet.settings.eventRestriction;

  if (eventRestriction.state) {
    const wanted = eventRestriction.state;
    const mismatch = selections.some((selection) => selection.gameState !== wanted);

    if (mismatch) {
      return {
        eligible: false,
        reason: wanted === GameState.Live ? "Live events only" : "Prematch events only",
      };
    }
  }

  const eventFilter = eventRestriction.eventFilter;

  if (eventFilter) {
    const matchesFilter = selections.every((selection) =>
      eventFilter.filter.some((rule) => {
        if (rule.sportId && rule.sportId !== selection.sportId) {
          return false;
        }

        if (rule.leagues?.length && !rule.leagues.includes(selection.leagueSlug)) {
          return false;
        }

        return true;
      }),
    );

    // `exclude` inverts the filter: listed events are the ones the freebet may NOT be used on.
    const allowed = eventFilter.exclude ? !matchesFilter : matchesFilter;

    if (!allowed) {
      return { eligible: false, reason: "Not valid for these events" };
    }
  }

  return { eligible: true };
};

/**
 * What a freebet actually pays. `OnlyWin` keeps the stake, so a 10-unit freebet at 2.00
 * returns 10, not 20 — worth spelling out in the betslip because bettors misread it.
 */
export const calcFreebetPayout = (freebet: Freebet, odds: number): number => {
  const stake = Number(freebet.amount);
  const gross = stake * odds;

  return freebet.settings.type === FreebetType.AllWin ? gross : gross - stake;
};

export const describeFreebet = (freebet: Freebet, tokenSymbol: string): string => {
  const kind =
    freebet.settings.type === FreebetType.AllWin ? "stake returned" : "winnings only";
  const minOdds = freebet.settings.betRestriction.minOdds;
  const parts = [`${freebet.amount} ${tokenSymbol} freebet`, kind];

  if (minOdds) {
    parts.push(`min odds ${Number(minOdds).toFixed(2)}`);
  }

  return parts.join(" · ");
};
