import { readCache, writeCache } from "./persist";

// ─────────────────────────────────────────────────────────────────────────────
// NFT whitelist quest — local state.
//
// This file holds the per-device half: which tasks are done, and the claimed
// spot once one is granted.
//
// The ROSTER is authoritative only when a shared store is configured (see
// store.ts). With one, the spot number comes from the server and means the same
// to everyone. Without one, the fallback below numbers claims per browser — so
// every visitor sees a low number, and it can be edited by hand.
//
// Task completion is local either way. Only the trade is really observed:
// SwapPanel marks it after a swap confirms on chain.
// ─────────────────────────────────────────────────────────────────────────────

export const WHITELIST_CAP = 1190;

/** The whitelist is open again — claiming works. */
export const WHITELIST_CLOSED = false;

/**
 * Spots already allocated before public claiming, counted against the cap.
 *
 * This is a SET figure, not a measured one: it stands for the team, partner and
 * early-contributor allocations that were never going to come through this page,
 * so the roster here can't know about them. Displayed as taken so the counter
 * reflects what is genuinely left rather than only what this app handed out.
 *
 * Named as a baseline rather than folded into the count silently, so nobody
 * later reads the number on screen as a live tally of on-page claims. Every
 * claim made by an actual person finishing the tasks is counted ON TOP of it by
 * the shared roster (store.ts), so the figure on screen moves for real from here
 * up to WHITELIST_CAP.
 */
export const WHITELIST_BASELINE = 200;

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
export function claimSpot(wallet: string, authoritativeSpot?: number): ClaimResult {
  const s = readWhitelist();
  if (!allTasksDone(s)) return { ok: false, reason: "Finish every task first." };

  const addr = wallet.toLowerCase();

  // A spot handed back by the shared roster wins outright — it's the only
  // number that means the same thing to every visitor.
  if (typeof authoritativeSpot === "number" && authoritativeSpot > 0) {
    const roster = s.roster.includes(addr) ? s.roster : [...s.roster, addr];
    return {
      ok: true,
      spot: authoritativeSpot,
      state: save({
        ...s,
        roster,
        wallet: addr,
        spot: authoritativeSpot,
        claimedAt: s.claimedAt ?? Date.now(),
      }),
    };
  }

  const existing = s.roster.indexOf(addr);
  if (existing >= 0) {
    const spot = existing + 1;
    return { ok: true, spot, state: save({ ...s, wallet: addr, spot }) };
  }
  if (s.roster.length >= WHITELIST_CAP) {
    return { ok: false, reason: `All ${WHITELIST_CAP} spots on this device are taken.` };
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
