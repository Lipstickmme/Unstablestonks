import { createWalletClient, custom, type Account, type Chain } from "viem";

// ─────────────────────────────────────────────────────────────────────────────
// Stable · cross-chain USDC transfers, powered by @stable-io/sdk (Circle CCTP).
//
// The SDK is imported DYNAMICALLY and only on the client, so it never enters the
// SSR/server bundle and can't break the build. We supply a browser-wallet signer
// (the SDK's ViemSigner is for local private-key accounts; injected wallets need
// a provider-transport wallet client), and expose thin, display-ready helpers.
// ─────────────────────────────────────────────────────────────────────────────

export const STABLE_CHAINS = [
  "Ethereum",
  "Base",
  "Arbitrum",
  "Optimism",
  "Polygon",
  "Avalanche",
  "Unichain",
  "Linea",
  "Sonic",
  "Worldchain",
  "Codex",
] as const;

export type StableChain = (typeof STABLE_CHAINS)[number];

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

// Minimal structural view of the SDK surface we use.
interface StableRoute {
  corridor?: unknown;
  estimatedDuration?: unknown;
  estimatedTotalCost?: unknown;
  fees?: unknown[];
  requiresMessageSignature?: boolean;
}
interface RoutesResult {
  all: StableRoute[];
  fastest: StableRoute;
  cheapest: StableRoute;
}
interface ExecuteResult {
  transferHash?: string;
  transactions?: { hash?: string }[];
}
interface StableSdkInstance {
  findRoutes(intent: {
    sourceChain: string;
    targetChain: string;
    amount: string;
    sender: string;
    recipient: string;
    paymentToken?: "usdc";
    usePermit?: boolean;
  }): Promise<RoutesResult>;
  checkHasEnoughFunds(route: StableRoute): Promise<boolean>;
  executeRoute(route: StableRoute): Promise<ExecuteResult>;
}
type StableSdkCtor = new (opts: {
  network: "Mainnet" | "Testnet";
  signer: unknown;
  rpcUrls?: Record<string, string>;
}) => StableSdkInstance;

/** Signer that routes signing through the connected browser wallet. */
function injectedSigner(provider: Eip1193, address: `0x${string}`) {
  return {
    platform: "Evm" as const,
    getWalletClient: async (viemChain: Chain) =>
      createWalletClient({
        account: address as unknown as Account,
        chain: viemChain,
        transport: custom(provider),
      }),
  };
}

export async function createStableSdk(
  provider: Eip1193,
  address: `0x${string}`,
  network: "Mainnet" | "Testnet" = "Mainnet",
): Promise<StableSdkInstance> {
  const mod = (await import("@stable-io/sdk")) as unknown as { default: StableSdkCtor };
  const Ctor = mod.default;
  return new Ctor({ network, signer: injectedSigner(provider, address) });
}

export interface RouteView {
  kind: "fastest" | "cheapest";
  corridor: string;
  duration: string;
  cost: string;
  requiresSignature: boolean;
  route: StableRoute;
}

function human(x: unknown): string {
  if (x == null) return "—";
  try {
    const s = String(x);
    return s && s !== "[object Object]" ? s : "—";
  } catch {
    return "—";
  }
}

export interface StableQuote {
  fastest: RouteView;
  cheapest: RouteView;
  sameRoute: boolean;
}

export async function findUsdcRoutes(
  sdk: StableSdkInstance,
  params: {
    sourceChain: StableChain;
    targetChain: StableChain;
    amount: string;
    sender: `0x${string}`;
    recipient: `0x${string}`;
    gasless: boolean;
  },
): Promise<StableQuote> {
  const res = await sdk.findRoutes({
    sourceChain: params.sourceChain,
    targetChain: params.targetChain,
    amount: params.amount,
    sender: params.sender,
    recipient: params.recipient,
    paymentToken: params.gasless ? "usdc" : undefined,
    usePermit: true,
  });
  const view = (r: StableRoute, kind: "fastest" | "cheapest"): RouteView => ({
    kind,
    corridor: human(r.corridor),
    duration: human(r.estimatedDuration),
    cost: human(r.estimatedTotalCost),
    requiresSignature: Boolean(r.requiresMessageSignature),
    route: r,
  });
  return {
    fastest: view(res.fastest, "fastest"),
    cheapest: view(res.cheapest, "cheapest"),
    sameRoute: res.fastest === res.cheapest,
  };
}

export async function executeUsdcRoute(
  sdk: StableSdkInstance,
  route: StableRoute,
): Promise<{ ok: boolean; hash?: string; reason?: string }> {
  const funded = await sdk.checkHasEnoughFunds(route).catch(() => true);
  if (!funded) return { ok: false, reason: "Insufficient USDC/gas on the source chain." };
  const result = await sdk.executeRoute(route);
  const hash = result.transferHash ?? result.transactions?.[0]?.hash;
  return { ok: true, hash };
}
