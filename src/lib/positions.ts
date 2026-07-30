import { readCache, writeCache } from "./persist";
import type { ChainKey } from "@/config/chains";

// ─────────────────────────────────────────────────────────────────────────────
// Cost basis for trades made ON THIS TERMINAL.
//
// A sell is only interesting if you know what the position cost, and no source
// the app reads can tell it: the chain knows the transfer, not the price you
// paid, and the trade feed is a short window that usually predates the entry.
// So the entry is recorded when it happens, here, in this browser.
//
// Both legs are valued the same way — token quantity times the token's USD price
// at that moment — so the P&L reported is exactly the price move between the buy
// and the sell. That is the honest reading of the one thing we actually observe.
//
// Deliberate limits, stated rather than papered over:
//   · Only trades made through this terminal count. Buy elsewhere, sell here,
//     and there is no basis — the card says so instead of inventing one.
//   · Per browser. Another device has its own ledger.
//   · Fees and slippage are not modelled; the price used is the quoted one.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "positions.v1";

interface Lot {
  /** Token units still held from recorded buys. */
  qty: number;
  /** What those units cost, in USD. */
  costUsd: number;
  /** Cumulative realised P&L on this token, in USD. */
  realisedUsd: number;
  symbol: string;
  updatedAt: number;
}

type Ledger = Record<string, Lot>;

const slot = (chain: ChainKey, token: string) => `${chain}:${token.toLowerCase()}`;

function read(): Ledger {
  return readCache<Ledger>(KEY, Number.MAX_SAFE_INTEGER) ?? {};
}

/** A completed sell, priced against what the position cost. */
export interface SellOutcome {
  symbol: string;
  /** Tokens sold. */
  qty: number;
  /** What they fetched, in USD. */
  proceedsUsd: number;
  /** What that slice originally cost, in USD. */
  costUsd: number;
  pnlUsd: number;
  pnlPct: number;
  /** True when the sale closed the whole recorded position. */
  closed: boolean;
  /** Cumulative realised P&L on this token, after this sale. */
  lifetimeUsd: number;
}

/** Record a buy. `qty` is tokens received, `price` their USD price at the time. */
export function recordBuy(
  chain: ChainKey,
  token: string,
  symbol: string,
  qty: number,
  price: number,
): void {
  if (!(qty > 0) || !(price > 0)) return;
  const ledger = read();
  const k = slot(chain, token);
  const lot = ledger[k] ?? { qty: 0, costUsd: 0, realisedUsd: 0, symbol, updatedAt: 0 };
  ledger[k] = {
    ...lot,
    symbol: symbol || lot.symbol,
    qty: lot.qty + qty,
    costUsd: lot.costUsd + qty * price,
    updatedAt: Date.now(),
  };
  writeCache(KEY, ledger);
}

/**
 * Record a sell and report what it made.
 *
 * Returns null when there is no recorded position — that isn't a zero, it means
 * the entry happened somewhere this browser never saw, and a P&L card would be
 * fiction. The caller shows nothing rather than a made-up number.
 *
 * Cost is taken at the average of the recorded buys, proportionally to the slice
 * sold. Selling more than was recorded is treated as closing what we know about.
 */
export function recordSell(
  chain: ChainKey,
  token: string,
  symbol: string,
  qty: number,
  price: number,
): SellOutcome | null {
  if (!(qty > 0) || !(price > 0)) return null;
  const ledger = read();
  const k = slot(chain, token);
  const lot = ledger[k];
  if (!lot || lot.qty <= 0 || lot.costUsd <= 0) return null;

  const sold = Math.min(qty, lot.qty);
  const avg = lot.costUsd / lot.qty;
  const costUsd = avg * sold;
  const proceedsUsd = sold * price;
  const pnlUsd = proceedsUsd - costUsd;

  const remaining = lot.qty - sold;
  const lifetimeUsd = lot.realisedUsd + pnlUsd;
  ledger[k] = {
    ...lot,
    symbol: symbol || lot.symbol,
    qty: remaining,
    // Keep the average intact on a partial sale by removing cost in proportion.
    costUsd: remaining > 0 ? lot.costUsd - costUsd : 0,
    realisedUsd: lifetimeUsd,
    updatedAt: Date.now(),
  };
  writeCache(KEY, ledger);

  return {
    symbol: symbol || lot.symbol,
    qty: sold,
    proceedsUsd,
    costUsd,
    pnlUsd,
    pnlPct: (pnlUsd / costUsd) * 100,
    closed: remaining <= 0,
    lifetimeUsd,
  };
}

/** Recorded position in a token, for panels that want to show a basis. */
export function readPosition(chain: ChainKey, token: string): Lot | undefined {
  return read()[slot(chain, token)];
}
