"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import {
  canPlay,
  checkLimits,
  effectiveLimit,
  evaluateSession,
  exclusionEndsIn,
  isExcluded,
  type LimitKind,
  type LimitPeriod,
  loadState,
  recordActivity,
  type ResponsibleGamblingState,
  saveState,
  selfExclude,
  setLimit as applyLimit,
  startCoolOff,
  usageInPeriod,
} from "@/lib/platform/responsible";

const EMPTY: ResponsibleGamblingState = {
  limits: [],
  session: { maxSessionMinutes: 0, realityCheckMinutes: 60 },
  exclusion: null,
  activity: [],
};

/**
 * Responsible-gambling state for the connected wallet.
 *
 * Limits are keyed to the address. That is the only identity this app has, and it is a
 * weaker binding than a licensed operator needs — a new wallet is a new profile. The page
 * says so, and `setResponsibleGamblingStore` is the seam for backing this with a real
 * account.
 */
export const useResponsibleGambling = () => {
  const { address } = useAccount();
  const accountKey = address?.toLowerCase() ?? "anonymous";

  const [state, setState] = useState<ResponsibleGamblingState>(EMPTY);
  const [sessionStartedAt] = useState(() => Date.now());
  const [lastRealityCheckAt, setLastRealityCheckAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setState(loadState(accountKey));
  }, [accountKey]);

  // A slow tick is enough: reality checks and exclusions are measured in minutes.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);

    return () => clearInterval(timer);
  }, []);

  const update = useCallback(
    (next: ResponsibleGamblingState) => {
      setState(next);
      saveState(accountKey, next);
    },
    [accountKey],
  );

  const session = useMemo(
    () => evaluateSession(state, sessionStartedAt, lastRealityCheckAt, now),
    [state, sessionStartedAt, lastRealityCheckAt, now],
  );

  const gate = useMemo(() => canPlay(state, now), [state, now]);

  return {
    state,
    excluded: isExcluded(state, now),
    exclusionEndsIn: exclusionEndsIn(state, now),
    gate,
    session,
    acknowledgeRealityCheck: () => setLastRealityCheckAt(Date.now()),

    limitFor: (kind: LimitKind, period: LimitPeriod) => {
      const limit = state.limits.find(
        (entry) => entry.kind === kind && entry.period === period,
      );

      return limit ? effectiveLimit(limit, now) : null;
    },
    pendingFor: (kind: LimitKind, period: LimitPeriod) => {
      const limit = state.limits.find(
        (entry) => entry.kind === kind && entry.period === period,
      );

      return limit?.effectiveFrom && now < limit.effectiveFrom
        ? { amount: limit.amount, at: limit.effectiveFrom }
        : null;
    },
    usage: (kind: LimitKind, period: LimitPeriod) => usageInPeriod(state, kind, period, now),

    setLimit: (kind: LimitKind, period: LimitPeriod, amount: number) =>
      update(applyLimit(state, kind, period, amount, now)),
    setSessionLimit: (maxSessionMinutes: number, realityCheckMinutes: number) =>
      update({ ...state, session: { maxSessionMinutes, realityCheckMinutes } }),
    coolOff: (durationMs: number) => update(startCoolOff(state, durationMs, now)),
    exclude: (durationMs: number | null) => update(selfExclude(state, durationMs, now)),

    /** Call before taking a stake or a deposit. */
    check: (kind: LimitKind, amount: number) => checkLimits(state, kind, amount, now),
    /** Call after one succeeds. */
    record: (kind: LimitKind, amount: number) =>
      update(recordActivity(state, kind, amount, Date.now())),
  };
};
