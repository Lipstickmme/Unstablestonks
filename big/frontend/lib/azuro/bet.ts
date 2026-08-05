// Placing bets on Azuro v3.
//
// The bettor never sends a transaction. They sign EIP-712 typed data, we hand the
// signature to Azuro's relayer, and the relayer submits it to Core. That is what makes
// live betting possible — the odds are only committed at relay time, and `minOdds` is the
// bettor's protection against movement in between.
//
// Flow:  quote (getBetCalculation) -> sign (getBetTypedData) -> submit (createBet)
//        -> poll (getBetOrder) until Accepted / Rejected

import type { Address, Hex } from "viem";

import {
  AFFILIATE_ADDRESS,
  BET_ATTENTION,
  BET_DATA_TYPES,
  COMBO_BET_DATA_TYPES,
  getChainData,
  TYPED_DATA_DOMAIN_NAME,
  TYPED_DATA_DOMAIN_VERSION,
} from "./config";
import { calcComboOdds, calcMinOdds } from "./odds";
import {
  type BetHistoryItem,
  type BetOrderResult,
  type BetOrderState,
  BetStatus,
  type BetClientData,
  type CreateBetResponse,
  GameState,
  type Selection,
} from "./types";

/** How long a signed order stays valid before the relayer must reject it. */
const ORDER_TTL_SECONDS = 60 * 5;

class AzuroBetError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AzuroBetError";

    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => null)) as (T & CreateBetResponse) | null;

  if (!response.ok) {
    throw new AzuroBetError(data?.errorMessage ?? `Status ${response.status}`, {
      cause: data?.error,
    });
  }

  return data as T;
};

// -- Quoting ------------------------------------------------------------------------

export type BetLimits = {
  /** undefined means the pool imposes no floor. */
  minBet: number | undefined;
  maxBet: number;
  maxPayout: string;
};

/**
 * Stake limits for a selection set. Pass the bettor's address — the pool's exposure to
 * that specific account changes the true maximum.
 */
export const getBetCalculation = async (
  chainId: number,
  selections: Selection[],
  account?: Address,
): Promise<BetLimits> => {
  const { api, environment } = getChainData(chainId);
  const body: Record<string, unknown> = {
    environment,
    bets: selections.map(({ conditionId, outcomeId }) => ({
      conditionId,
      outcomeId: Number(outcomeId),
    })),
  };

  if (account) {
    body.wallet = account;
  }

  const data = await postJson<{ response: BetLimits }>(`${api}/bet/calculation`, body);

  return data.response;
};

export type RelayerFee = {
  gasLimit: number;
  gasPrice: number;
  betTokenRate: number;
  gasPriceInBetToken: number;
  slippage: number;
  gasAmount: number;
  /** Raw bet-token units, to sign into clientData. */
  relayerFeeAmount: string;
  /** Human-readable amount, for the betslip. */
  beautyRelayerFeeAmount: string;
  symbol: string;
  decimals: number;
};

/**
 * What the bettor pays the relayer to submit the order. This is deducted from the stake,
 * so the betslip must show it before signing.
 */
export const getRelayerFee = async (chainId: number): Promise<RelayerFee> => {
  const { api, environment } = getChainData(chainId);
  const response = await fetch(`${api}/bet/gas-info?environment=${environment}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new AzuroBetError(`Relayer fee lookup failed: ${response.status}`);
  }

  return response.json() as Promise<RelayerFee>;
};

// -- Client data & typed data -------------------------------------------------------

export type BuildClientDataParams = {
  chainId: number;
  relayerFeeAmount: string;
  affiliate?: Address;
  /** Set when the stake is covered by a freebet. */
  isBetSponsored?: boolean;
  isFeeSponsored?: boolean;
  isSponsoredBetReturnable?: boolean;
  ttlSeconds?: number;
};

export const buildClientData = ({
  chainId,
  relayerFeeAmount,
  affiliate = AFFILIATE_ADDRESS,
  isBetSponsored = false,
  isFeeSponsored = false,
  isSponsoredBetReturnable = false,
  ttlSeconds = ORDER_TTL_SECONDS,
}: BuildClientDataParams): BetClientData => {
  const { contracts } = getChainData(chainId);

  return {
    attention: BET_ATTENTION,
    affiliate,
    core: contracts.core,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    chainId,
    relayerFeeAmount,
    isBetSponsored,
    isFeeSponsored,
    isSponsoredBetReturnable,
  };
};

const domainFor = (clientData: BetClientData) => ({
  name: TYPED_DATA_DOMAIN_NAME,
  version: TYPED_DATA_DOMAIN_VERSION,
  chainId: clientData.chainId,
  verifyingContract: clientData.core,
});

const toClientDataMessage = (clientData: BetClientData) => ({
  attention: clientData.attention,
  affiliate: clientData.affiliate,
  core: clientData.core,
  expiresAt: BigInt(clientData.expiresAt),
  chainId: BigInt(clientData.chainId),
  relayerFeeAmount: BigInt(clientData.relayerFeeAmount),
  isFeeSponsored: clientData.isFeeSponsored,
  isBetSponsored: clientData.isBetSponsored,
  isSponsoredBetReturnable: clientData.isSponsoredBetReturnable,
});

export type SingleBetInput = Selection & {
  /** Raw bet-token units. */
  amount: bigint;
  /** Raw 1e12-scaled floor price. */
  minOdds: bigint;
  nonce: bigint;
};

export const getBetTypedData = (
  account: Address,
  clientData: BetClientData,
  bet: SingleBetInput,
) =>
  ({
    account,
    domain: domainFor(clientData),
    primaryType: "ClientBetData" as const,
    types: BET_DATA_TYPES,
    message: {
      clientData: toClientDataMessage(clientData),
      bets: [
        {
          conditionId: BigInt(bet.conditionId),
          outcomeId: BigInt(bet.outcomeId),
          minOdds: bet.minOdds,
          amount: bet.amount,
          nonce: bet.nonce,
        },
      ],
    },
  }) as const;

export type ComboBetInput = {
  selections: Selection[];
  amount: bigint;
  minOdds: bigint;
  nonce: bigint;
};

export const getComboBetTypedData = (
  account: Address,
  clientData: BetClientData,
  bet: ComboBetInput,
) =>
  ({
    account,
    domain: domainFor(clientData),
    primaryType: "ClientComboBetData" as const,
    types: COMBO_BET_DATA_TYPES,
    message: {
      clientData: toClientDataMessage(clientData),
      minOdds: bet.minOdds,
      amount: bet.amount,
      nonce: bet.nonce,
      bets: bet.selections.map((selection) => ({
        conditionId: BigInt(selection.conditionId),
        outcomeId: BigInt(selection.outcomeId),
      })),
    },
  }) as const;

// -- Submission ---------------------------------------------------------------------

export const createBet = async (params: {
  account: Address;
  clientData: BetClientData;
  bet: SingleBetInput;
  signature: Hex;
  bonusId?: string;
}): Promise<CreateBetResponse> => {
  const { api, environment } = getChainData(params.clientData.chainId);
  const bettor = params.account.toLowerCase();

  return postJson<CreateBetResponse>(`${api}/bet/orders/ordinar`, {
    environment,
    bonusId: params.bonusId,
    bettor,
    betOwner: bettor,
    clientBetData: {
      clientData: params.clientData,
      bet: {
        conditionId: String(params.bet.conditionId),
        outcomeId: Number(params.bet.outcomeId),
        minOdds: String(params.bet.minOdds),
        amount: String(params.bet.amount),
        nonce: String(params.bet.nonce),
      },
    },
    bettorSignature: params.signature,
  });
};

export const createComboBet = async (params: {
  account: Address;
  clientData: BetClientData;
  bet: ComboBetInput;
  signature: Hex;
  bonusId?: string;
}): Promise<CreateBetResponse> => {
  const { api, environment } = getChainData(params.clientData.chainId);
  const bettor = params.account.toLowerCase();

  return postJson<CreateBetResponse>(`${api}/bet/orders/combo`, {
    environment,
    bonusId: params.bonusId,
    bettor,
    betOwner: bettor,
    clientBetData: {
      clientData: params.clientData,
      amount: String(params.bet.amount),
      minOdds: String(params.bet.minOdds),
      nonce: String(params.bet.nonce),
      bets: params.bet.selections.map((selection) => ({
        conditionId: String(selection.conditionId),
        outcomeId: Number(selection.outcomeId),
      })),
    },
    bettorSignature: params.signature,
  });
};

export const getBetOrder = async (
  chainId: number,
  orderId: string,
): Promise<CreateBetResponse> => {
  const { api } = getChainData(chainId);
  const response = await fetch(`${api}/bet/orders/${orderId}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new AzuroBetError(`Bet order lookup failed: ${response.status}`);
  }

  return response.json() as Promise<CreateBetResponse>;
};

export type GetBetsParams = {
  chainId: number;
  bettor: Address;
  affiliate?: Address;
  state?: BetOrderState[];
  result?: BetOrderResult[];
  isRedeemed?: boolean;
  offset?: number;
  limit?: number;
};

export const getBetsByBettor = async (params: GetBetsParams): Promise<BetHistoryItem[]> => {
  const { api, environment } = getChainData(params.chainId);
  const search = new URLSearchParams();

  search.set("environment", environment);
  search.set("offset", String(params.offset ?? 0));
  search.set("limit", String(params.limit ?? 100));
  params.state?.forEach((state) => search.append("states", state));
  params.result?.forEach((result) => search.append("result", result));

  if (params.affiliate) {
    search.set("affiliate", params.affiliate);
  }

  if (params.isRedeemed !== undefined) {
    search.set("isRedeemed", String(params.isRedeemed));
  }

  const response = await fetch(`${api}/bet/orders/bettor/${params.bettor}?${search}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new AzuroBetError(`Bet history lookup failed: ${response.status}`);
  }

  const data = (await response.json()) as { orders?: BetHistoryItem[] };

  return data.orders ?? [];
};

// -- Status -------------------------------------------------------------------------

/**
 * Collapse the relayer's order state and the game states into the single status a bettor
 * should see. A bet whose games have all finished but which has not settled yet is
 * "pending resolution", not "resolved" — the distinction matters for cashout eligibility.
 */
export const getBetStatus = (bet: {
  orderState: BetOrderState | null;
  result?: BetOrderResult | null;
  selections: { game: { state: GameState; startsAt: string } }[];
}): BetStatus => {
  const { orderState, result, selections } = bet;

  if (orderState === "Rejected") {
    return BetStatus.Rejected;
  }

  if (orderState === "Canceled" || result === "Canceled") {
    return BetStatus.Canceled;
  }

  if (!orderState || orderState === "Created" || orderState === "Placed") {
    return BetStatus.Preparing;
  }

  if (orderState === "Settled" || result === "Won" || result === "Lost") {
    return BetStatus.Resolved;
  }

  const games = selections.map((selection) => selection.game);
  const hasLive = games.some((game) => game.state === GameState.Live);

  if (hasLive) {
    return BetStatus.Live;
  }

  const allFinished =
    games.length > 0 &&
    games.every(
      (game) => game.state === GameState.Finished || game.state === GameState.Canceled,
    );

  if (allFinished) {
    return BetStatus.PendingResolution;
  }

  return BetStatus.Accepted;
};

// -- One-call helper ----------------------------------------------------------------

export type PlaceBetParams = {
  chainId: number;
  account: Address;
  selections: (Selection & { odds: number })[];
  /** Raw bet-token units. */
  amount: bigint;
  /** Percent, e.g. 5 for 5%. */
  slippage?: number;
  bonusId?: string;
  affiliate?: Address;
  signTypedData: (typedData: unknown) => Promise<Hex>;
};

/**
 * Quote -> sign -> submit, for either a single or a combo bet. The caller supplies the
 * signer so this stays usable from wagmi, viem, or a smart-account SDK alike.
 */
export const placeBet = async (params: PlaceBetParams): Promise<CreateBetResponse> => {
  const { chainId, account, selections, amount, slippage = 5, bonusId, affiliate } = params;

  if (!selections.length) {
    throw new AzuroBetError("placeBet: no selections");
  }

  const conditionIds = new Set(selections.map((selection) => selection.conditionId));

  if (conditionIds.size !== selections.length) {
    throw new AzuroBetError("placeBet: a combo cannot hold two outcomes of the same condition");
  }

  const fee = await getRelayerFee(chainId);
  const clientData = buildClientData({
    chainId,
    relayerFeeAmount: fee.relayerFeeAmount,
    affiliate,
    isBetSponsored: Boolean(bonusId),
    isFeeSponsored: Boolean(bonusId),
  });

  // A nonce only has to be unique per bettor; millisecond time is enough and keeps the
  // betslip stateless.
  const nonce = BigInt(Date.now());

  if (selections.length === 1) {
    const [selection] = selections;
    const bet: SingleBetInput = {
      conditionId: selection.conditionId,
      outcomeId: selection.outcomeId,
      amount,
      minOdds: calcMinOdds(selection.odds, slippage),
      nonce,
    };
    const signature = await params.signTypedData(getBetTypedData(account, clientData, bet));

    return createBet({ account, clientData, bet, signature, bonusId });
  }

  const comboOdds = calcComboOdds(selections.map((selection) => selection.odds));
  const bet: ComboBetInput = {
    selections: selections.map(({ conditionId, outcomeId }) => ({ conditionId, outcomeId })),
    amount,
    minOdds: calcMinOdds(comboOdds, slippage),
    nonce,
  };
  const signature = await params.signTypedData(getComboBetTypedData(account, clientData, bet));

  return createComboBet({ account, clientData, bet, signature, bonusId });
};

export { AzuroBetError };
