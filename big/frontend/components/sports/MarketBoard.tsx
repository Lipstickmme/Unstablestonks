"use client";

import { useState } from "react";

import { useBetslip } from "@/lib/betslip";
import {
  calcMargin,
  ConditionState,
  type GameData,
  type Market,
  OutcomeState,
} from "@/lib/azuro";

import { OddsButton } from "./OddsButton";

type Props = {
  game: GameData;
  markets: Market[];
  isLoading: boolean;
};

/**
 * Every market the protocol is quoting for a game, grouped into cards. Conditions that
 * are variants of one market (different handicap lines, different totals) share a card
 * and render as separate rows.
 */
export function MarketBoard({ game, markets, isLoading }: Props) {
  const betslip = useBetslip();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = (marketKey: string) => {
    setCollapsed((current) => {
      const next = new Set(current);

      if (next.has(marketKey)) {
        next.delete(marketKey);
      } else {
        next.add(marketKey);
      }

      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy>
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5"
          />
        ))}
      </div>
    );
  }

  if (!markets.length) {
    return (
      <p className="rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-white/10 dark:text-neutral-400">
        No markets are open for this event yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {markets.map((market) => {
        const isCollapsed = collapsed.has(market.marketKey);
        const allOdds = market.conditions.flatMap((condition) =>
          condition.outcomes.map((outcome) => outcome.odds),
        );
        const margin = calcMargin(allOdds);

        return (
          <section
            key={market.marketKey}
            className="rounded-xl border border-gray-200 dark:border-white/10"
          >
            <button
              type="button"
              onClick={() => toggleCollapse(market.marketKey)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold">{market.name}</span>
              <span className="flex items-center gap-3 text-xs text-gray-400">
                {/* Margin over 1 leg is meaningless, so only show it for a real book. */}
                {allOdds.length > 1 && <span>{(margin * 100).toFixed(1)}% margin</span>}
                <span>{isCollapsed ? "▸" : "▾"}</span>
              </span>
            </button>

            {!isCollapsed && (
              <div className="space-y-2 px-4 pb-4">
                {market.conditions.map((condition) => {
                  const stopped = condition.state !== ConditionState.Active;

                  return (
                    <div
                      key={condition.conditionId}
                      className={`flex flex-wrap gap-2 ${stopped ? "opacity-50" : ""}`}
                    >
                      {condition.outcomes.map((outcome) => (
                        <OddsButton
                          key={`${outcome.conditionId}-${outcome.outcomeId}`}
                          label={outcome.title}
                          odds={outcome.odds}
                          state={stopped ? OutcomeState.Stopped : outcome.state}
                          selected={betslip.has(outcome.conditionId, outcome.outcomeId)}
                          onClick={() =>
                            betslip.toggle({
                              conditionId: outcome.conditionId,
                              outcomeId: outcome.outcomeId,
                              odds: outcome.odds,
                              outcomeTitle: outcome.title,
                              marketTitle: market.name,
                              gameId: game.gameId,
                              gameTitle: game.title,
                              sportId: game.sport.sportId,
                              sportSlug: game.sport.slug,
                              leagueSlug: game.league.slug,
                              leagueName: game.league.name,
                              startsAt: game.startsAt,
                              gameState: game.state,
                              isExpressForbidden: outcome.isExpressForbidden,
                            })
                          }
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
