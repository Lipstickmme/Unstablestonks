// Data model for the Azuro Protocol v3 feed and betting APIs.
//
// v3 processes every bet — prematch and live — through an off-chain relayer: the bettor
// signs EIP-712 typed data, the API places the order, and the Core contract settles it.
// These types mirror the wire format of https://api.onchainfeed.org/api/v1/public.

import type { Address, Hex } from "viem";

/** Azuro identifies a deployment by "environment", not by chain id alone. */
export enum Environment {
  PolygonUSDT = "PolygonUSDT",
  PolygonAmoyUSDT = "PolygonAmoyUSDT",
  BaseWETH = "BaseWETH",
  BaseSepoliaWETH = "BaseSepoliaWETH",
  ChilizWCHZ = "ChilizWCHZ",
  ChilizSpicyWCHZ = "ChilizSpicyWCHZ",
}

export enum GameState {
  Prematch = "Prematch",
  Live = "Live",
  Finished = "Finished",
  Stopped = "Stopped",
  Canceled = "Canceled",
}

export enum ConditionState {
  Active = "Active",
  Stopped = "Stopped",
  Resolved = "Resolved",
  Canceled = "Canceled",
  Removed = "Removed",
}

export enum OutcomeState {
  Active = "Active",
  Stopped = "Stopped",
  Canceled = "Canceled",
  Won = "Won",
  Lost = "Lost",
}

/**
 * Lifecycle of a bet order in the relayer.
 *
 * Created -> Placed -> Sent -> (Accepted | Rejected) -> Settled
 * A cancellation can interleave at any point after Created.
 */
export enum BetOrderState {
  Created = "Created",
  Placed = "Placed",
  Sent = "Sent",
  Accepted = "Accepted",
  Rejected = "Rejected",
  PendingCancel = "PendingCancel",
  CancelFailed = "CancelFailed",
  Canceled = "Canceled",
  Settled = "Settled",
}

export enum BetOrderResult {
  Won = "Won",
  Lost = "Lost",
  Canceled = "Canceled",
}

/** The status we actually surface to a bettor, collapsed from order + chain state. */
export enum BetStatus {
  Preparing = "Preparing",
  Accepted = "Accepted",
  Live = "Live",
  PendingResolution = "PendingResolution",
  Resolved = "Resolved",
  Canceled = "Canceled",
  Rejected = "Rejected",
}

export enum OrderDirection {
  Asc = "asc",
  Desc = "desc",
}

export enum GameOrderBy {
  StartsAt = "startsAt",
  Turnover = "turnover",
}

export type SportHubSlug = "sports" | "esports";

export type ConditionCategory =
  | "correct_score"
  | "handicap"
  | "handicap_3_way"
  | "odd_even"
  | "participant_and_total"
  | "participant_and_yes_no"
  | "participant_slash_participant"
  | "players"
  | "result"
  | "result_or_neither"
  | "total"
  | "total_3_way"
  | "winner"
  | "yes_no"
  | (string & {})
  | null;

export type GameParticipant = {
  name: string;
  image?: string | null;
};

export type GameData = {
  id: string;
  gameId: string;
  slug: string;
  title: string;
  /** Unix seconds, as a string — matches the legacy subgraph shape. */
  startsAt: string;
  state: GameState;
  turnover: string;
  sport: {
    sportId: string;
    slug: string;
    name: string;
    sporthub: { id: string; slug: SportHubSlug };
  };
  league: {
    id?: string;
    slug: string;
    name: string;
    isTopLeague: boolean;
    topWeight?: number;
  };
  country: { id?: string; slug: string; name: string };
  participants: GameParticipant[];
};

export type PaginatedGames = {
  games: GameData[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

export type LeagueData = {
  slug: string;
  name: string;
  turnover: string;
  isTopLeague: boolean;
  topWeight?: number;
  games: GameData[];
};

export type SportTree = {
  id: number;
  slug: string;
  name: string;
  sportId: string;
  turnover: string;
  countries: {
    slug: string;
    name: string;
    turnover: string;
    leagues: LeagueData[];
  }[];
};

export type NavigationLeague = {
  id: string;
  slug: string;
  name: string;
  isTopLeague: boolean;
  topWeight?: number;
  turnover: string;
  activeGamesCount: number;
  activeLiveGamesCount: number;
  activePrematchGamesCount: number;
};

export type NavigationSport = {
  id: number;
  slug: string;
  name: string;
  sportId: string;
  sportHub: { id: string; slug: SportHubSlug };
  activeGamesCount: number;
  activeLiveGamesCount: number;
  activePrematchGamesCount: number;
  countries: {
    id: string;
    slug: string;
    name: string;
    turnover: string;
    activeGamesCount: number;
    activeLiveGamesCount: number;
    activePrematchGamesCount: number;
    leagues: NavigationLeague[];
  }[];
};

export type OutcomeData = {
  title: string;
  outcomeId: string;
  /** Odds scaled by 1e12 — see ODDS_DECIMALS. */
  odds: string;
  sort: string;
  /** Handicap / total line for "5..." conditions, e.g. "-2.5". */
  point?: string | null;
  hidden: boolean;
  state: OutcomeState;
};

export type ConditionData = {
  id: string;
  conditionId: string;
  state: ConditionState;
  title: string;
  isExpressForbidden: boolean;
  isPrematchEnabled: boolean;
  isLiveEnabled: boolean;
  hidden?: boolean;
  margin: string;
  outcomes: OutcomeData[];
  category: ConditionCategory;
  game: { gameId: string; sport: { sportId: string } };
  wonOutcomeIds: string[];
  sort: string;
  marketId?: string | null;
  marketVarietyId?: string | null;
};

/** A condition + outcome pair. This is what a bettor actually picks. */
export type Selection = {
  conditionId: string;
  outcomeId: string;
};

export type MarketOutcome = Selection & {
  title: string;
  odds: number;
  state: OutcomeState;
  hidden: boolean;
  point?: string | null;
  isExpressForbidden: boolean;
  gameId: string;
};

export type Market = {
  marketKey: string;
  name: string;
  category: ConditionCategory;
  conditions: {
    conditionId: string;
    state: ConditionState;
    margin: string;
    isExpressForbidden: boolean;
    outcomes: MarketOutcome[];
  }[];
};

/**
 * The client half of the EIP-712 payload. `affiliate` is the address credited with
 * GGR for this bet, which is how a front end earns from the protocol.
 */
export type BetClientData = {
  attention: string;
  affiliate: Address;
  core: Address;
  expiresAt: number;
  chainId: number;
  relayerFeeAmount: string;
  isBetSponsored: boolean;
  isFeeSponsored: boolean;
  isSponsoredBetReturnable: boolean;
};

export type SignedSubBet = {
  conditionId: string;
  outcomeId: number;
  minOdds: string;
  amount: string;
  nonce: string;
};

export type CreateBetResponse = {
  id: string;
  state: BetOrderState;
  errorMessage?: string;
  error?: string;
};

export type BetCalculationSelection = Selection & { amount?: string };

export type BetCalculation = {
  /** Odds scaled by 1e12. */
  odds: string;
  /** Largest stake the pool will accept for this selection, in bet-token units. */
  maxBet: string;
  minBet?: string;
  /** Relayer gas cost the bettor covers, in bet-token units. */
  relayerFeeAmount: string;
};

export enum BonusType {
  FreeBet = "FreeBet",
}

export enum BonusStatus {
  Available = "Available",
  Used = "Used",
}

export enum FreebetType {
  /** Only the profit is paid out; the stake stays with the house. */
  OnlyWin = "OnlyWin",
  /** Stake + profit are both paid out. */
  AllWin = "AllWin",
}

export enum BetRestrictionType {
  Ordinar = "Ordinar",
  Combo = "Combo",
}

export type Freebet = {
  id: string;
  type: BonusType.FreeBet;
  amount: string;
  status: BonusStatus;
  chainId: number;
  expiresAt: number;
  usedAt: number;
  createdAt: number;
  publicCustomData: Record<string, string> | null;
  params: {
    isBetSponsored: boolean;
    isFeeSponsored: boolean;
    isSponsoredBetReturnable: boolean;
  };
  settings: {
    type: FreebetType;
    feeSponsored: boolean;
    betRestriction: {
      type?: BetRestrictionType;
      minOdds: string;
      maxOdds?: string;
    };
    eventRestriction: {
      state?: GameState.Live | GameState.Prematch;
      eventFilter?: {
        exclude: boolean;
        filter: {
          sportId: string;
          leagues: string[];
          markets: { marketId: number; gamePeriodId: number; gameTypeId: number }[];
        }[];
      };
    };
    periodOfValidityMs: number;
  };
};

export type BetHistoryItem = {
  id: string;
  betId?: string;
  txHash?: Hex;
  orderState: BetOrderState | null;
  result?: BetOrderResult | null;
  amount: string;
  odds: string;
  possiblePayout: string;
  payout?: string | null;
  isCashedOut?: boolean;
  createdAt: number;
  settledAt?: number | null;
  selections: (Selection & {
    outcomeTitle?: string;
    marketTitle?: string;
    odds: string;
    state: OutcomeState;
    game: Pick<GameData, "gameId" | "title" | "startsAt" | "state" | "sport" | "league" | "participants">;
  })[];
};

export type CashoutQuote = {
  betId: string;
  /** Amount returned if the bettor closes now, in bet-token units. */
  cashoutAmount: string;
  /** Odds the cashout was priced at, scaled by 1e12. */
  odds: string;
  isAvailable: boolean;
  expiresAt?: number;
};
