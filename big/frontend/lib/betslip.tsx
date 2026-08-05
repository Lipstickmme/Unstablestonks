"use client";

// Betslip state.
//
// Holds the bettor's selections between page navigations, prices singles and combos, and
// enforces the one rule the protocol will otherwise reject an order for: a combo may not
// contain two outcomes of the same condition.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { calcComboOdds, calcPayout, type GameState, selectionKey } from "./azuro";

export type BetslipItem = {
  conditionId: string;
  outcomeId: string;
  /** Odds at the moment of selection; refreshed from the socket while the slip is open. */
  odds: number;
  outcomeTitle: string;
  marketTitle: string;
  gameId: string;
  gameTitle: string;
  sportId: string;
  sportSlug: string;
  leagueSlug: string;
  leagueName: string;
  startsAt: string;
  gameState: GameState;
  isExpressForbidden: boolean;
};

export type BetslipMode = "single" | "combo";

export type OddsChange = {
  key: string;
  from: number;
  to: number;
};

type BetslipContextValue = {
  items: BetslipItem[];
  mode: BetslipMode;
  /** Per-selection stakes in "single" mode, keyed by selectionKey. */
  stakes: Record<string, string>;
  /** One stake for the whole slip in "combo" mode. */
  comboStake: string;
  slippage: number;
  /** Odds that moved since the bettor picked them, pending acknowledgement. */
  oddsChanges: OddsChange[];
  comboOdds: number;
  comboPayout: number;
  totalStake: number;
  totalPayout: number;
  isComboAllowed: boolean;
  comboBlockedReason: string | null;
  has: (conditionId: string, outcomeId: string) => boolean;
  toggle: (item: BetslipItem) => void;
  remove: (conditionId: string, outcomeId: string) => void;
  clear: () => void;
  setMode: (mode: BetslipMode) => void;
  setStake: (key: string, value: string) => void;
  setComboStake: (value: string) => void;
  setSlippage: (value: number) => void;
  /** Called by the live-odds layer when a price moves. */
  updateOdds: (conditionId: string, outcomeId: string, odds: number) => void;
  acceptOddsChanges: () => void;
};

const BetslipContext = createContext<BetslipContextValue | null>(null);

const STORAGE_KEY = "big.betslip.v1";
const MAX_COMBO_LEGS = 15;

export function BetslipProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BetslipItem[]>([]);
  const [mode, setMode] = useState<BetslipMode>("single");
  const [stakes, setStakes] = useState<Record<string, string>>({});
  const [comboStake, setComboStake] = useState("");
  const [slippage, setSlippage] = useState(5);
  const [oddsChanges, setOddsChanges] = useState<OddsChange[]>([]);

  // Restore on mount so a refresh mid-slip does not lose the bettor's work.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);

      if (saved) {
        const parsed = JSON.parse(saved) as { items: BetslipItem[]; mode: BetslipMode };
        setItems(parsed.items ?? []);
        setMode(parsed.mode ?? "single");
      }
    } catch {
      // A corrupt slip is not worth surfacing — start empty.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, mode }));
    } catch {
      // Storage can be full or blocked; the slip still works in memory.
    }
  }, [items, mode]);

  const has = useCallback(
    (conditionId: string, outcomeId: string) =>
      items.some((item) => item.conditionId === conditionId && item.outcomeId === outcomeId),
    [items],
  );

  const remove = useCallback((conditionId: string, outcomeId: string) => {
    setItems((current) =>
      current.filter(
        (item) => !(item.conditionId === conditionId && item.outcomeId === outcomeId),
      ),
    );
  }, []);

  const toggle = useCallback((item: BetslipItem) => {
    setItems((current) => {
      const exists = current.some(
        (entry) => entry.conditionId === item.conditionId && entry.outcomeId === item.outcomeId,
      );

      if (exists) {
        return current.filter(
          (entry) =>
            !(entry.conditionId === item.conditionId && entry.outcomeId === item.outcomeId),
        );
      }

      // Picking a different outcome on the same condition replaces the old one rather
      // than stacking an impossible pair.
      const withoutSameCondition = current.filter(
        (entry) => entry.conditionId !== item.conditionId,
      );

      if (withoutSameCondition.length >= MAX_COMBO_LEGS) {
        return withoutSameCondition;
      }

      return [...withoutSameCondition, item];
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setStakes({});
    setComboStake("");
    setOddsChanges([]);
  }, []);

  const setStake = useCallback((key: string, value: string) => {
    setStakes((current) => ({ ...current, [key]: value }));
  }, []);

  const updateOdds = useCallback((conditionId: string, outcomeId: string, odds: number) => {
    setItems((current) => {
      let changed = false;

      const next = current.map((item) => {
        if (item.conditionId !== conditionId || item.outcomeId !== outcomeId) {
          return item;
        }

        if (Math.abs(item.odds - odds) < 1e-9) {
          return item;
        }

        changed = true;
        setOddsChanges((changes) => [
          ...changes.filter((change) => change.key !== selectionKey(item)),
          { key: selectionKey(item), from: item.odds, to: odds },
        ]);

        return { ...item, odds };
      });

      return changed ? next : current;
    });
  }, []);

  const acceptOddsChanges = useCallback(() => setOddsChanges([]), []);

  const comboBlockedReason = useMemo(() => {
    if (items.length < 2) {
      return null;
    }

    if (items.some((item) => item.isExpressForbidden)) {
      return "One of your selections cannot be combined";
    }

    const gameIds = items.map((item) => item.gameId);

    if (new Set(gameIds).size !== gameIds.length) {
      return "A combo cannot contain two outcomes from the same event";
    }

    return null;
  }, [items]);

  const isComboAllowed = items.length >= 2 && comboBlockedReason === null;

  const comboOdds = useMemo(
    () => (items.length ? calcComboOdds(items.map((item) => item.odds)) : 0),
    [items],
  );

  const comboPayout = useMemo(
    () => calcPayout(Number(comboStake) || 0, comboOdds).payout,
    [comboStake, comboOdds],
  );

  const totalStake = useMemo(() => {
    if (mode === "combo") {
      return Number(comboStake) || 0;
    }

    return items.reduce((sum, item) => sum + (Number(stakes[selectionKey(item)]) || 0), 0);
  }, [mode, comboStake, items, stakes]);

  const totalPayout = useMemo(() => {
    if (mode === "combo") {
      return comboPayout;
    }

    return items.reduce(
      (sum, item) =>
        sum + calcPayout(Number(stakes[selectionKey(item)]) || 0, item.odds).payout,
      0,
    );
  }, [mode, comboPayout, items, stakes]);

  // A slip that drops below two legs cannot stay in combo mode.
  useEffect(() => {
    if (mode === "combo" && !isComboAllowed) {
      setMode("single");
    }
  }, [mode, isComboAllowed]);

  const value = useMemo<BetslipContextValue>(
    () => ({
      items,
      mode,
      stakes,
      comboStake,
      slippage,
      oddsChanges,
      comboOdds,
      comboPayout,
      totalStake,
      totalPayout,
      isComboAllowed,
      comboBlockedReason,
      has,
      toggle,
      remove,
      clear,
      setMode,
      setStake,
      setComboStake,
      setSlippage,
      updateOdds,
      acceptOddsChanges,
    }),
    [
      items,
      mode,
      stakes,
      comboStake,
      slippage,
      oddsChanges,
      comboOdds,
      comboPayout,
      totalStake,
      totalPayout,
      isComboAllowed,
      comboBlockedReason,
      has,
      toggle,
      remove,
      clear,
      setStake,
      updateOdds,
      acceptOddsChanges,
    ],
  );

  return <BetslipContext.Provider value={value}>{children}</BetslipContext.Provider>;
}

export const useBetslip = (): BetslipContextValue => {
  const context = useContext(BetslipContext);

  if (!context) {
    throw new Error("useBetslip must be used inside <BetslipProvider>");
  }

  return context;
};
