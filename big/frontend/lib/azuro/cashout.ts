// Early cashout — settle an open bet before its games finish.
//
// This is table stakes for a modern sportsbook and BIG had no equivalent: a parimutuel
// pool locks a bettor in until resolution. Azuro prices a buy-back off the current odds,
// the bettor signs a CashOutOrder, and the relayer redeems the position.
//
// Flow:  precalculate (is it even offered?) -> quote -> sign -> submit -> poll

import type { Address, Hex } from "viem";

import {
  BET_ATTENTION,
  CASHOUT_DATA_TYPES,
  CASHOUT_TYPED_DATA_DOMAIN_NAME,
  CASHOUT_TYPED_DATA_DOMAIN_VERSION,
  getChainData,
} from "./config";
import { decimalToOdds } from "./odds";

export enum CashoutState {
  Open = "OPEN",
  Processing = "PROCESSING",
  Accepted = "ACCEPTED",
  Rejected = "REJECTED",
}

export type PrecalculatedCashouts = {
  margin: string;
  marginMin: string;
  availables: {
    conditionId: string;
    available: boolean;
    outcomes: { outcomeId: number; price: string }[];
  }[];
};

export type CashoutCalculation = {
  /** `${environment}_${account}_${betId}` — the handle you sign against. */
  calculationId: string;
  account: string;
  environment: string;
  tokenId: string;
  /** Raw bet-token units returned to the bettor. */
  cashoutAmount: string;
  /** 1e12-scaled odds the buy-back was priced at. */
  cashoutOdds: string;
  expiredAt: number;
  approveExpiredAt: number;
  isLive: boolean;
};

export type CashoutOrder = {
  id: string;
  state: CashoutState;
  txHash?: Hex;
  errorMessage?: string;
};

class AzuroCashoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AzuroCashoutError";
  }
}

const assertCashoutSupported = (chainId: number) => {
  const { contracts } = getChainData(chainId);

  if (!contracts.cashout || /^0x0+$/.test(contracts.cashout)) {
    throw new AzuroCashoutError(`Cashout is not deployed on chain ${chainId}`);
  }

  return contracts;
};

/**
 * Which of a bet's conditions can currently be bought back, and at what price. Call this
 * before showing a cashout button — availability flips as markets stop and restart.
 */
export const getPrecalculatedCashouts = async (
  chainId: number,
  conditionIds: string[],
): Promise<PrecalculatedCashouts | null> => {
  assertCashoutSupported(chainId);
  const { api } = getChainData(chainId);

  const response = await fetch(`${api}/cashout/get-available`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ conditionIds }),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new AzuroCashoutError(`Cashout availability failed: ${response.status}`);
  }

  return response.json() as Promise<PrecalculatedCashouts>;
};

/** A firm, time-boxed quote for one bet. Expires — re-quote if the bettor hesitates. */
export const getCashoutQuote = async (
  chainId: number,
  account: Address,
  graphBetId: string,
): Promise<CashoutCalculation | null> => {
  assertCashoutSupported(chainId);
  const { api, environment } = getChainData(chainId);

  const response = await fetch(`${api}/cashout/get-calculation`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ environment, betId: graphBetId, owner: account.toLowerCase() }),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new AzuroCashoutError(`Cashout quote failed: ${response.status}`);
  }

  const data = (await response.json()) as CashoutCalculation & { owner: string; betId: string };

  return { ...data, account: data.owner, tokenId: data.betId };
};

export type CashoutTypedDataParams = {
  chainId: number;
  account: Address;
  /** AzuroBet NFT id of the position being closed. */
  tokenId: string;
  /** Decimal string ("1.85") or raw 1e12-scaled bigint. */
  cashoutOdds: string | bigint;
  expiredAt: number;
  attention?: string;
};

export const getCashoutTypedData = ({
  chainId,
  account,
  tokenId,
  cashoutOdds,
  expiredAt,
  attention = BET_ATTENTION,
}: CashoutTypedDataParams) => {
  const contracts = assertCashoutSupported(chainId);

  return {
    account,
    domain: {
      name: CASHOUT_TYPED_DATA_DOMAIN_NAME,
      version: CASHOUT_TYPED_DATA_DOMAIN_VERSION,
      chainId,
      verifyingContract: contracts.cashout,
    },
    primaryType: "CashOutOrder" as const,
    types: CASHOUT_DATA_TYPES,
    message: {
      attention,
      chainId: BigInt(chainId),
      items: [
        {
          betId: BigInt(tokenId),
          bettingContract: contracts.core,
          minOdds: typeof cashoutOdds === "string" ? decimalToOdds(cashoutOdds) : cashoutOdds,
        },
      ],
      expiresAt: BigInt(expiredAt),
    },
  } as const;
};

export const createCashout = async (params: {
  chainId: number;
  calculationId: string;
  signature: Hex;
  attention?: string;
}): Promise<CashoutOrder> => {
  const contracts = assertCashoutSupported(params.chainId);
  const { api } = getChainData(params.chainId);

  const response = await fetch(`${api}/cashout/create`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      calculationId: params.calculationId,
      signature: {
        verifyingContract: contracts.cashout,
        bettingContract: contracts.core,
        attention: params.attention ?? BET_ATTENTION,
        chainId: params.chainId,
        ownerSignature: params.signature,
      },
    }),
  });

  if (!response.ok) {
    throw new AzuroCashoutError(`Cashout submission failed: ${response.status}`);
  }

  return response.json() as Promise<CashoutOrder>;
};

export const getCashout = async (chainId: number, orderId: string): Promise<CashoutOrder> => {
  const { api } = getChainData(chainId);
  const response = await fetch(`${api}/cashout/${orderId}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new AzuroCashoutError(`Cashout lookup failed: ${response.status}`);
  }

  return response.json() as Promise<CashoutOrder>;
};

/** Quote -> sign -> submit, for callers that just want the whole thing done. */
export const cashOutBet = async (params: {
  chainId: number;
  account: Address;
  graphBetId: string;
  signTypedData: (typedData: unknown) => Promise<Hex>;
}): Promise<CashoutOrder> => {
  const quote = await getCashoutQuote(params.chainId, params.account, params.graphBetId);

  if (!quote) {
    throw new AzuroCashoutError("Cashout is not available for this bet right now");
  }

  const signature = await params.signTypedData(
    getCashoutTypedData({
      chainId: params.chainId,
      account: params.account,
      tokenId: quote.tokenId,
      cashoutOdds: quote.cashoutOdds,
      expiredAt: quote.approveExpiredAt,
    }),
  );

  return createCashout({
    chainId: params.chainId,
    calculationId: quote.calculationId,
    signature,
  });
};

export { AzuroCashoutError };
