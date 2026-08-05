// Server-side ramp session creation.
//
// Two things have to happen off the browser: MoonPay requires the widget query string to
// be signed with the operator's secret key, and every session should be recorded so the
// provider's webhook can be matched back to a user later.

import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

import { rampAssetFor } from "@/lib/ramp";
import { availableProviders } from "@/lib/ramp/providers";
import type { RampDirection } from "@/lib/ramp/types";
import { recordSession } from "@/lib/ramp/store.server";

export const runtime = "nodejs";

type Body = {
  direction: RampDirection;
  chainId: number;
  walletAddress: `0x${string}`;
  amount: number;
  fiatCurrency: string;
  providerId?: string;
  email?: string;
  countryCode?: string;
  redirectUrl?: string;
};

/** MoonPay signs the query string with the secret key and appends the result. */
const signMoonPayUrl = (url: string): string => {
  const secret = process.env.MOONPAY_SECRET_KEY;

  if (!secret) {
    return url;
  }

  const parsed = new URL(url);
  const signature = createHmac("sha256", secret)
    .update(parsed.search)
    .digest("base64");

  parsed.searchParams.set("signature", signature);

  return parsed.toString();
};

export async function POST(request: Request) {
  let body: Body;

  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(body.walletAddress)) {
    return NextResponse.json({ error: "A wallet address is required" }, { status: 400 });
  }

  if (!Number.isFinite(body.amount) || body.amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }

  const asset = rampAssetFor(body.chainId);

  if (!asset) {
    return NextResponse.json(
      { error: `No ramp asset is configured for chain ${body.chainId}` },
      { status: 400 },
    );
  }

  const candidates = availableProviders(body.direction, body.chainId);

  if (!candidates.length) {
    return NextResponse.json(
      { error: "No provider is configured for this network and direction" },
      { status: 503 },
    );
  }

  const provider =
    candidates.find((candidate) => candidate.id === body.providerId) ?? candidates[0];

  const referenceId = `big-${body.walletAddress.slice(2, 10).toLowerCase()}-${Date.now().toString(36)}`;

  const session = provider.createSession({
    direction: body.direction,
    walletAddress: body.walletAddress,
    asset,
    fiatCurrency: body.fiatCurrency,
    amount: body.amount,
    referenceId,
    email: body.email,
    countryCode: body.countryCode,
    redirectUrl: body.redirectUrl,
  });

  const url = provider.id === "moonpay" ? signMoonPayUrl(session.url) : session.url;

  await recordSession({
    referenceId,
    provider: provider.id,
    direction: body.direction,
    chainId: body.chainId,
    walletAddress: body.walletAddress,
    amount: body.amount,
    fiatCurrency: body.fiatCurrency,
    createdAt: Date.now(),
  });

  return NextResponse.json({ provider: provider.id, url, referenceId });
}
