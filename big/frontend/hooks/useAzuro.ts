"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useChainId } from "wagmi";

import {
  type ConditionData,
  DEFAULT_CHAIN_ID,
  type FeedScope,
  type GameData,
  GameState,
  getBetCalculation,
  getConditionsByGameIds,
  getGames,
  getGamesByIds,
  getNavigation,
  getRelayerFee,
  getSports,
  getTopGames,
  groupConditionsByMarket,
  isAzuroChainId,
  type Market,
  type NavigationSport,
  type Selection,
  searchGames,
  type SportHubSlug,
  getAzuroSocket,
  getChainData,
} from "../lib/azuro";

/** The chain the book is pointed at: the wallet's, if Azuro is deployed there. */
export const useAzuroChainId = (): number => {
  const walletChainId = useChainId();

  return isAzuroChainId(walletChainId) ? walletChainId : DEFAULT_CHAIN_ID;
};

export const useBetToken = () => {
  const chainId = useAzuroChainId();

  return useMemo(() => getChainData(chainId).betToken, [chainId]);
};

/** Sport -> country -> league tree with live counts. Drives the whole sidebar. */
export const useNavigation = (sportHub?: SportHubSlug) => {
  const chainId = useAzuroChainId();

  return useQuery<NavigationSport[]>({
    queryKey: ["azuro", "navigation", chainId, sportHub ?? "all"],
    queryFn: () => getNavigation({ chainId, sportHub }),
    staleTime: 60_000,
  });
};

export type UseGamesParams = {
  state: FeedScope;
  sportHub?: SportHubSlug;
  sportSlug?: string;
  leagueSlug?: string;
  page?: number;
  perPage?: number;
};

export const useGames = (params: UseGamesParams) => {
  const chainId = useAzuroChainId();

  return useQuery({
    queryKey: ["azuro", "games", chainId, params],
    queryFn: () => getGames({ chainId, ...params }),
    // Live listings churn; prematch ones do not.
    staleTime: params.state === GameState.Live ? 5_000 : 30_000,
    refetchInterval: params.state === GameState.Live ? 15_000 : false,
  });
};

export const useTopGames = (state: FeedScope, limit = 24) => {
  const chainId = useAzuroChainId();

  return useQuery({
    queryKey: ["azuro", "top-games", chainId, state, limit],
    queryFn: () => getTopGames(chainId, state, limit),
    staleTime: 30_000,
  });
};

export const useSportTree = (state: FeedScope, sportSlug?: string) => {
  const chainId = useAzuroChainId();

  return useQuery({
    queryKey: ["azuro", "sport-tree", chainId, state, sportSlug ?? "all"],
    queryFn: () => getSports({ chainId, state, sportSlug, numberOfGames: 20 }),
    staleTime: 30_000,
  });
};

export const useGameSearch = (query: string) => {
  const chainId = useAzuroChainId();

  return useQuery({
    queryKey: ["azuro", "search", chainId, query],
    queryFn: () => searchGames(chainId, query),
    enabled: query.trim().length >= 3,
    staleTime: 15_000,
  });
};

export const useGame = (gameId: string | undefined) => {
  const chainId = useAzuroChainId();

  return useQuery<GameData | null>({
    queryKey: ["azuro", "game", chainId, gameId],
    queryFn: async () => {
      const games = await getGamesByIds(chainId, [gameId!]);

      return games[0] ?? null;
    },
    enabled: Boolean(gameId),
    staleTime: 15_000,
  });
};

/**
 * Markets for a game, kept live.
 *
 * The REST call seeds the board; the socket then patches individual conditions in place
 * so a price change never re-renders the whole card or drops the bettor's scroll position.
 */
export const useGameMarkets = (gameId: string | undefined, isLive = false) => {
  const chainId = useAzuroChainId();
  const [liveConditions, setLiveConditions] = useState<Record<string, ConditionData>>({});

  const query = useQuery<ConditionData[]>({
    queryKey: ["azuro", "conditions", chainId, gameId],
    queryFn: () => getConditionsByGameIds(chainId, [gameId!]),
    enabled: Boolean(gameId),
    staleTime: isLive ? 5_000 : 30_000,
  });

  const conditionIds = useMemo(
    () => (query.data ?? []).map((condition) => condition.conditionId),
    [query.data],
  );

  useEffect(() => {
    if (!conditionIds.length) {
      return;
    }

    const socket = getAzuroSocket(chainId);

    return socket.subscribeConditions(conditionIds, (condition) => {
      setLiveConditions((current) => ({ ...current, [condition.conditionId]: condition }));
    });
  }, [chainId, conditionIds]);

  const markets: Market[] = useMemo(() => {
    const merged = (query.data ?? []).map(
      (condition) => liveConditions[condition.conditionId] ?? condition,
    );

    return groupConditionsByMarket(merged);
  }, [query.data, liveConditions]);

  return { ...query, markets };
};

/** Stake limits for the current selections, refreshed as the betslip changes. */
export const useBetLimits = (selections: Selection[]) => {
  const chainId = useAzuroChainId();
  const { address } = useAccount();

  return useQuery({
    queryKey: [
      "azuro",
      "bet-limits",
      chainId,
      address,
      selections.map((s) => `${s.conditionId}-${s.outcomeId}`).join(","),
    ],
    queryFn: () => getBetCalculation(chainId, selections, address),
    enabled: selections.length > 0,
    staleTime: 10_000,
  });
};

/** Relayer gas cost the bettor covers. Shown in the betslip before they sign. */
export const useRelayerFee = () => {
  const chainId = useAzuroChainId();

  return useQuery({
    queryKey: ["azuro", "relayer-fee", chainId],
    queryFn: () => getRelayerFee(chainId),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
};

/** Live game clock and score updates for a set of games. */
export const useLiveGames = (gameIds: string[]) => {
  const chainId = useAzuroChainId();
  const [updates, setUpdates] = useState<Record<string, GameData>>({});

  const key = gameIds.join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];

    if (!ids.length) {
      return;
    }

    const socket = getAzuroSocket(chainId);

    return socket.subscribeGames(ids, (game) => {
      setUpdates((current) => ({ ...current, [game.gameId]: game }));
    });
  }, [chainId, key]);

  return useCallback((game: GameData) => updates[game.gameId] ?? game, [updates]);
};
