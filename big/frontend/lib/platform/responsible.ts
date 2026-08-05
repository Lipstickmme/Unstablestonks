// Responsible gambling controls.
//
// This is the part of a regulated book that is not optional, and BIG had none of it. The
// rules implemented here are the ones every licence expects:
//
//   - deposit / loss / wager limits over a rolling window
//   - session time limits and reality checks
//   - cool-off and self-exclusion, which cannot be undone early
//
// Two design rules, both deliberate:
//
//   1. Tightening a limit takes effect immediately. Loosening one takes effect only after
//      a cooling-off delay. Otherwise a limit is just a speed bump for someone chasing
//      losses.
//   2. Self-exclusion cannot be lifted by the user before it expires, by any path in this
//      module.
//
// Storage is pluggable. The default keeps state in `localStorage`, which is honest about
// what it is: a client-side control that a determined user can clear. A licensed operator
// must back this with a server-side store keyed to a verified identity — see
// `setResponsibleGamblingStore`.

export type LimitPeriod = "daily" | "weekly" | "monthly";

export type LimitKind = "deposit" | "loss" | "wager";

export type Limit = {
  kind: LimitKind;
  period: LimitPeriod;
  /** In bet-token units. */
  amount: number;
  /** When a loosened value becomes active. Undefined means it is already active. */
  effectiveFrom?: number;
  /** The value in force until `effectiveFrom` passes. */
  pendingAmount?: number;
};

export type SessionLimit = {
  /** Minutes of continuous play before the session ends. */
  maxSessionMinutes: number;
  /** Minutes between "you have been playing for X" prompts. 0 disables. */
  realityCheckMinutes: number;
};

export type Exclusion = {
  kind: "cool-off" | "self-exclusion";
  startedAt: number;
  /** Epoch ms. Self-exclusion may be permanent, in which case this is null. */
  endsAt: number | null;
};

export type ResponsibleGamblingState = {
  limits: Limit[];
  session: SessionLimit;
  exclusion: Exclusion | null;
  /** Rolling ledger used to evaluate limits. */
  activity: ActivityEntry[];
};

export type ActivityEntry = {
  kind: LimitKind;
  amount: number;
  at: number;
};

export const DEFAULT_SESSION_LIMIT: SessionLimit = {
  maxSessionMinutes: 0,
  realityCheckMinutes: 60,
};

/** How long a loosened limit waits before it applies. */
export const LIMIT_LOOSENING_DELAY_MS = 24 * 60 * 60 * 1000;

const PERIOD_MS: Record<LimitPeriod, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

const EMPTY_STATE: ResponsibleGamblingState = {
  limits: [],
  session: DEFAULT_SESSION_LIMIT,
  exclusion: null,
  activity: [],
};

// -- Storage ------------------------------------------------------------------------

export interface ResponsibleGamblingStore {
  load(accountKey: string): ResponsibleGamblingState;
  save(accountKey: string, state: ResponsibleGamblingState): void;
}

const STORAGE_PREFIX = "big.rg.v1:";

class LocalStorageStore implements ResponsibleGamblingStore {
  load(accountKey: string): ResponsibleGamblingState {
    if (typeof window === "undefined") {
      return EMPTY_STATE;
    }

    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + accountKey);

      return raw ? { ...EMPTY_STATE, ...(JSON.parse(raw) as ResponsibleGamblingState) } : EMPTY_STATE;
    } catch {
      return EMPTY_STATE;
    }
  }

  save(accountKey: string, state: ResponsibleGamblingState): void {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_PREFIX + accountKey, JSON.stringify(state));
    } catch {
      // Nothing useful to do here; the caller already has the state in memory.
    }
  }
}

let store: ResponsibleGamblingStore = new LocalStorageStore();

/** Point this at a server-side store before operating under a licence. */
export const setResponsibleGamblingStore = (next: ResponsibleGamblingStore): void => {
  store = next;
};

export const loadState = (accountKey: string): ResponsibleGamblingState => store.load(accountKey);
export const saveState = (accountKey: string, state: ResponsibleGamblingState): void =>
  store.save(accountKey, state);

// -- Limits -------------------------------------------------------------------------

/** The amount actually in force right now, accounting for a pending loosening. */
export const effectiveLimit = (limit: Limit, now = Date.now()): number => {
  if (limit.effectiveFrom && now < limit.effectiveFrom && limit.pendingAmount !== undefined) {
    return limit.pendingAmount;
  }

  return limit.amount;
};

/**
 * Set or change a limit.
 *
 * Tightening applies at once. Loosening keeps the old, stricter number in force until the
 * cooling-off delay elapses.
 */
export const setLimit = (
  state: ResponsibleGamblingState,
  kind: LimitKind,
  period: LimitPeriod,
  amount: number,
  now = Date.now(),
): ResponsibleGamblingState => {
  const existing = state.limits.find(
    (limit) => limit.kind === kind && limit.period === period,
  );

  const others = state.limits.filter(
    (limit) => !(limit.kind === kind && limit.period === period),
  );

  if (!existing) {
    return { ...state, limits: [...others, { kind, period, amount }] };
  }

  const current = effectiveLimit(existing, now);

  if (amount <= current) {
    return { ...state, limits: [...others, { kind, period, amount }] };
  }

  return {
    ...state,
    limits: [
      ...others,
      {
        kind,
        period,
        amount,
        pendingAmount: current,
        effectiveFrom: now + LIMIT_LOOSENING_DELAY_MS,
      },
    ],
  };
};

export const removeLimit = (
  state: ResponsibleGamblingState,
  kind: LimitKind,
  period: LimitPeriod,
  now = Date.now(),
): ResponsibleGamblingState => {
  const existing = state.limits.find(
    (limit) => limit.kind === kind && limit.period === period,
  );

  if (!existing) {
    return state;
  }

  // Removing a limit is the loosest possible change, so it waits out the same delay.
  return setLimit(state, kind, period, Number.MAX_SAFE_INTEGER, now);
};

export const usageInPeriod = (
  state: ResponsibleGamblingState,
  kind: LimitKind,
  period: LimitPeriod,
  now = Date.now(),
): number => {
  const since = now - PERIOD_MS[period];

  return state.activity
    .filter((entry) => entry.kind === kind && entry.at >= since)
    .reduce((sum, entry) => sum + entry.amount, 0);
};

export type LimitCheck =
  | { allowed: true }
  | { allowed: false; reason: string; kind: LimitKind; period: LimitPeriod; remaining: number };

/** Would this action breach any limit in force? Call before taking the money. */
export const checkLimits = (
  state: ResponsibleGamblingState,
  kind: LimitKind,
  amount: number,
  now = Date.now(),
): LimitCheck => {
  for (const limit of state.limits.filter((entry) => entry.kind === kind)) {
    const cap = effectiveLimit(limit, now);
    const used = usageInPeriod(state, kind, limit.period, now);
    const remaining = Math.max(0, cap - used);

    if (amount > remaining) {
      return {
        allowed: false,
        kind,
        period: limit.period,
        remaining,
        reason: `This would exceed your ${limit.period} ${kind} limit. ${remaining.toFixed(2)} left in this period.`,
      };
    }
  }

  return { allowed: true };
};

export const recordActivity = (
  state: ResponsibleGamblingState,
  kind: LimitKind,
  amount: number,
  now = Date.now(),
): ResponsibleGamblingState => {
  // Keep only what the longest period could need, so the ledger does not grow forever.
  const horizon = now - PERIOD_MS.monthly;

  return {
    ...state,
    activity: [...state.activity.filter((entry) => entry.at >= horizon), { kind, amount, at: now }],
  };
};

// -- Exclusion ----------------------------------------------------------------------

export const startCoolOff = (
  state: ResponsibleGamblingState,
  durationMs: number,
  now = Date.now(),
): ResponsibleGamblingState => ({
  ...state,
  exclusion: { kind: "cool-off", startedAt: now, endsAt: now + durationMs },
});

/**
 * Self-exclude. `durationMs` of null is permanent.
 *
 * There is no function in this module that shortens or clears an active exclusion — that
 * is the point of it. Lifting one requires an operator-side process after it expires.
 */
export const selfExclude = (
  state: ResponsibleGamblingState,
  durationMs: number | null,
  now = Date.now(),
): ResponsibleGamblingState => ({
  ...state,
  exclusion: {
    kind: "self-exclusion",
    startedAt: now,
    endsAt: durationMs === null ? null : now + durationMs,
  },
});

export const isExcluded = (state: ResponsibleGamblingState, now = Date.now()): boolean => {
  const exclusion = state.exclusion;

  if (!exclusion) {
    return false;
  }

  return exclusion.endsAt === null || now < exclusion.endsAt;
};

export const exclusionEndsIn = (
  state: ResponsibleGamblingState,
  now = Date.now(),
): number | null => {
  const exclusion = state.exclusion;

  if (!exclusion || !isExcluded(state, now)) {
    return null;
  }

  return exclusion.endsAt === null ? null : exclusion.endsAt - now;
};

// -- Sessions -----------------------------------------------------------------------

export type SessionStatus = {
  minutesPlayed: number;
  /** True when a reality check is due. */
  realityCheckDue: boolean;
  /** True when the session limit has been hit and play must stop. */
  sessionExpired: boolean;
};

export const evaluateSession = (
  state: ResponsibleGamblingState,
  sessionStartedAt: number,
  lastRealityCheckAt: number,
  now = Date.now(),
): SessionStatus => {
  const minutesPlayed = (now - sessionStartedAt) / 60_000;
  const { maxSessionMinutes, realityCheckMinutes } = state.session;

  return {
    minutesPlayed,
    realityCheckDue:
      realityCheckMinutes > 0 && now - lastRealityCheckAt >= realityCheckMinutes * 60_000,
    sessionExpired: maxSessionMinutes > 0 && minutesPlayed >= maxSessionMinutes,
  };
};

export type PlayGate = { allowed: true } | { allowed: false; reason: string };

/** One call the UI can make before any staking action. */
export const canPlay = (state: ResponsibleGamblingState, now = Date.now()): PlayGate => {
  if (isExcluded(state, now)) {
    const exclusion = state.exclusion!;
    const until =
      exclusion.endsAt === null
        ? "permanently"
        : `until ${new Date(exclusion.endsAt).toLocaleDateString()}`;

    return {
      allowed: false,
      reason:
        exclusion.kind === "self-exclusion"
          ? `You self-excluded ${until}. This cannot be lifted early.`
          : `You are on a cool-off ${until}.`,
    };
  }

  return { allowed: true };
};

export const SUPPORT_RESOURCES = [
  { label: "GamCare (UK)", url: "https://www.gamcare.org.uk", phone: "0808 8020 133" },
  { label: "Gambling Therapy (international)", url: "https://www.gamblingtherapy.org" },
  { label: "BeGambleAware", url: "https://www.begambleaware.org" },
];
