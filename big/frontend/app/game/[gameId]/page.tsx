"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Betslip } from "@/components/betslip/Betslip";
import { MarketBoard } from "@/components/sports/MarketBoard";
import { useGame, useGameMarkets } from "@/hooks/useAzuro";
import { useBetslip } from "@/lib/betslip";
import { GameState } from "@/lib/azuro";
import { getSportIcon } from "@/lib/sportIcons";

export default function GamePage() {
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId;
  const { data: game, isLoading: gameLoading } = useGame(gameId);
  const isLive = game?.state === GameState.Live;
  const { markets, isLoading: marketsLoading } = useGameMarkets(gameId, isLive);
  const { has, updateOdds } = useBetslip();

  // Keep any selection the bettor already has in the slip priced at the live number.
  // `updateOdds` no-ops when the price is unchanged, so this settles immediately.
  useEffect(() => {
    markets.forEach((market) => {
      market.conditions.forEach((condition) => {
        condition.outcomes.forEach((outcome) => {
          if (has(outcome.conditionId, outcome.outcomeId)) {
            updateOdds(outcome.conditionId, outcome.outcomeId, outcome.odds);
          }
        });
      });
    });
  }, [markets, has, updateOdds]);

  if (gameLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-6 lg:px-6">
        <div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" />
      </main>
    );
  }

  if (!game) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-16 text-center lg:px-6">
        <p className="text-sm text-gray-500 dark:text-neutral-400">
          That event is no longer in the feed.
        </p>
        <Link href="/sports" className="mt-4 inline-block text-sm text-orange-500">
          Back to the sportsbook
        </Link>
      </main>
    );
  }

  const [home, away] = game.participants;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 lg:px-6">
      <nav className="mb-4 flex items-center gap-1 text-xs text-gray-500 dark:text-neutral-400">
        <Link href="/sports" className="hover:text-orange-500">
          Sports
        </Link>
        <span>/</span>
        <Link href={`/sports/${game.sport.slug}`} className="hover:text-orange-500">
          {game.sport.name}
        </Link>
        <span>/</span>
        <span className="truncate">{game.league.name}</span>
      </nav>

      <header className="mb-6 rounded-xl border border-gray-200 p-5 dark:border-white/10">
        <div className="mb-3 flex items-center gap-2 text-xs text-gray-500 dark:text-neutral-400">
          <span aria-hidden>{getSportIcon(game.sport.slug)}</span>
          <span>
            {game.country.name} · {game.league.name}
          </span>
          {game.state === GameState.Live && (
            <span className="ml-auto inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 font-semibold text-red-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              LIVE
            </span>
          )}
        </div>

        <h1 className="text-xl font-semibold sm:text-2xl">
          {home && away ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{home.name}</span>
              <span className="text-gray-400">vs</span>
              <span>{away.name}</span>
            </span>
          ) : (
            game.title
          )}
        </h1>

        <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
          {new Date(Number(game.startsAt) * 1000).toLocaleString()}
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <MarketBoard game={game} markets={markets} isLoading={marketsLoading} />
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
