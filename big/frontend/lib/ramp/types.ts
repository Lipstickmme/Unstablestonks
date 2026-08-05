// Fiat on-ramp / off-ramp abstraction.
//
// BIG had no fiat path at all: a user needed POL in a wallet before they could do
// anything. Every operator ends up integrating two or three providers (coverage and
// approval rates differ by country, and providers go down), so this models a *set* of
// providers behind one interface rather than hard-wiring a single widget.

import type { Address } from "viem";

export type RampDirection = "onramp" | "offramp";

export type RampProviderId = "transak" | "moonpay" | "mercuryo";

export type FiatCurrency = string;

export type RampAsset = {
  /** Provider-facing ticker, e.g. "USDT". */
  symbol: string;
  /** Provider-facing network name, e.g. "polygon" / "chiliz". */
  network: string;
  /** Token contract, omitted for native assets. */
  address?: Address;
  decimals: number;
};

export type RampQuoteRequest = {
  direction: RampDirection;
  fiatCurrency: FiatCurrency;
  /** For an on-ramp this is the fiat spend; for an off-ramp it is the crypto amount. */
  amount: number;
  asset: RampAsset;
  countryCode?: string;
};

export type RampQuote = {
  provider: RampProviderId;
  /** Fiat charged (on-ramp) or received (off-ramp). */
  fiatAmount: number;
  fiatCurrency: FiatCurrency;
  /** Crypto received (on-ramp) or sold (off-ramp). */
  cryptoAmount: number;
  cryptoSymbol: string;
  /** Everything the user pays on top of the spot rate, in fiat. */
  totalFee: number;
  /** Provider's quoted rate, fiat per unit of crypto. */
  rate: number;
  /** How long the quote is good for. */
  expiresAt?: number;
};

export type RampSessionRequest = {
  direction: RampDirection;
  walletAddress: Address;
  asset: RampAsset;
  fiatCurrency: FiatCurrency;
  amount: number;
  /** Correlates the provider's webhook back to a user. */
  referenceId: string;
  email?: string;
  countryCode?: string;
  redirectUrl?: string;
};

export type RampSession = {
  provider: RampProviderId;
  /** URL to open in an iframe or a new tab. */
  url: string;
  referenceId: string;
};

/** Normalised provider statuses — each provider spells these differently. */
export enum RampStatus {
  Created = "Created",
  AwaitingPayment = "AwaitingPayment",
  Processing = "Processing",
  Completed = "Completed",
  Failed = "Failed",
  Expired = "Expired",
  Refunded = "Refunded",
}

export type RampTransaction = {
  provider: RampProviderId;
  providerOrderId: string;
  referenceId: string;
  direction: RampDirection;
  status: RampStatus;
  fiatAmount: number;
  fiatCurrency: FiatCurrency;
  cryptoAmount: number;
  cryptoSymbol: string;
  walletAddress: Address;
  txHash?: string;
  createdAt: number;
  updatedAt: number;
};

export type RampProviderConfig = {
  id: RampProviderId;
  label: string;
  /** Public/publishable key. Safe in the browser. */
  apiKey?: string;
  /** Sandbox vs production. */
  environment: "staging" | "production";
  /** Chain ids this provider is configured for in this deployment. */
  supportedChainIds: number[];
  supportsOnramp: boolean;
  supportsOfframp: boolean;
};

export interface RampProvider {
  readonly id: RampProviderId;
  readonly label: string;
  supports(direction: RampDirection, chainId: number): boolean;
  /**
   * Build the hosted-widget URL. Returns a URL only — no secrets are used here, so this
   * is safe to call from the browser.
   */
  createSession(request: RampSessionRequest): RampSession;
  /**
   * Ask the provider what a trade would cost. Optional: not every provider exposes a
   * public quote endpoint, and the widget always shows its own final number.
   */
  getQuote?(request: RampQuoteRequest): Promise<RampQuote>;
  /** Map a provider's webhook body onto the normalised shape. Server-side only. */
  parseWebhook?(body: unknown): RampTransaction | null;
}
