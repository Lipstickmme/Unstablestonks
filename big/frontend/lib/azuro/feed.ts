// Azuro v3 feed client.
//
// Every read the book needs — the sport tree, game lists, and the odds attached to a
// game — comes from `market-manager`. The feed is keyed by sport id, and Azuro carries
// 128 of them (see ./sports.ts), which is what makes this a full book rather than a
// football-only one: nothing here special-cases a sport.

import { getChainData } from "./config";
import { getSportHub, SPORT_BY_SLUG } from "./sports";
import {
  type ConditionData,
  type GameData,
  GameOrderBy,
  GameState,
  type Market,
  type MarketOutcome,
  type NavigationSport,
  OrderDirection,
  type PaginatedGames,
  type SportHubSlug,
  type SportTree,
} from "./types";

type Primitive = string | number | boolean | bigint | null | undefined;

const serializeParams = (struct: Record<string, Primitive | Primitive[]>): string => {
  const params = new URLSearchParams();

  const append = (key: string, value: Primitive) => {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  };

  Object.entries(struct).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => append(key, item));
      return;
    }

    append(key, value);
  });

  return params.toString();
};

class AzuroFeedError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
    statusText: string,
  ) {
    super(`Azuro feed ${endpoint} failed: ${status} ${statusText}`);
    this.name = "AzuroFeedError";
  }
}

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new AzuroFeedError(new URL(url).pathname, response.status, response.statusText);
  }

  return response.json() as Promise<T>;
};

const postJson = <T>(url: string, body: unknown): Promise<T> =>
  request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export type FeedScope = GameState.Prematch | GameState.Live;

// -- Navigation ---------------------------------------------------------------------

export type GetNavigationParams = {
  chainId: number;
  sportHub?: SportHubSlug;
  sportIds?: (string | number)[];
};

/**
 * The sport -> country -> league tree with live/prematch counts on every node. This is
 * what the sidebar renders, and it is the entry point for every sport the protocol
 * carries, not a curated subset.
 */
export const getNavigation = async ({
  chainId,
  sportHub,
  sportIds,
}: GetNavigationParams): Promise<NavigationSport[]> => {
  const { api, environment } = getChainData(chainId);
  const params = serializeParams({ environment, sportHub, sportId: sportIds });
  const data = await request<{ sports: NavigationSport[] }>(
    `${api}/market-manager/navigation?${params}`,
  );

  return data.sports ?? [];
};

// -- Sport tree ---------------------------------------------------------------------

export type GetSportsParams = {
  chainId: number;
  state: FeedScope;
  sportIds?: (string | number)[];
  sportSlug?: string;
  countrySlug?: string;
  leagueSlug?: string;
  topLeagueFilter?: "All" | "TopOnly" | "NonTop";
  /** Games returned per league. The API floors this at 10. */
  numberOfGames?: number;
  orderBy?: GameOrderBy;
  orderDir?: OrderDirection;
};

export const getSports = async (props: GetSportsParams): Promise<SportTree[]> => {
  const { api, environment } = getChainData(props.chainId);
  const params = serializeParams({
    environment,
    gameState: props.state,
    sportId: props.sportIds,
    sportSlug: props.sportSlug,
    countrySlug: props.countrySlug,
    leagueSlug: props.leagueSlug,
    topLeagueFilter: props.topLeagueFilter,
    numberOfGames: Math.max(props.numberOfGames ?? 10, 10),
    orderBy: props.orderBy ?? GameOrderBy.StartsAt,
    orderDirection: props.orderDir ?? OrderDirection.Asc,
  });

  const data = await request<{ sports: SportTree[] }>(`${api}/market-manager/sports?${params}`);

  return data.sports ?? [];
};

// -- Games --------------------------------------------------------------------------

export type GetGamesParams = {
  chainId: number;
  state: FeedScope;
  sportHub?: SportHubSlug;
  sportIds?: (string | number)[];
  sportSlug?: string;
  leagueSlug?: string;
  orderBy?: GameOrderBy;
  orderDir?: OrderDirection;
  page?: number;
  perPage?: number;
};

export const getGames = async (props: GetGamesParams): Promise<PaginatedGames> => {
  const { api, environment } = getChainData(props.chainId);
  const params = serializeParams({
    environment,
    gameState: props.state,
    sportHub: props.sportHub,
    sportId: props.sportIds,
    sportSlug: props.sportSlug,
    leagueSlug: props.leagueSlug,
    orderBy: props.orderBy ?? GameOrderBy.StartsAt,
    orderDirection: props.orderDir ?? OrderDirection.Asc,
    page: props.page ?? 1,
    perPage: props.perPage ?? 100,
  });

  return request<PaginatedGames>(`${api}/market-manager/games-by-filters?${params}`);
};

export const getGamesByIds = async (chainId: number, gameIds: string[]): Promise<GameData[]> => {
  if (!gameIds.length) {
    return [];
  }

  const { api, environment } = getChainData(chainId);
  const data = await postJson<{ games: GameData[] }>(`${api}/market-manager/games-by-ids`, {
    gameIds,
    environment,
  });

  return data.games ?? [];
};

const MIN_SEARCH_LENGTH = 3;

export const searchGames = async (
  chainId: number,
  query: string,
  page = 1,
  perPage = 10,
): Promise<PaginatedGames> => {
  const trimmed = query.trim();

  if (trimmed.length < MIN_SEARCH_LENGTH) {
    return { games: [], page: 1, perPage, total: 0, totalPages: 0 };
  }

  const { api, environment } = getChainData(chainId);
  const params = serializeParams({ environment, request: trimmed, page, perPage });

  return request<PaginatedGames>(`${api}/market-manager/search?${params}`);
};

// -- Conditions & markets -----------------------------------------------------------

/**
 * @param extended include "5..." conditions, which are managed by the API rather than
 *   the dictionaries package. Leave on — that is where most modern markets live.
 */
export const getConditionsByGameIds = async (
  chainId: number,
  gameIds: string[],
  extended = true,
): Promise<ConditionData[]> => {
  const ids = gameIds.filter(Boolean);

  if (!ids.length) {
    return [];
  }

  const { api, environment } = getChainData(chainId);
  const data = await postJson<{ conditions: ConditionData[] }>(
    `${api}/market-manager/conditions-by-game-ids`,
    { gameIds: ids, environment, extended },
  );

  return data.conditions ?? [];
};

/** Cheap poll for odds/state drift when a socket is unavailable. */
export const getConditionsState = async (
  chainId: number,
  conditionIds: string[],
): Promise<ConditionData[]> => {
  const ids = conditionIds.filter(Boolean);

  if (!ids.length) {
    return [];
  }

  const { api, environment } = getChainData(chainId);
  const data = await postJson<{ conditions: ConditionData[] }>(
    `${api}/market-manager/condition-batch`,
    { conditionIds: ids, environment },
  );

  return data.conditions ?? [];
};

export const getPredefinedCombo = async (
  chainId: number,
  gameId: string,
): Promise<ConditionData[]> => {
  const { api, environment } = getChainData(chainId);
  const params = serializeParams({ environment, gameId });
  const data = await request<{ conditions: ConditionData[] }>(
    `${api}/market-manager/predefined-combo?${params}`,
  );

  return data.conditions ?? [];
};

// -- Grouping -----------------------------------------------------------------------

const CATEGORY_ORDER: string[] = [
  "result",
  "winner",
  "handicap",
  "handicap_3_way",
  "total",
  "total_3_way",
  "yes_no",
  "odd_even",
  "correct_score",
  "participant_and_total",
  "participant_and_yes_no",
  "players",
];

/**
 * Fold raw conditions into the market groups a bettor expects to see — "Full Time
 * Result", "Total Goals 2.5", and so on. Conditions with the same title are variants of
 * one market (different lines), so they collapse into a single card with several rows.
 */
export const groupConditionsByMarket = (conditions: ConditionData[]): Market[] => {
  const markets = new Map<string, Market>();

  conditions
    .filter((condition) => !condition.hidden)
    .forEach((condition) => {
      const marketKey = condition.marketId
        ? `${condition.marketId}-${condition.marketVarietyId ?? "0"}`
        : condition.title;

      const outcomes: MarketOutcome[] = condition.outcomes
        .filter((outcome) => !outcome.hidden)
        .map((outcome) => ({
          conditionId: condition.conditionId,
          outcomeId: outcome.outcomeId,
          title: outcome.title,
          odds: Number(outcome.odds) / 1e12,
          state: outcome.state,
          hidden: outcome.hidden,
          point: outcome.point,
          isExpressForbidden: condition.isExpressForbidden,
          gameId: condition.game.gameId,
        }))
        .sort((a, b) => Number(a.point ?? 0) - Number(b.point ?? 0));

      if (!outcomes.length) {
        return;
      }

      const existing = markets.get(marketKey);
      const entry = {
        conditionId: condition.conditionId,
        state: condition.state,
        margin: condition.margin,
        isExpressForbidden: condition.isExpressForbidden,
        outcomes,
      };

      if (existing) {
        existing.conditions.push(entry);
        return;
      }

      markets.set(marketKey, {
        marketKey,
        name: condition.title,
        category: condition.category,
        conditions: [entry],
      });
    });

  return [...markets.values()].sort((a, b) => {
    const aIndex = CATEGORY_ORDER.indexOf(String(a.category));
    const bIndex = CATEGORY_ORDER.indexOf(String(b.category));

    if (aIndex !== bIndex) {
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    }

    return a.name.localeCompare(b.name);
  });
};

// -- Convenience --------------------------------------------------------------------

/**
 * Games across the whole book for a scope, in one call — the "All sports" landing page.
 * Ordered by turnover so the busiest markets surface first.
 */
export const getTopGames = (chainId: number, state: FeedScope, limit = 24) =>
  getGames({
    chainId,
    state,
    orderBy: GameOrderBy.Turnover,
    orderDir: OrderDirection.Desc,
    perPage: limit,
  });

export const getGamesForSportSlug = (chainId: number, slug: string, state: FeedScope) => {
  const sport = SPORT_BY_SLUG.get(slug);

  return getGames({
    chainId,
    state,
    sportSlug: slug,
    sportHub: sport ? getSportHub(sport.sportId) : undefined,
  });
};

export { AzuroFeedError };
