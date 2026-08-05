"use client";

import { useMemo, useState } from "react";
import { formatUnits, parseEther, parseUnits } from "viem";
import { useAccount, useBalance, useReadContract, useWriteContract } from "wagmi";

import { useAzuroChainId, useBetToken } from "@/hooks/useAzuro";
import { ERC20_ABI, getChainData, WRAPPED_NATIVE_ABI } from "@/lib/azuro";
import { availableProviders } from "@/lib/ramp/providers";
import type { RampDirection } from "@/lib/ramp/types";

const FIAT_CURRENCIES = ["USD", "EUR", "GBP", "NGN", "BRL", "TRY", "INR"];

export default function WalletPage() {
  const chainId = useAzuroChainId();
  const betToken = useBetToken();
  const { address, isConnected } = useAccount();

  const [direction, setDirection] = useState<RampDirection>("onramp");
  const [amount, setAmount] = useState("100");
  const [fiat, setFiat] = useState("USD");
  const [providerId, setProviderId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providers = useMemo(
    () => availableProviders(direction, chainId),
    [direction, chainId],
  );

  const { data: nativeBalance } = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });

  const { data: tokenBalance, refetch: refetchToken } = useReadContract({
    address: betToken.address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { writeContractAsync } = useWriteContract();
  const [wrapAmount, setWrapAmount] = useState("");

  const chain = getChainData(chainId).chain;

  // Chiliz settles bets in WCHZ and Base in WETH, but wallets hold the native asset. If
  // the bet token wraps the gas token, we can do the conversion in-app instead of sending
  // the user to a DEX.
  const isWrappedNative =
    betToken.symbol.toUpperCase() === `W${chain.nativeCurrency.symbol.toUpperCase()}`;

  const openRamp = async () => {
    if (!address) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/ramp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          chainId,
          walletAddress: address,
          amount: Number(amount),
          fiatCurrency: fiat,
          providerId,
          redirectUrl: typeof window === "undefined" ? undefined : window.location.href,
        }),
      });

      const data = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !data.url) {
        throw new Error(data.error ?? "Could not open the payment provider");
      }

      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the payment provider");
    } finally {
      setBusy(false);
    }
  };

  const wrap = async (unwrap: boolean) => {
    setError(null);

    try {
      if (unwrap) {
        await writeContractAsync({
          address: betToken.address,
          abi: WRAPPED_NATIVE_ABI,
          functionName: "withdraw",
          args: [parseUnits(wrapAmount, betToken.decimals)],
        });
      } else {
        await writeContractAsync({
          address: betToken.address,
          abi: WRAPPED_NATIVE_ABI,
          functionName: "deposit",
          value: parseEther(wrapAmount),
        });
      }

      setWrapAmount("");
      await refetchToken();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transaction failed");
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold">Wallet</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
        Fund your account with a card or bank transfer, and cash out the same way.
      </p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
          <p className="text-xs text-gray-500 dark:text-neutral-400">
            {chain.nativeCurrency.symbol} (gas)
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {nativeBalance ? Number(nativeBalance.formatted).toFixed(4) : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
          <p className="text-xs text-gray-500 dark:text-neutral-400">
            {betToken.symbol} (betting balance)
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {tokenBalance !== undefined
              ? Number(formatUnits(tokenBalance as bigint, betToken.decimals)).toFixed(4)
              : "—"}
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 p-5 dark:border-white/10">
        <div className="mb-4 flex rounded-lg border border-gray-200 p-1 dark:border-white/10 sm:w-fit">
          {(["onramp", "offramp"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setDirection(option);
                setProviderId(undefined);
              }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                direction === option
                  ? "bg-orange-500 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-white/5"
              }`}
            >
              {option === "onramp" ? "Deposit" : "Withdraw"}
            </button>
          ))}
        </div>

        {!providers.length ? (
          <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
            No {direction === "onramp" ? "deposit" : "withdrawal"} provider is configured for{" "}
            {chain.name}. Set the provider keys in your environment to enable this.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setProviderId(provider.id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    (providerId ?? providers[0].id) === provider.id
                      ? "border-orange-500 bg-orange-500/15 text-orange-600 dark:text-orange-300"
                      : "border-gray-200 dark:border-white/10"
                  }`}
                >
                  {provider.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-white/10"
                placeholder={direction === "onramp" ? "Amount to spend" : "Amount to sell"}
              />
              <select
                value={fiat}
                onChange={(event) => setFiat(event.target.value)}
                className="rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-white/10"
              >
                {FIAT_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>

            <p className="mt-2 text-xs text-gray-500 dark:text-neutral-400">
              {direction === "onramp"
                ? `You will receive ${betToken.symbol} on ${chain.name}, ready to bet with.`
                : `Sells ${betToken.symbol} from ${chain.name} to your bank or card.`}
            </p>

            <button
              type="button"
              disabled={!isConnected || busy || !Number(amount)}
              onClick={openRamp}
              className="mt-3 w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy
                ? "Opening…"
                : isConnected
                  ? direction === "onramp"
                    ? "Continue to payment"
                    : "Continue to withdrawal"
                  : "Connect a wallet first"}
            </button>

            <p className="mt-2 text-[11px] text-gray-400">
              Payments are handled by the provider you pick. Identity checks, limits and
              settlement times are theirs, not ours.
            </p>
          </>
        )}
      </section>

      {isWrappedNative && (
        <section className="mt-6 rounded-xl border border-gray-200 p-5 dark:border-white/10">
          <h2 className="text-sm font-semibold">
            Convert {chain.nativeCurrency.symbol} ↔ {betToken.symbol}
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">
            Bets settle in {betToken.symbol}. Wrapping is 1:1 and reversible — the only
            cost is gas.
          </p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              inputMode="decimal"
              value={wrapAmount}
              onChange={(event) => setWrapAmount(event.target.value)}
              placeholder="0.0"
              className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-white/10"
            />
            <button
              type="button"
              disabled={!isConnected || !Number(wrapAmount)}
              onClick={() => wrap(false)}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Wrap
            </button>
            <button
              type="button"
              disabled={!isConnected || !Number(wrapAmount)}
              onClick={() => wrap(true)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold disabled:opacity-40 dark:border-white/10"
            >
              Unwrap
            </button>
          </div>
        </section>
      )}

      {error && (
        <p className="mt-4 break-words rounded-lg bg-red-500/10 p-3 text-sm text-red-500">
          {error}
        </p>
      )}
    </main>
  );
}
