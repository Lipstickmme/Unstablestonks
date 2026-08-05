"use client";

import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

import { Betslip } from "@/components/betslip/Betslip";
import { GameRow } from "@/components/sports/GameRow";
import { SportsSidebar } from "@/components/sports/SportsSidebar";
import { useGames } from "@/hooks/useAzuro";
import { type GameData, GameState, SPORT_BY_SLUG } from "@/lib/azuro";
import { getSportIcon } from "@/lib/sportIcons";

export default function SportPage() {
  const params = useParams<{ sport: string }>();
  const searchParams = useSearchParams();
  const sportSlug = params.sport;
  const leagueSlug = searchParams.get("league") ?? undefined;
  const [tab, setTab] = useState<GameState.Live | GameState.Prematch>(GameState.Prematch);

  const sport = SPORT_BY_SLUG.get(sportSlug);
  const { data, isLoading } = useGames({
    state: tab,
    sportSlug,
    leagueSlug,
    perPage: 100,
  });

  // Group by league so a sport page reads like a coupon rather than a flat list.
  const byLeague = useMemo(() => {
    const games = data?.games ?? [];
    const groups = new Map<string, { name: string; country: string; games: GameData[] }>();

    games.forEach((game) => {
      const key = `${game.country.slug}/${game.league.slug}`;
      const existing = groups.get(key);

      if (existing) {
        existing.games.push(game);
        return;
      }

      groups.set(key, {
        name: game.league.name,
        country: game.country.name,
        games: [game],
      });
    });

    return [...groups.values()];
  }, [data]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 lg:px-6">
      <div className="mb-6 flex items-center gap-3">
        <span aria-hidden className="text-3xl">
          {getSportIcon(sportSlug)}
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{sport?.name ?? sportSlug}</h1>
          <p className="text-sm text-gray-500 dark:text-neutral-400">
            {leagueSlug ? `League: ${leagueSlug}` : `${data?.total ?? 0} events`}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <SportsSidebar />

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex rounded-lg border border-gray-200 p-1 dark:border-white/10 sm:w-fit">
            {([GameState.Prematch, GameState.Live] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTab(option)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  tab === option
                    ? "bg-orange-500 text-white"
                    : "text-gray-600 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-white/5"
                }`}
              >
                {option === GameState.Live ? "Live" : "Upcoming"}
              </button>
            ))}
          </div>

          {isLoading && (
            <div className="space-y-2" aria-busy>
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5"
                />
              ))}
            </div>
          )}

          {!isLoading && !byLeague.length && (
            <p className="rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-white/10 dark:text-neutral-400">
              No {tab === GameState.Live ? "in-play" : "upcoming"} events for this sport.
            </p>
          )}

          <div className="space-y-6">
            {byLeague.map((league) => (
              <section key={`${league.country}-${league.name}`}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400">
                  {league.country} · {league.name}
                </h2>
                <div className="space-y-2">
                  {league.games.map((game) => (
                    <GameRow key={game.gameId} game={game} />
                  ))}
                </div>
              </section>
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
