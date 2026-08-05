"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatEther } from "viem";
import { useAccount } from "wagmi";

import { LaunchChart } from "@/components/crash/LaunchChart";
import { useRugRush } from "@/hooks/useRugRush";
import { firedEvents, RoundState } from "@/lib/games/crash/engine";
import { expectedValue, houseEdge } from "@/lib/games/crash/fairness";

const QUICK_TARGETS = [1.5, 2, 3, 5, 10];

export default function RugRushPage() {
  const { isConnected } = useAccount();
  const {
    configured,
    round,
    token,
    phase,
    position,
    outcome,
    bankroll,
    minStake,
    maxPayout,
    isWriting,
    buyIn,
    sell,
    settle,
  } = useRugRush();

  const [stake, setStake] = useState("0.01");
  const [autoSell, setAutoSell] = useState<number | undefined>(2);
  const [error, setError] = useState<string | null>(null);

  const multiplier = phase.kind === "running" ? phase.multiplier : 1;
  const elapsedMs = phase.kind === "running" ? phase.elapsedMs : 0;
  const rug = phase.kind === "rugged" ? phase.rug : undefined;

  const events = useMemo(
    () => (token ? firedEvents(token, rug ?? multiplier) : []),
    [token, multiplier, rug],
  );

  const run = async (action: () => Promise<void>) => {
    setError(null);

    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transaction failed");
    }
  };

  if (!configured) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center lg:px-6">
        <h1 className="text-2xl font-semibold">RugRush</h1>
        <p className="mt-3 text-sm text-gray-500 dark:text-neutral-400">
          The game contract has not been deployed on this environment yet. Set{" "}
          <code className="rounded bg-gray-100 px-1 dark:bg-white/10">
            NEXT_PUBLIC_RUGRUSH_ADDRESS
          </code>{" "}
          after running <code>npm run deploy:rugrush</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">RugRush</h1>
        <p className="text-sm text-gray-500 dark:text-neutral-400">
          Every round launches a token. Buy in before it opens, sell before it rugs.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="space-y-4">
          <div className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
            {token ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span aria-hidden className="text-2xl">
                    {token.emoji}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{token.name}</p>
                    <p className="text-xs text-gray-500 dark:text-neutral-400">
                      {token.ticker} · supply {Number(token.supply).toLocaleString()}
                    </p>
                  </div>
                  <div className="ml-auto flex flex-wrap gap-1">
                    {token.badges.map((badge) => (
                      <span
                        key={badge}
                        className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:border-white/10 dark:text-neutral-400"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                </div>

                <LaunchChart
                  token={token}
                  elapsedMs={elapsedMs}
                  multiplier={multiplier}
                  rug={rug}
                  autoSell={
                    position && position.autoSellX18 > 0n
                      ? Number(position.autoSellX18) / 1e18
                      : undefined
                  }
                  soldAt={
                    position && position.soldAtX18 > 0n
                      ? Number(position.soldAtX18) / 1e18
                      : undefined
                  }
                />

                <p className="mt-2 text-center text-[11px] text-gray-400">
                  Badges and launch events are flavour derived from the round&apos;s public
                  commit hash. They carry no information about where the rug lands.
                </p>
              </>
            ) : (
              <div className="flex h-72 items-center justify-center text-sm text-gray-500 dark:text-neutral-400">
                Waiting for the next round…
              </div>
            )}
          </div>

          {events.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-gray-200 p-3 text-xs dark:border-white/10">
              {events.map((event, index) => (
                <li key={`${event.label}-${index}`} className="flex items-center gap-2">
                  <span className="tabular-nums text-gray-400">
                    {event.at.toFixed(2)}×
                  </span>
                  <span
                    className={
                      event.tone === "good"
                        ? "text-emerald-500"
                        : event.tone === "bad"
                          ? "text-red-500"
                          : "text-gray-500 dark:text-neutral-400"
                    }
                  >
                    {event.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
            <h2 className="mb-3 text-sm font-semibold">
              {phase.kind === "betting"
                ? "Buy in"
                : phase.kind === "running"
                  ? "In flight"
                  : "Round closed"}
            </h2>

            <label className="mb-1 block text-xs text-gray-500 dark:text-neutral-400">
              Stake
            </label>
            <input
              inputMode="decimal"
              value={stake}
              onChange={(event) => setStake(event.target.value)}
              disabled={phase.kind !== "betting"}
              className="mb-3 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-white/10"
            />

            <label className="mb-1 block text-xs text-gray-500 dark:text-neutral-400">
              Auto-sell at
            </label>
            <div className="mb-2 flex flex-wrap gap-1">
              {QUICK_TARGETS.map((target) => (
                <button
                  key={target}
                  type="button"
                  disabled={phase.kind !== "betting"}
                  onClick={() => setAutoSell(target)}
                  className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
                    autoSell === target
                      ? "border-orange-500 bg-orange-500/15 text-orange-600 dark:text-orange-300"
                      : "border-gray-200 dark:border-white/10"
                  }`}
                >
                  {target}×
                </button>
              ))}
              <button
                type="button"
                disabled={phase.kind !== "betting"}
                onClick={() => setAutoSell(undefined)}
                className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
                  autoSell === undefined
                    ? "border-orange-500 bg-orange-500/15 text-orange-600 dark:text-orange-300"
                    : "border-gray-200 dark:border-white/10"
                }`}
              >
                Manual
              </button>
            </div>

            {autoSell !== undefined && (
              <p className="mb-3 text-[11px] text-gray-400">
                Return at target: {(Number(stake) * autoSell || 0).toFixed(4)} · expected
                value {expectedValue(autoSell).toFixed(4)} per unit staked
              </p>
            )}

            {!isConnected && (
              <p className="mb-2 text-xs text-amber-500">Connect a wallet to play.</p>
            )}

            {error && <p className="mb-2 break-words text-xs text-red-500">{error}</p>}

            {phase.kind === "betting" && !position && (
              <button
                type="button"
                disabled={!isConnected || isWriting}
                onClick={() => run(() => buyIn(stake, autoSell))}
                className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {isWriting ? "Confirming…" : "Buy in"}
              </button>
            )}

            {phase.kind === "running" && outcome.kind === "holding" && (
              <button
                type="button"
                disabled={isWriting}
                onClick={() => run(() => sell())}
                className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {isWriting ? "Selling…" : `Sell at ${multiplier.toFixed(2)}×`}
              </button>
            )}

            {(outcome.kind === "won" ||
              outcome.kind === "rugged" ||
              outcome.kind === "refundable") &&
              position &&
              !position.settled && (
                <button
                  type="button"
                  disabled={isWriting}
                  onClick={() => run(() => settle())}
                  className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {outcome.kind === "won"
                    ? `Claim ${formatEther(outcome.payout)}`
                    : outcome.kind === "refundable"
                      ? "Claim refund"
                      : "Close position"}
                </button>
              )}

            {outcome.kind === "sold" && (
              <p className="rounded-lg bg-emerald-500/10 p-3 text-center text-xs text-emerald-500">
                Sold at {outcome.at.toFixed(2)}× — settles when the seed is revealed.
              </p>
            )}

            {outcome.kind === "auto-armed" && (
              <p className="rounded-lg bg-amber-500/10 p-3 text-center text-xs text-amber-500">
                Auto-sell armed at {outcome.target.toFixed(2)}×.
              </p>
            )}
          </div>

          <div className="space-y-1 rounded-xl border border-gray-200 p-4 text-xs text-gray-500 dark:border-white/10 dark:text-neutral-400">
            <div className="flex justify-between">
              <span>Round</span>
              <span className="tabular-nums">
                #{round?.roundId?.toString() ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Staked this round</span>
              <span className="tabular-nums">
                {round ? formatEther(round.totalStaked) : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Bankroll</span>
              <span className="tabular-nums">{formatEther(bankroll)}</span>
            </div>
            <div className="flex justify-between">
              <span>Min stake</span>
              <span className="tabular-nums">{formatEther(minStake)}</span>
            </div>
            <div className="flex justify-between">
              <span>Max win</span>
              <span className="tabular-nums">{formatEther(maxPayout)}</span>
            </div>
            <div className="flex justify-between">
              <span>House edge</span>
              <span className="tabular-nums">{(houseEdge() * 100).toFixed(2)}%</span>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 p-4 text-xs dark:border-white/10">
            <p className="mb-2 font-semibold">Provably fair</p>
            <p className="text-gray-500 dark:text-neutral-400">
              The rug point is fixed by a seed committed on-chain before betting opens.
            </p>
            <p className="mt-2 break-all font-mono text-[10px] text-gray-400">
              commit {round?.serverSeedHash?.slice(0, 22)}…
            </p>
            {round?.state === RoundState.Revealed && (
              <p className="mt-1 break-all font-mono text-[10px] text-gray-400">
                seed {round.serverSeed.slice(0, 22)}…
              </p>
            )}
            <Link
              href="/fairness"
              className="mt-3 inline-block text-orange-500 hover:underline"
            >
              Verify a round →
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
