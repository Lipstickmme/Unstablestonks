// Ramp webhooks.
//
// Providers call this to tell us an order moved. Every request is authenticated before
// the body is trusted — an unauthenticated deposit callback is how a platform gets
// credited for money that never arrived.
//
// Verification differs per provider:
//   Transak   JWT in the body, signed with the operator's access token
//   MoonPay   `Moonpay-Signature-V2` header, HMAC-SHA256 over `timestamp.body`
//   Mercuryo  `X-Mercuryo-Signature`, HMAC-SHA512 over the raw body

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { getRampProvider } from "@/lib/ramp/providers";
import type { RampProviderId } from "@/lib/ramp/types";
import { recordTransaction } from "@/lib/ramp/store.server";

export const runtime = "nodejs";

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
};

const verifyMoonPay = (rawBody: string, header: string | null): boolean => {
  const secret = process.env.MOONPAY_WEBHOOK_KEY;

  if (!secret || !header) {
    return false;
  }

  // Header looks like: t=1710000000,s=<hex>
  const parts = Object.fromEntries(
    header.split(",").map((part) => part.split("=").map((value) => value.trim())),
  ) as { t?: string; s?: string };

  if (!parts.t || !parts.s) {
    return false;
  }

  // Reject replays of an old, valid signature.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(parts.t));

  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");

  return safeEqual(expected, parts.s);
};

const verifyMercuryo = (rawBody: string, header: string | null): boolean => {
  const secret = process.env.MERCURYO_SIGN_KEY;

  if (!secret || !header) {
    return false;
  }

  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");

  return safeEqual(expected, header);
};

const verifyTransak = (rawBody: string): boolean => {
  const secret = process.env.TRANSAK_ACCESS_TOKEN;

  if (!secret) {
    return false;
  }

  // Transak posts `{ data: "<jwt>" }` signed HS256 with the access token.
  let token: string;

  try {
    token = (JSON.parse(rawBody) as { data?: string }).data ?? "";
  } catch {
    return false;
  }

  const [header, payload, signature] = token.split(".");

  if (!header || !payload || !signature) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return safeEqual(expected, signature);
};

const decodeTransakBody = (rawBody: string): unknown => {
  const token = (JSON.parse(rawBody) as { data?: string }).data ?? "";
  const payload = token.split(".")[1];

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
};

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: providerId } = await context.params;
  const provider = getRampProvider(providerId as RampProviderId);

  if (!provider?.parseWebhook) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const rawBody = await request.text();

  const verified =
    providerId === "transak"
      ? verifyTransak(rawBody)
      : providerId === "moonpay"
        ? verifyMoonPay(rawBody, request.headers.get("moonpay-signature-v2"))
        : providerId === "mercuryo"
          ? verifyMercuryo(rawBody, request.headers.get("x-mercuryo-signature"))
          : false;

  if (!verified) {
    // Do not leak whether the failure was a missing key or a bad signature.
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = providerId === "transak" ? decodeTransakBody(rawBody) : JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const transaction = provider.parseWebhook(body);

  if (!transaction) {
    // A payload we do not model is not an error on the provider's side; acknowledge it so
    // they stop retrying.
    return NextResponse.json({ ok: true, ignored: true });
  }

  await recordTransaction(transaction);

  return NextResponse.json({ ok: true });
}
