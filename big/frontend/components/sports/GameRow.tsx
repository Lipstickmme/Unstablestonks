"use client";

import Link from "next/link";

import { type GameData, GameState } from "@/lib/azuro";
import { getSportIcon } from "@/lib/sportIcons";

const formatKickoff = (startsAt: string): string => {
  const date = new Date(Number(startsAt) * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (isToday) {
    return `Today ${time}`;
  }

  return `${date.toLocaleDateString([], { day: "2-digit", month: "short" })} ${time}`;
};

export function GameRow({ game }: { game: GameData }) {
  const isLive = game.state === GameState.Live;
  const [home, away] = game.participants;

  return (
    <Link
      href={`/game/${game.gameId}`}
      className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white/50 px-4 py-3 transition-colors hover:border-orange-400 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-orange-500/60"
    >
      <span aria-hidden className="text-lg">
        {getSportIcon(game.sport.slug)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-neutral-500">
          <span className="truncate">
            {game.country.name} · {game.league.name}
          </span>
          {game.league.isTopLeague && <span className="text-amber-500">★</span>}
        </div>
        <div className="truncate text-sm font-medium">
          {home && away ? `${home.name} vs ${away.name}` : game.title}
        </div>
      </div>

      <div className="shrink-0 text-right">
        {isLive ? (
          <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            LIVE
          </span>
        ) : (
          <span className="text-xs text-gray-500 dark:text-neutral-400">
            {formatKickoff(game.startsAt)}
          </span>
        )}
      </div>
    </Link>
  );
}
