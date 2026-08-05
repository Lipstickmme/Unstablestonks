// Ramp session/transaction persistence.
//
// Deliberately an interface with an in-memory default rather than a database: BIG has no
// backend store today, and inventing one here would be a bigger decision than this change
// should make on an operator's behalf.
//
// The in-memory implementation is correct for a single process and is explicitly NOT
// durable — it is wiped on restart and is not shared across serverless instances. Wire
// `setRampStore` to Redis/Postgres before taking real deposits, or webhook reconciliation
// will lose orders.

import type { RampDirection, RampProviderId, RampTransaction } from "./types";

export type RampSessionRecord = {
  referenceId: string;
  provider: RampProviderId;
  direction: RampDirection;
  chainId: number;
  walletAddress: `0x${string}`;
  amount: number;
  fiatCurrency: string;
  createdAt: number;
};

export interface RampStore {
  saveSession(record: RampSessionRecord): Promise<void>;
  getSession(referenceId: string): Promise<RampSessionRecord | null>;
  saveTransaction(transaction: RampTransaction): Promise<void>;
  listTransactions(walletAddress: string): Promise<RampTransaction[]>;
}

class InMemoryRampStore implements RampStore {
  private readonly sessions = new Map<string, RampSessionRecord>();
  private readonly transactions = new Map<string, RampTransaction>();

  async saveSession(record: RampSessionRecord): Promise<void> {
    this.sessions.set(record.referenceId, record);
  }

  async getSession(referenceId: string): Promise<RampSessionRecord | null> {
    return this.sessions.get(referenceId) ?? null;
  }

  async saveTransaction(transaction: RampTransaction): Promise<void> {
    // Keyed by provider order id so repeated webhooks for one order update in place
    // rather than piling up — providers retry, and they retry out of order.
    this.transactions.set(`${transaction.provider}:${transaction.providerOrderId}`, transaction);
  }

  async listTransactions(walletAddress: string): Promise<RampTransaction[]> {
    const wanted = walletAddress.toLowerCase();

    return [...this.transactions.values()]
      .filter((transaction) => transaction.walletAddress.toLowerCase() === wanted)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}

let store: RampStore = new InMemoryRampStore();

/** Swap in a durable store at boot. */
export const setRampStore = (next: RampStore): void => {
  store = next;
};

export const recordSession = (record: RampSessionRecord) => store.saveSession(record);
export const findSession = (referenceId: string) => store.getSession(referenceId);
export const recordTransaction = (transaction: RampTransaction) =>
  store.saveTransaction(transaction);
export const listTransactions = (walletAddress: string) => store.listTransactions(walletAddress);
