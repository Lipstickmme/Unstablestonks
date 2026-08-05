import type { PublicClient } from "viem";
import { parseAbiItem } from "viem";
import { CONTRACT_ADDRESS } from "@/lib/contract";
import { BIG_MARKET_ABI } from "@/lib/abi";

// Keep chunks small to avoid RPC "block range too large" / "too many logs" limits
const MAX_BLOCK_RANGE = 20n;
// Max blocks to scan backwards (e.g. 200 chunks of 20 = 4k blocks)
const MAX_LOOKBACK_BLOCKS = 10000n;
// Shorter lookback when querying single event (avoids RPC limits)
const EVENT_LOOKBACK_BLOCKS = 2000n;
// Stop fetching once we have this many unique log entries (limits response size and RPC load)
const MAX_LOGS_CAP = 500;

const BET_PLACED = parseAbiItem(
  "event BetPlaced(uint256 indexed eventId, address indexed user, uint256 outcome, uint256 amount)"
);
const BET_PLACED_ENHANCED = parseAbiItem(
  "event BetPlacedEnhanced(uint256 indexed eventId, address indexed user, uint256 outcome, uint256 amount, uint256 timestamp, uint256 totalPool, uint256 outcomePool)"
);

function isRateLimited(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests");
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Earliest block to query: from env NEXT_PUBLIC_EVENT_LOG_START_BLOCK, or latest - lookback */
function getEarliestBlock(latestBlock: bigint, lookback?: bigint): bigint {
  const raw = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_EVENT_LOG_START_BLOCK?.trim() : "";
  if (raw) {
    try {
      const from = BigInt(raw);
      if (from >= 0n && from <= latestBlock) return from;
    } catch {
      // ignore invalid env
    }
  }
  const lb = lookback ?? MAX_LOOKBACK_BLOCKS;
  return latestBlock > lb ? latestBlock - lb : 0n;
}

/**
 * Fetch BetPlaced / BetPlacedEnhanced in small block chunks to avoid "block range too large" RPC errors.
 * When filtering by eventId, uses shorter lookback (EVENT_LOOKBACK_BLOCKS) to avoid RPC limits.
 */
export async function fetchBetLogs(
  publicClient: PublicClient,
  filter: { user: `0x${string}` } | { eventId: bigint },
  options?: { maxBlockRange?: bigint; maxLookback?: bigint }
): Promise<BetLogEntryWithBlock[]> {
  const latestBlock = await publicClient.getBlockNumber();
  const maxRange = options?.maxBlockRange ?? MAX_BLOCK_RANGE;
  const lookback = options?.maxLookback ?? ("eventId" in filter ? EVENT_LOOKBACK_BLOCKS : MAX_LOOKBACK_BLOCKS);
  const earliest = getEarliestBlock(latestBlock, lookback);

  const args = "user" in filter ? { user: filter.user } : { eventId: filter.eventId };
  const byKey = new Map<string, BetLogEntryWithBlock>();

  // Request in chunks from latest backwards
  let toBlock = latestBlock;
  let fromBlock = toBlock > maxRange ? toBlock - maxRange + 1n : 0n;
  if (fromBlock < earliest) fromBlock = earliest;

  while (toBlock >= earliest) {
    for (let retry = 0; retry <= 3; retry++) {
      try {
        const [enhancedLogs, originalLogs] = await Promise.all([
          publicClient.getLogs({
            address: CONTRACT_ADDRESS,
            event: BET_PLACED_ENHANCED,
            args,
            fromBlock,
            toBlock,
          }),
          publicClient.getLogs({
            address: CONTRACT_ADDRESS,
            event: BET_PLACED,
            args,
            fromBlock,
            toBlock,
          }),
        ]);

        for (const log of [...originalLogs, ...enhancedLogs]) {
          if (byKey.size >= MAX_LOGS_CAP) break;
          const a = log.args as { eventId?: bigint; user?: `0x${string}`; outcome?: bigint; amount?: bigint; timestamp?: bigint };
          const key = `${log.blockNumber}-${log.logIndex}`;
          if (a.eventId !== undefined && a.user && a.amount !== undefined) {
            byKey.set(key, {
              eventId: Number(a.eventId),
              user: a.user,
              outcome: Number(a.outcome ?? 0n),
              amount: a.amount,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex,
              timestamp: a.timestamp,
            });
          }
        }
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (retry < 3 && isRateLimited(err)) {
          await delay(2000 * Math.pow(2, retry));
        } else {
          if (/block range|query returned more than|too many logs/i.test(msg)) {
            throw new Error("Block range too large. Set NEXT_PUBLIC_EVENT_LOG_START_BLOCK to a block number closer to when the contract was used (e.g. first event creation block).");
          }
          throw err;
        }
      }
    }

    if (toBlock <= earliest || byKey.size >= MAX_LOGS_CAP) break;
    toBlock = fromBlock - 1n;
    fromBlock = toBlock > maxRange ? toBlock - maxRange + 1n : 0n;
    if (fromBlock < earliest) fromBlock = earliest;
    await delay(400);
  }

  return Array.from(byKey.values());
}

export type BetLogEntry = { eventId: number; user: `0x${string}`; outcome: number; amount: bigint };
export type BetLogEntryWithBlock = BetLogEntry & { blockNumber: bigint; logIndex: number; timestamp?: bigint };

/** Fetch recent bet logs across all events (no user/eventId filter). Used for dashboard "recent activity". */
export async function fetchRecentBetLogs(
  publicClient: PublicClient,
  options?: { limit?: number }
): Promise<BetLogEntry[]> {
  const limit = options?.limit ?? 100;
  const latestBlock = await publicClient.getBlockNumber();
  const earliest = getEarliestBlock(latestBlock);
  const byKey = new Map<string, BetLogEntry>();

  let toBlock = latestBlock;
  let fromBlock = toBlock > MAX_BLOCK_RANGE ? toBlock - MAX_BLOCK_RANGE + 1n : 0n;
  if (fromBlock < earliest) fromBlock = earliest;

  while (toBlock >= earliest && byKey.size < limit) {
    for (let retry = 0; retry <= 3; retry++) {
      try {
        const [enhancedLogs, originalLogs] = await Promise.all([
          publicClient.getLogs({
            address: CONTRACT_ADDRESS,
            event: BET_PLACED_ENHANCED,
            fromBlock,
            toBlock,
          }),
          publicClient.getLogs({
            address: CONTRACT_ADDRESS,
            event: BET_PLACED,
            fromBlock,
            toBlock,
          }),
        ]);

        for (const log of [...originalLogs, ...enhancedLogs]) {
          if (byKey.size >= limit) break;
          const a = log.args as { eventId?: bigint; user?: `0x${string}`; outcome?: bigint; amount?: bigint };
          const key = `${log.blockNumber}-${log.logIndex}`;
          if (a.eventId !== undefined && a.user && a.amount !== undefined) {
            byKey.set(key, {
              eventId: Number(a.eventId),
              user: a.user,
              outcome: Number(a.outcome ?? 0n),
              amount: a.amount,
            });
          }
        }
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (retry < 3 && isRateLimited(err)) {
          await delay(2000 * Math.pow(2, retry));
        } else {
          if (/block range|query returned more than|too many logs/i.test(msg)) {
            throw new Error("Block range too large. Set NEXT_PUBLIC_EVENT_LOG_START_BLOCK to a block number closer to when the contract was used (e.g. first event creation block).");
          }
          throw err;
        }
      }
    }

    if (toBlock <= earliest || byKey.size >= limit) break;
    toBlock = fromBlock - 1n;
    fromBlock = toBlock > MAX_BLOCK_RANGE ? toBlock - MAX_BLOCK_RANGE + 1n : 0n;
    if (fromBlock < earliest) fromBlock = earliest;
    await delay(400);
  }

  return Array.from(byKey.values());
}

/**
 * Fallback: derive user bets from contract state (eventCount + getEvent + bets) when getLogs fails or returns empty.
 */
export async function fetchUserBetsFromContract(
  publicClient: PublicClient,
  user: `0x${string}`
): Promise<BetLogEntry[]> {
  const count = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "eventCount",
    args: [],
  });
  const totalEvents = Number(count);
  const entries: BetLogEntry[] = [];

  for (let eventId = 0; eventId < totalEvents; eventId++) {
    const event = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: BIG_MARKET_ABI,
      functionName: "getEvent",
      args: [BigInt(eventId)],
    }).catch(() => null);
    if (!event) continue;
    const outcomes = (Array.isArray(event) ? event[5] : (event as { outcomes?: string[] }).outcomes) as readonly string[] | undefined;
    if (!outcomes?.length) continue;

    for (let outcome = 0; outcome < outcomes.length; outcome++) {
      const raw = await publicClient
        .readContract({
          address: CONTRACT_ADDRESS,
          abi: BIG_MARKET_ABI,
          functionName: "bets",
          args: [BigInt(eventId), user, BigInt(outcome)],
        })
        .catch(() => 0n);
      const amount = typeof raw === "bigint" ? raw : 0n;
      if (amount > 0n) entries.push({ eventId, user, outcome, amount });
    }
  }

  return entries;
}
