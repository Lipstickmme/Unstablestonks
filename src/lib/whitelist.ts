import { readCache, writeCache } from "./persist";

// ─────────────────────────────────────────────────────────────────────────────
// NFT whitelist quest.
//
// ⚠️ SCOPE — read before trusting any number this file produces.
//
// The roster lives in localStorage, on the visitor's own device, because that's
// what was asked for. Two consequences that cannot be engineered away from the
// front end:
//
//   1. It is NOT a shared list. Every device keeps its own copy, so every
//      visitor sees a low spot number. "#7 of 100" means "the 7th claim in this
//      browser", not the 7th in the world.
//   2. It is NOT tamper-proof. Anyone can edit localStorage and award themselves
//      a spot, an earlier number, or all 100.
//
// The social tasks are self-attested for the same reason: a browser cannot
// verify a Telegram join or an X follow. Only the trade is really observed —
// SwapPanel marks it after a swap actually confirms on chain.
//
// Making this authoritative needs a server holding the roster, wallet-signature
// proof of address ownership, and either the platform APIs or a manual review
// for the social steps. The UI says so rather than implying otherwise.
// ─────────────────────────────────────────────────────────────────────────────

export const WHITELIST_CAP = 100;

const KEY = "whitelist.v1";

export type QuestId = "trade" | "tgGroup" | "tgChannel" | "xFollow" | "xRepost";

export const QUESTS: { id: QuestId; label: string; detail: string; verified: boolean }[] = [
  {
    id: "trade",
    label: "Make one trade",
    detail: "Any buy or sell on the terminal",
    verified: true,
  },
  { id: "tgGroup", label: "Join the group chat", detail: "t.me/UnstableStonk", verified: false },
  { id: "tgChannel", label: "Join the channel", detail: "t.me/UnstableStonks", verified: false },
  { id: "xFollow", label: "Follow on X", detail: "@Unstablestonks", verified: false },
  { id: "xRepost", label: "Repost and comment", detail: "The pinned launch post", verified: false },
];

export interface WhitelistState {
  /** Task id → done. */
  tasks: Partial<Record<QuestId, boolean>>;
  /** Wallet that claimed, lowercase. */
  wallet?: string;
  /** 1-based spot, assigned at claim time. */
  spot?: number;
  claimedAt?: number;
  /** Addresses recorded on this device, in claim order. */
  roster: string[];
}

const EMPTY: WhitelistState = { tasks: {}, roster: [] };

export function readWhitelist(): WhitelistState {
  return readCache<WhitelistState>(KEY, Number.MAX_SAFE_INTEGER) ?? EMPTY;
}

function save(state: WhitelistState): WhitelistState {
  writeCache(KEY, state);
  return state;
}

export function setTask(id: QuestId, done = true): WhitelistState {
  const s = readWhitelist();
  return save({ ...s, tasks: { ...s.tasks, [id]: done } });
}

/** Called by the swap panel once a trade actually confirms. */
export function markTradeComplete(): WhitelistState {
  return setTask("trade", true);
}

export function allTasksDone(s: WhitelistState): boolean {
  return QUESTS.every((q) => s.tasks[q.id]);
}

export type ClaimResult =
  | { ok: true; spot: number; state: WhitelistState }
  | { ok: false; reason: string };

/**
 * Record a wallet on this device's roster and assign it a spot.
 *
 * Re-claiming with the same wallet returns the existing spot rather than
 * consuming another, so a refresh can't inflate the count.
 */
export function claimSpot(wallet: string): ClaimResult {
  const s = readWhitelist();
  if (!allTasksDone(s)) return { ok: false, reason: "Finish every task first." };

  const addr = wallet.toLowerCase();
  const existing = s.roster.indexOf(addr);
  if (existing >= 0) {
    const spot = existing + 1;
    return { ok: true, spot, state: save({ ...s, wallet: addr, spot }) };
  }
  if (s.roster.length >= WHITELIST_CAP) {
    return { ok: false, reason: "All 100 spots on this device are taken." };
  }

  const roster = [...s.roster, addr];
  const spot = roster.length;
  return {
    ok: true,
    spot,
    state: save({ ...s, roster, wallet: addr, spot, claimedAt: Date.now() }),
  };
}

/** Zero-padded card number, e.g. 7 → "007". */
export function cardNumber(spot: number): string {
  return String(spot).padStart(3, "0");
}
