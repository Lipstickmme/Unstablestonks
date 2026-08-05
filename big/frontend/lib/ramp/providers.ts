// Concrete on/off-ramp providers.
//
// Each one is a thin, honest adapter: it builds the hosted-widget URL from the operator's
// publishable key and normalises the provider's webhook vocabulary. No provider is
// enabled unless its key is configured, so a fresh checkout shows an accurate "not
// configured" state instead of a broken widget.

import { base, chiliz, polygon, polygonAmoy, spicy } from "viem/chains";

import {
  type RampProvider,
  type RampProviderConfig,
  type RampProviderId,
  type RampSession,
  type RampSessionRequest,
  RampStatus,
  type RampTransaction,
} from "./types";

const env = (key: string) => process.env[key] ?? "";

const RAMP_ENVIRONMENT: "staging" | "production" =
  process.env.NEXT_PUBLIC_RAMP_ENV === "production" ? "production" : "staging";

/** Provider-facing network names, which do not match viem's chain names. */
const NETWORK_BY_CHAIN: Record<number, string> = {
  [polygon.id]: "polygon",
  [polygonAmoy.id]: "polygon",
  [base.id]: "base",
  [chiliz.id]: "chiliz",
  [spicy.id]: "chiliz",
};

export const networkNameFor = (chainId: number): string | undefined =>
  NETWORK_BY_CHAIN[chainId];

// -- Transak ------------------------------------------------------------------------

class TransakProvider implements RampProvider {
  readonly id: RampProviderId = "transak";
  readonly label = "Transak";

  constructor(private readonly config: RampProviderConfig) {}

  supports(direction: "onramp" | "offramp", chainId: number): boolean {
    if (!this.config.apiKey || !this.config.supportedChainIds.includes(chainId)) {
      return false;
    }

    return direction === "onramp" ? this.config.supportsOnramp : this.config.supportsOfframp;
  }

  createSession(request: RampSessionRequest): RampSession {
    const host =
      this.config.environment === "production"
        ? "https://global.transak.com"
        : "https://global-stg.transak.com";

    const params = new URLSearchParams({
      apiKey: this.config.apiKey ?? "",
      productsAvailed: request.direction === "onramp" ? "BUY" : "SELL",
      cryptoCurrencyCode: request.asset.symbol,
      network: request.asset.network,
      walletAddress: request.walletAddress,
      fiatCurrency: request.fiatCurrency,
      partnerOrderId: request.referenceId,
      disableWalletAddressForm: "true",
    });

    if (request.direction === "onramp") {
      params.set("fiatAmount", String(request.amount));
    } else {
      params.set("cryptoAmount", String(request.amount));
    }

    if (request.email) {
      params.set("email", request.email);
    }

    if (request.countryCode) {
      params.set("countryCode", request.countryCode);
    }

    if (request.redirectUrl) {
      params.set("redirectURL", request.redirectUrl);
    }

    return { provider: this.id, url: `${host}?${params}`, referenceId: request.referenceId };
  }

  parseWebhook(body: unknown): RampTransaction | null {
    const payload = body as {
      eventID?: string;
      webhookData?: Record<string, unknown>;
    };
    const data = payload?.webhookData;

    if (!data) {
      return null;
    }

    const statusMap: Record<string, RampStatus> = {
      AWAITING_PAYMENT_FROM_USER: RampStatus.AwaitingPayment,
      PAYMENT_DONE_MARKED_BY_USER: RampStatus.Processing,
      PROCESSING: RampStatus.Processing,
      PENDING_DELIVERY_FROM_TRANSAK: RampStatus.Processing,
      ON_HOLD_PENDING_DELIVERY_FROM_TRANSAK: RampStatus.Processing,
      COMPLETED: RampStatus.Completed,
      CANCELLED: RampStatus.Failed,
      FAILED: RampStatus.Failed,
      REFUNDED: RampStatus.Refunded,
      EXPIRED: RampStatus.Expired,
    };

    return {
      provider: this.id,
      providerOrderId: String(data.id ?? ""),
      referenceId: String(data.partnerOrderId ?? ""),
      direction: data.isBuyOrSell === "SELL" ? "offramp" : "onramp",
      status: statusMap[String(data.status)] ?? RampStatus.Processing,
      fiatAmount: Number(data.fiatAmount ?? 0),
      fiatCurrency: String(data.fiatCurrency ?? ""),
      cryptoAmount: Number(data.cryptoAmount ?? 0),
      cryptoSymbol: String(data.cryptoCurrency ?? ""),
      walletAddress: String(data.walletAddress ?? "") as `0x${string}`,
      txHash: data.transactionHash ? String(data.transactionHash) : undefined,
      createdAt: Date.parse(String(data.createdAt ?? "")) || Date.now(),
      updatedAt: Date.now(),
    };
  }
}

// -- MoonPay ------------------------------------------------------------------------

class MoonPayProvider implements RampProvider {
  readonly id: RampProviderId = "moonpay";
  readonly label = "MoonPay";

  constructor(private readonly config: RampProviderConfig) {}

  supports(direction: "onramp" | "offramp", chainId: number): boolean {
    if (!this.config.apiKey || !this.config.supportedChainIds.includes(chainId)) {
      return false;
    }

    return direction === "onramp" ? this.config.supportsOnramp : this.config.supportsOfframp;
  }

  createSession(request: RampSessionRequest): RampSession {
    const isBuy = request.direction === "onramp";
    const subdomain = this.config.environment === "production" ? "buy" : "buy-sandbox";
    const host = isBuy
      ? `https://${subdomain}.moonpay.com`
      : `https://${subdomain.replace("buy", "sell")}.moonpay.com`;

    // MoonPay's currency codes fold the network into the ticker, e.g. "usdt_polygon".
    const currencyCode = `${request.asset.symbol}_${request.asset.network}`.toLowerCase();

    const params = new URLSearchParams({
      apiKey: this.config.apiKey ?? "",
      walletAddress: request.walletAddress,
      externalTransactionId: request.referenceId,
    });

    if (isBuy) {
      params.set("currencyCode", currencyCode);
      params.set("baseCurrencyCode", request.fiatCurrency.toLowerCase());
      params.set("baseCurrencyAmount", String(request.amount));
    } else {
      params.set("baseCurrencyCode", currencyCode);
      params.set("quoteCurrencyCode", request.fiatCurrency.toLowerCase());
      params.set("baseCurrencyAmount", String(request.amount));
    }

    if (request.email) {
      params.set("email", request.email);
    }

    if (request.redirectUrl) {
      params.set("redirectURL", request.redirectUrl);
    }

    // MoonPay wants the query string signed with the operator's secret key. That has to
    // happen server-side, so the wallet page routes through /api/ramp/session rather than
    // linking straight out. The URL below is the unsigned form the API route signs.
    return { provider: this.id, url: `${host}?${params}`, referenceId: request.referenceId };
  }

  parseWebhook(body: unknown): RampTransaction | null {
    const payload = body as { type?: string; data?: Record<string, unknown> };
    const data = payload?.data;

    if (!data) {
      return null;
    }

    const statusMap: Record<string, RampStatus> = {
      waitingPayment: RampStatus.AwaitingPayment,
      pending: RampStatus.Processing,
      waitingAuthorization: RampStatus.Processing,
      completed: RampStatus.Completed,
      failed: RampStatus.Failed,
    };

    const isSell = String(payload.type ?? "").startsWith("sell_transaction");

    return {
      provider: this.id,
      providerOrderId: String(data.id ?? ""),
      referenceId: String(data.externalTransactionId ?? ""),
      direction: isSell ? "offramp" : "onramp",
      status: statusMap[String(data.status)] ?? RampStatus.Processing,
      fiatAmount: Number(data.baseCurrencyAmount ?? 0),
      fiatCurrency: String(data.baseCurrencyId ?? ""),
      cryptoAmount: Number(data.quoteCurrencyAmount ?? 0),
      cryptoSymbol: String(data.currencyId ?? ""),
      walletAddress: String(data.walletAddress ?? "") as `0x${string}`,
      txHash: data.cryptoTransactionId ? String(data.cryptoTransactionId) : undefined,
      createdAt: Date.parse(String(data.createdAt ?? "")) || Date.now(),
      updatedAt: Date.now(),
    };
  }
}

// -- Mercuryo -----------------------------------------------------------------------

class MercuryoProvider implements RampProvider {
  readonly id: RampProviderId = "mercuryo";
  readonly label = "Mercuryo";

  constructor(private readonly config: RampProviderConfig) {}

  supports(direction: "onramp" | "offramp", chainId: number): boolean {
    if (!this.config.apiKey || !this.config.supportedChainIds.includes(chainId)) {
      return false;
    }

    return direction === "onramp" ? this.config.supportsOnramp : this.config.supportsOfframp;
  }

  createSession(request: RampSessionRequest): RampSession {
    const host =
      this.config.environment === "production"
        ? "https://exchange.mercuryo.io"
        : "https://sandbox-exchange.mrcr.io";

    const params = new URLSearchParams({
      widget_id: this.config.apiKey ?? "",
      type: request.direction === "onramp" ? "buy" : "sell",
      currency: request.asset.symbol,
      network: request.asset.network.toUpperCase(),
      address: request.walletAddress,
      merchant_transaction_id: request.referenceId,
      fiat_currency: request.fiatCurrency,
      amount: String(request.amount),
    });

    if (request.email) {
      params.set("email", request.email);
    }

    if (request.redirectUrl) {
      params.set("return_url", request.redirectUrl);
    }

    return { provider: this.id, url: `${host}/?${params}`, referenceId: request.referenceId };
  }

  parseWebhook(body: unknown): RampTransaction | null {
    const payload = body as { data?: Record<string, unknown> };
    const data = payload?.data;

    if (!data) {
      return null;
    }

    const statusMap: Record<string, RampStatus> = {
      new: RampStatus.Created,
      pending: RampStatus.Processing,
      paid: RampStatus.Processing,
      order_scheduled: RampStatus.Processing,
      succeeded: RampStatus.Completed,
      completed: RampStatus.Completed,
      cancelled: RampStatus.Failed,
      failed: RampStatus.Failed,
      descriptor_failed: RampStatus.Failed,
    };

    return {
      provider: this.id,
      providerOrderId: String(data.id ?? ""),
      referenceId: String(data.merchant_transaction_id ?? ""),
      direction: String(data.type) === "sell" ? "offramp" : "onramp",
      status: statusMap[String(data.status)] ?? RampStatus.Processing,
      fiatAmount: Number(data.fiat_amount ?? 0),
      fiatCurrency: String(data.fiat_currency ?? ""),
      cryptoAmount: Number(data.amount ?? 0),
      cryptoSymbol: String(data.currency ?? ""),
      walletAddress: String(data.address ?? "") as `0x${string}`,
      txHash: data.tx_id ? String(data.tx_id) : undefined,
      createdAt: Number(data.created_at ?? Date.now()),
      updatedAt: Date.now(),
    };
  }
}

// -- Registry -----------------------------------------------------------------------

const SUPPORTED_CHAINS = [polygon.id, polygonAmoy.id, base.id, chiliz.id, spicy.id];

export const RAMP_CONFIGS: RampProviderConfig[] = [
  {
    id: "transak",
    label: "Transak",
    apiKey: env("NEXT_PUBLIC_TRANSAK_API_KEY"),
    environment: RAMP_ENVIRONMENT,
    supportedChainIds: SUPPORTED_CHAINS,
    supportsOnramp: true,
    supportsOfframp: true,
  },
  {
    id: "moonpay",
    label: "MoonPay",
    apiKey: env("NEXT_PUBLIC_MOONPAY_API_KEY"),
    environment: RAMP_ENVIRONMENT,
    // MoonPay does not list Chiliz, so it is deliberately absent here rather than
    // offered and then failing at the widget.
    supportedChainIds: [polygon.id, polygonAmoy.id, base.id],
    supportsOnramp: true,
    supportsOfframp: true,
  },
  {
    id: "mercuryo",
    label: "Mercuryo",
    apiKey: env("NEXT_PUBLIC_MERCURYO_WIDGET_ID"),
    environment: RAMP_ENVIRONMENT,
    supportedChainIds: SUPPORTED_CHAINS,
    supportsOnramp: true,
    supportsOfframp: false,
  },
];

const build = (config: RampProviderConfig): RampProvider => {
  switch (config.id) {
    case "transak":
      return new TransakProvider(config);
    case "moonpay":
      return new MoonPayProvider(config);
    case "mercuryo":
      return new MercuryoProvider(config);
  }
};

export const RAMP_PROVIDERS: RampProvider[] = RAMP_CONFIGS.map(build);

export const getRampProvider = (id: RampProviderId): RampProvider | undefined =>
  RAMP_PROVIDERS.find((provider) => provider.id === id);

/** Providers that can actually serve this direction on this chain, right now. */
export const availableProviders = (
  direction: "onramp" | "offramp",
  chainId: number,
): RampProvider[] => RAMP_PROVIDERS.filter((provider) => provider.supports(direction, chainId));
