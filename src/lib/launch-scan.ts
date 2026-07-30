import { createServerFn } from "@tanstack/react-start";
import { proxiedFetchJson } from "./net";

// ─────────────────────────────────────────────────────────────────────────────
// Factory log scan via the Etherscan V2 multichain API.
//
// Public RPCs frequently refuse eth_getLogs, cap the block range, or drop
// historical logs entirely — which is exactly when new-launch discovery goes
// quiet. Etherscan's logs module has no such limits and is what the
// STABLESCAN_API_KEY actually buys us here:
//
//   /v2/api?chainid=988&module=logs&action=getLogs
//          &address=<factory>&topic0=<PoolCreated|PairCreated>
//          &fromBlock=&toBlock=&offset=1000&apikey=…
//
// Each log carries indexed token0/token1 in topics[1]/topics[2] and its own
// timeStamp, so one call yields both the tokens and their launch times — no
// follow-up block lookups.
//
// Runs server-side so the key never reaches the browser bundle. Returns an empty
// list (never an error) when no key is set or the chain isn't served.
// ─────────────────────────────────────────────────────────────────────────────

function serverEnv(key: string): string | undefined {
  try {
    const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env?.[key];
    return v && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function apiKey(): string | undefined {
  return (
    serverEnv("STABLESCAN_API_KEY") ??
    serverEnv("ETHERSCAN_API_KEY") ??
    serverEnv("EXPLORER_API_KEY")
  );
}

export interface ScannedLaunch {
  /** The two tokens of the created pool, lowercase. */
  token0: string;
  token1: string;
  /** Creation time in ms. */
  ts: number;
  blockNumber: number;
}

interface EsLog {
  topics?: string[];
  blockNumber?: string;
  timeStamp?: string;
}

/** A 32-byte indexed address topic → a 20-byte address. */
function topicToAddress(topic?: string): string {
  if (!topic || topic.length < 42) return "";
  return `0x${topic.slice(-40)}`.toLowerCase();
}

const hexNum = (v?: string) => {
  if (!v) return 0;
  const n = v.startsWith("0x") ? parseInt(v, 16) : parseInt(v, 10);
  return isFinite(n) ? n : 0;
};

export const scanFactoryLaunches = createServerFn({ method: "GET" })
  .validator(
    (raw: unknown): { chainId: number; factory: string; topic0: string; fromBlock: number } => {
      const o = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
      return {
        chainId: Number(o.chainId ?? 0),
        factory: String(o.factory ?? ""),
        topic0: String(o.topic0 ?? ""),
        fromBlock: Math.max(0, Number(o.fromBlock ?? 0)),
      };
    },
  )
  .handler(async ({ data }): Promise<ScannedLaunch[]> => {
    const key = apiKey();
    const { chainId, factory, topic0, fromBlock } = data;
    if (!key || !chainId || !/^0x[0-9a-fA-F]{40}$/.test(factory) || !topic0) return [];

    const url =
      `https://api.etherscan.io/v2/api?chainid=${chainId}` +
      `&module=logs&action=getLogs&address=${factory}&topic0=${topic0}` +
      `&fromBlock=${fromBlock}&toBlock=latest&page=1&offset=1000&apikey=${key}`;

    const body = await proxiedFetchJson<{ status?: string; result?: EsLog[] | string }>(url, {
      timeoutMs: 12_000,
      headers: { Accept: "application/json" },
    });
    // A no-results response comes back with result as a string message.
    if (!body || !Array.isArray(body.result)) return [];

    const out: ScannedLaunch[] = [];
    for (const log of body.result) {
      const token0 = topicToAddress(log.topics?.[1]);
      const token1 = topicToAddress(log.topics?.[2]);
      if (!token0 || !token1) continue;
      out.push({
        token0,
        token1,
        ts: hexNum(log.timeStamp) * 1000,
        blockNumber: hexNum(log.blockNumber),
      });
    }
    return out.sort((a, b) => b.blockNumber - a.blockNumber);
  });

/**
 * Who deployed a contract, from the explorer's contract module.
 *
 * Blockscout's /addresses/{hash} carries `creator_address_hash` and is tried
 * first, but a young Blockscout deployment often doesn't have it — and without a
 * deployer address there is no dev-holding figure at all. This is the free
 * Etherscan V2 route to the same fact.
 */
export const fetchContractCreator = createServerFn({ method: "GET" })
  .validator((raw: unknown): { chainId: number; address: string } => {
    const o = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
    return { chainId: Number(o.chainId ?? 0), address: String(o.address ?? "") };
  })
  .handler(async ({ data }): Promise<string> => {
    const key = apiKey();
    const { chainId, address } = data;
    if (!key || !chainId || !/^0x[0-9a-fA-F]{40}$/.test(address)) return "";

    const url =
      `https://api.etherscan.io/v2/api?chainid=${chainId}` +
      `&module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${key}`;

    const body = await proxiedFetchJson<{ result?: { contractCreator?: string }[] | string }>(url, {
      timeoutMs: 12_000,
      headers: { Accept: "application/json" },
    });
    if (!body || !Array.isArray(body.result)) return "";
    const creator = body.result[0]?.contractCreator ?? "";
    return /^0x[0-9a-fA-F]{40}$/.test(creator) ? creator.toLowerCase() : "";
  });

/**
 * Transfer logs for a single token, same explorer route and for the same reason:
 * the public RPCs on these chains routinely refuse eth_getLogs, and without logs
 * there is no way to find out who holds a token when the explorer has no holders
 * endpoint.
 *
 * Only the indexed parties are returned — `from` in topics[1], `to` in topics[2].
 * The amount lives in the unindexed data field and is deliberately ignored:
 * summing transfers to reconstruct a balance drifts, so the addresses are treated
 * as candidates and their real balances are read with balanceOf.
 */
export const scanTransferLogs = createServerFn({ method: "GET" })
  .validator((raw: unknown): { chainId: number; token: string; fromBlock: number } => {
    const o = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
    return {
      chainId: Number(o.chainId ?? 0),
      token: String(o.token ?? ""),
      fromBlock: Math.max(0, Number(o.fromBlock ?? 0)),
    };
  })
  .handler(async ({ data }): Promise<{ from: string; to: string }[]> => {
    const key = apiKey();
    const { chainId, token, fromBlock } = data;
    if (!key || !chainId || !/^0x[0-9a-fA-F]{40}$/.test(token)) return [];

    const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const url =
      `https://api.etherscan.io/v2/api?chainid=${chainId}` +
      `&module=logs&action=getLogs&address=${token}&topic0=${TRANSFER}` +
      `&fromBlock=${fromBlock}&toBlock=latest&page=1&offset=1000&apikey=${key}`;

    const body = await proxiedFetchJson<{ result?: EsLog[] | string }>(url, {
      timeoutMs: 12_000,
      headers: { Accept: "application/json" },
    });
    if (!body || !Array.isArray(body.result)) return [];

    const out: { from: string; to: string }[] = [];
    for (const log of body.result) {
      const from = topicToAddress(log.topics?.[1]);
      const to = topicToAddress(log.topics?.[2]);
      if (from || to) out.push({ from, to });
    }
    return out;
  });
