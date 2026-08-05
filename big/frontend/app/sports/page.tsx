"use client";

import { useMemo, useState } from "react";

import { Betslip } from "@/components/betslip/Betslip";
import { GameRow } from "@/components/sports/GameRow";
import { SportsSidebar } from "@/components/sports/SportsSidebar";
import { useGameSearch, useGames, useTopGames } from "@/hooks/useAzuro";
import { GameState } from "@/lib/azuro";

type Tab = "live" | "upcoming";

export default function SportsbookPage() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [search, setSearch] = useState("");

  const scope = tab === "live" ? GameState.Live : GameState.Prematch;
  const top = useTopGames(scope, 40);
  const upcoming = useGames({ state: GameState.Prematch, perPage: 40 });
  const results = useGameSearch(search);

  const games = useMemo(() => {
    if (search.trim().length >= 3) {
      return results.data?.games ?? [];
    }

    return (tab === "live" ? top.data?.games : upcoming.data?.games) ?? [];
  }, [search, results.data, tab, top.data, upcoming.data]);

  const isLoading = search.trim().length >= 3 ? results.isLoading : top.isLoading || upcoming.isLoading;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 lg:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Sportsbook</h1>
        <p className="text-sm text-gray-500 dark:text-neutral-400">
          Live odds from the Azuro protocol across every sport and esport it carries.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <SportsSidebar />

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex rounded-lg border border-gray-200 p-1 dark:border-white/10">
              {(["upcoming", "live"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTab(option)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                    tab === option
                      ? "bg-orange-500 text-white"
                      : "text-gray-600 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-white/5"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>

            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search teams, leagues, countries…"
              className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-white/10 sm:max-w-xs"
            />
          </div>

          {isLoading && (
            <div className="space-y-2" aria-busy>
              {Array.from({ length: 10 }).map((_, index) => (
                <div
                  key={index}
                  className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5"
                />
              ))}
            </div>
          )}

          {!isLoading && !games.length && (
            <p className="rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-white/10 dark:text-neutral-400">
              {search.trim().length >= 3
                ? `Nothing matched "${search}".`
                : tab === "live"
                  ? "No events are in play right now."
                  : "No upcoming events on this network."}
            </p>
          )}

          <div className="space-y-2">
            {games.map((game) => (
              <GameRow key={game.gameId} game={game} />
            ))}
          </div>
        </div>

        <div className="w-full shrink-0 lg:w-80">
          <div className="lg:sticky lg:top-24">
            <Betslip />
          </div>
        </div>
      </div>
    </main>
  );
}
