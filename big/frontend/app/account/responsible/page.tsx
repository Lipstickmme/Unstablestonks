"use client";

import { useState } from "react";
import { useAccount } from "wagmi";

import { useResponsibleGambling } from "@/hooks/useResponsibleGambling";
import { useBetToken } from "@/hooks/useAzuro";
import {
  LIMIT_LOOSENING_DELAY_MS,
  type LimitKind,
  type LimitPeriod,
  SUPPORT_RESOURCES,
} from "@/lib/platform/responsible";

const LIMIT_KINDS: { kind: LimitKind; label: string; help: string }[] = [
  { kind: "deposit", label: "Deposit", help: "Caps how much you can fund the account with." },
  { kind: "loss", label: "Net loss", help: "Stops play once losses reach this figure." },
  { kind: "wager", label: "Wager", help: "Caps total turnover, win or lose." },
];

const PERIODS: LimitPeriod[] = ["daily", "weekly", "monthly"];

const DURATIONS = [
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "6 months", ms: 182 * 24 * 60 * 60 * 1000 },
];

export default function ResponsibleGamblingPage() {
  const { isConnected } = useAccount();
  const betToken = useBetToken();
  const rg = useResponsibleGambling();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmExclusion, setConfirmExclusion] = useState(false);

  const key = (kind: LimitKind, period: LimitPeriod) => `${kind}:${period}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold">Responsible gambling</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
        Set your own limits. Tighter limits apply straight away; looser ones take{" "}
        {LIMIT_LOOSENING_DELAY_MS / 3_600_000} hours to take effect.
      </p>

      {!isConnected && (
        <p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
          Connect a wallet to set limits — they are stored against your address.
        </p>
      )}

      {rg.excluded && (
        <div className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 p-5">
          <h2 className="font-semibold text-red-500">
            {rg.state.exclusion?.kind === "self-exclusion"
              ? "You are self-excluded"
              : "You are on a cool-off"}
          </h2>
          <p className="mt-1 text-sm text-red-500/90">
            {rg.exclusionEndsIn === null
              ? "This exclusion is permanent and cannot be lifted here."
              : `Ends in ${Math.ceil(rg.exclusionEndsIn / 3_600_000)} hours. It cannot be lifted early.`}
          </p>
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Limits ({betToken.symbol})</h2>

        <div className="space-y-4">
          {LIMIT_KINDS.map(({ kind, label, help }) => (
            <div
              key={kind}
              className="rounded-xl border border-gray-200 p-4 dark:border-white/10"
            >
              <p className="text-sm font-medium">{label}</p>
              <p className="mb-3 text-xs text-gray-500 dark:text-neutral-400">{help}</p>

              <div className="grid gap-3 sm:grid-cols-3">
                {PERIODS.map((period) => {
                  const current = rg.limitFor(kind, period);
                  const pending = rg.pendingFor(kind, period);
                  const used = rg.usage(kind, period);

                  return (
                    <div key={period}>
                      <label className="mb-1 block text-xs capitalize text-gray-500 dark:text-neutral-400">
                        {period}
                      </label>
                      <div className="flex gap-1">
                        <input
                          inputMode="decimal"
                          placeholder={current !== null ? String(current) : "None"}
                          value={draft[key(kind, period)] ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [key(kind, period)]: event.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1.5 text-sm dark:border-white/10"
                        />
                        <button
                          type="button"
                          disabled={!isConnected || !Number(draft[key(kind, period)])}
                          onClick={() => {
                            rg.setLimit(kind, period, Number(draft[key(kind, period)]));
                            setDraft((current) => ({ ...current, [key(kind, period)]: "" }));
                          }}
                          className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          Set
                        </button>
                      </div>

                      {current !== null && (
                        <p className="mt-1 text-[11px] text-gray-500 dark:text-neutral-400">
                          {used.toFixed(2)} of {current} used
                        </p>
                      )}
                      {pending && (
                        <p className="mt-1 text-[11px] text-amber-500">
                          Rising to {pending.amount} on{" "}
                          {new Date(pending.at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 p-4 dark:border-white/10">
        <h2 className="mb-3 text-sm font-semibold">Session</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-gray-500 dark:text-neutral-400">
              End session after (minutes, 0 = off)
            </span>
            <input
              inputMode="numeric"
              defaultValue={rg.state.session.maxSessionMinutes}
              onBlur={(event) =>
                rg.setSessionLimit(
                  Number(event.target.value) || 0,
                  rg.state.session.realityCheckMinutes,
                )
              }
              className="w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1.5 text-sm dark:border-white/10"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-500 dark:text-neutral-400">
              Reality check every (minutes, 0 = off)
            </span>
            <input
              inputMode="numeric"
              defaultValue={rg.state.session.realityCheckMinutes}
              onBlur={(event) =>
                rg.setSessionLimit(
                  rg.state.session.maxSessionMinutes,
                  Number(event.target.value) || 0,
                )
              }
              className="w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1.5 text-sm dark:border-white/10"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-neutral-400">
          You have been playing for {Math.floor(rg.session.minutesPlayed)} minutes.
        </p>
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">Take a break</h2>
        <p className="mb-3 mt-1 text-xs text-gray-500 dark:text-neutral-400">
          A cool-off pauses play for a fixed period. Self-exclusion is longer and cannot be
          reversed before it ends.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          {DURATIONS.slice(0, 3).map((duration) => (
            <button
              key={duration.label}
              type="button"
              disabled={!isConnected || rg.excluded}
              onClick={() => rg.coolOff(duration.ms)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-white/10"
            >
              Cool off {duration.label}
            </button>
          ))}
        </div>

        {!confirmExclusion ? (
          <button
            type="button"
            disabled={!isConnected || rg.excluded}
            onClick={() => setConfirmExclusion(true)}
            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-500 disabled:opacity-40"
          >
            Self-exclude…
          </button>
        ) : (
          <div className="rounded-lg border border-red-500/40 p-3">
            <p className="mb-2 text-xs text-red-500">
              This cannot be undone before it expires. Choose a period:
            </p>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.slice(2).map((duration) => (
                <button
                  key={duration.label}
                  type="button"
                  onClick={() => rg.exclude(duration.ms)}
                  className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {duration.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => rg.exclude(null)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Permanently
              </button>
              <button
                type="button"
                onClick={() => setConfirmExclusion(false)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs dark:border-white/10"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 p-4 text-sm dark:border-white/10">
        <h2 className="mb-2 font-semibold">Getting help</h2>
        <ul className="space-y-1 text-xs">
          {SUPPORT_RESOURCES.map((resource) => (
            <li key={resource.label}>
              <a
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-500 hover:underline"
              >
                {resource.label}
              </a>
              {resource.phone && (
                <span className="text-gray-500 dark:text-neutral-400"> · {resource.phone}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 text-xs text-gray-400">
        These controls are stored in your browser against your wallet address. That is a
        real limit on how strong they can be — connecting a different wallet or clearing
        site data starts a fresh profile. A licensed deployment must move this to a
        server-side store keyed to a verified identity.
      </p>
    </main>
  );
}
