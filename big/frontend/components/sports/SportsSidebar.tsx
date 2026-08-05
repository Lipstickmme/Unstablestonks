"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useNavigation } from "@/hooks/useAzuro";
import { SPORT_ICONS } from "@/lib/sportIcons";
import type { SportHubSlug } from "@/lib/azuro";

/**
 * Sport navigation, built entirely from the protocol feed.
 *
 * Nothing here is hard-coded to football: the sidebar lists whatever sports currently have
 * open markets, split into Azuro's two hubs (traditional sports and esports), with live
 * counts so a bettor can find an in-play market straight away.
 */
export function SportsSidebar() {
  const pathname = usePathname();
  const [hub, setHub] = useState<SportHubSlug>("sports");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: sports, isLoading } = useNavigation(hub);

  const sorted = useMemo(
    () =>
      [...(sports ?? [])].sort((a, b) => {
        // In-play first, then by how much is open.
        if (a.activeLiveGamesCount !== b.activeLiveGamesCount) {
          return b.activeLiveGamesCount - a.activeLiveGamesCount;
        }

        return b.activeGamesCount - a.activeGamesCount;
      }),
    [sports],
  );

  return (
    <aside className="w-full shrink-0 lg:w-64">
      <div className="mb-3 flex rounded-lg border border-gray-200 p-1 dark:border-white/10">
        {(["sports", "esports"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setHub(option)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              hub === option
                ? "bg-orange-500 text-white"
                : "text-gray-600 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-white/5"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-2" aria-busy>
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="h-9 animate-pulse rounded-lg bg-gray-100 dark:bg-white/5"
            />
          ))}
        </div>
      )}

      {!isLoading && !sorted.length && (
        <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-500 dark:border-white/10 dark:text-neutral-400">
          No open markets on this network right now.
        </p>
      )}

      <nav className="space-y-1">
        {sorted.map((sport) => {
          const href = `/sports/${sport.slug}`;
          const isActive = pathname === href;
          const isOpen = expanded === sport.slug;

          return (
            <div key={sport.slug}>
              <div
                className={`flex items-center gap-1 rounded-lg ${
                  isActive ? "bg-orange-500/15" : "hover:bg-gray-100 dark:hover:bg-white/5"
                }`}
              >
                <Link
                  href={href}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-sm"
                >
                  <span aria-hidden className="w-5 text-center">
                    {SPORT_ICONS[sport.slug] ?? "•"}
                  </span>
                  <span className="truncate">{sport.name}</span>
                  {sport.activeLiveGamesCount > 0 && (
                    <span className="ml-auto flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-500">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                      {sport.activeLiveGamesCount}
                    </span>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : sport.slug)}
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${sport.name} leagues`}
                  aria-expanded={isOpen}
                  className="px-2 py-2 text-xs text-gray-400"
                >
                  {isOpen ? "▾" : "▸"}
                </button>
              </div>

              {isOpen && (
                <ul className="ml-6 mt-1 space-y-0.5 border-l border-gray-200 pl-3 dark:border-white/10">
                  {sport.countries.flatMap((country) =>
                    country.leagues
                      .filter((league) => league.activeGamesCount > 0)
                      .slice(0, 12)
                      .map((league) => (
                        <li key={`${country.slug}-${league.slug}`}>
                          <Link
                            href={`/sports/${sport.slug}?league=${league.slug}`}
                            className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs text-gray-600 hover:text-orange-500 dark:text-neutral-400"
                          >
                            <span className="truncate">
                              {league.isTopLeague && "★ "}
                              {league.name}
                            </span>
                            <span className="tabular-nums text-gray-400">
                              {league.activeGamesCount}
                            </span>
                          </Link>
                        </li>
                      )),
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
