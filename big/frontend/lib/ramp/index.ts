// Fiat on-ramp / off-ramp.
//
//   types      the provider-agnostic interface every adapter implements
//   providers  Transak, MoonPay, Mercuryo adapters + the registry
//
// Session URLs are built here; anything needing a secret key (MoonPay's URL signature,
// webhook verification) lives in app/api/ramp/* so the secret never reaches the browser.

export * from "./types";
export * from "./providers";

import type { Address } from "viem";

import { getChainData } from "../azuro/config";
import { availableProviders, networkNameFor } from "./providers";
import type { RampAsset, RampDirection, RampSession } from "./types";

/**
 * The asset a user ramps into on a given chain: the same token the book settles bets in,
 * so money arrives ready to stake rather than needing a swap first.
 */
export const rampAssetFor = (chainId: number): RampAsset | null => {
  const network = networkNameFor(chainId);

  if (!network) {
    return null;
  }

  const { betToken } = getChainData(chainId);

  return {
    symbol: betToken.symbol,
    network,
    address: betToken.address,
    decimals: betToken.decimals,
  };
};

/** A stable id we can match a provider webhook back to a user and a deposit. */
export const newReferenceId = (walletAddress: Address): string =>
  `big-${walletAddress.slice(2, 10).toLowerCase()}-${Date.now().toString(36)}`;

export type StartRampParams = {
  direction: RampDirection;
  chainId: number;
  walletAddress: Address;
  amount: number;
  fiatCurrency: string;
  providerId?: string;
  email?: string;
  countryCode?: string;
  redirectUrl?: string;
};

/**
 * Open a ramp session with the requested provider, or the first one that can serve this
 * chain and direction.
 */
export const startRamp = (params: StartRampParams): RampSession => {
  const asset = rampAssetFor(params.chainId);

  if (!asset) {
    throw new Error(`No ramp asset configured for chain ${params.chainId}`);
  }

  const candidates = availableProviders(params.direction, params.chainId);

  if (!candidates.length) {
    throw new Error(
      `No ${params.direction === "onramp" ? "on-ramp" : "off-ramp"} provider is configured for this network`,
    );
  }

  const provider =
    candidates.find((candidate) => candidate.id === params.providerId) ?? candidates[0];

  return provider.createSession({
    direction: params.direction,
    walletAddress: params.walletAddress,
    asset,
    fiatCurrency: params.fiatCurrency,
    amount: params.amount,
    referenceId: newReferenceId(params.walletAddress),
    email: params.email,
    countryCode: params.countryCode,
    redirectUrl: params.redirectUrl,
  });
};
