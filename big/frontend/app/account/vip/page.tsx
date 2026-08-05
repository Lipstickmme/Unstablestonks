"use client";

import { formatEther } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { BIG_MARKET_ABI } from "@/lib/abi";
import { CONTRACT_ADDRESS, isValidContractAddress } from "@/lib/contract";
import {
  AFFILIATE_REVENUE_SHARE_BPS,
  calcRakeback,
  resolveTier,
  VIP_TIERS,
} from "@/lib/platform/vip";

/** The prediction market charges 2% on every stake. */
const HOUSE_EDGE_BPS = 200;

export default function VipPage() {
  const { address, isConnected } = useAccount();
  const enabled = isValidContractAddress() && isConnected;

  const { data: userStats } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "getUserStats",
    args: address ? [address] : undefined,
    query: { enabled },
  });

  const { data: referralStats } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "getReferralStats",
    args: address ? [address] : undefined,
    query: { enabled },
  });

  const [volumeRaw] = (userStats as [bigint, bigint, string] | undefined) ?? [0n, 0n, ""];
  const [referralVolumeRaw, , referredCount] =
    (referralStats as [bigint, bigint, bigint] | undefined) ?? [0n, 0n, 0n];

  const wagered = Number(formatEther(volumeRaw));
  const referredVolume = Number(formatEther(referralVolumeRaw));
  const progress = resolveTier(wagered);
  const rakeback = calcRakeback(wagered, HOUSE_EDGE_BPS, progress.tier);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold">VIP & rewards</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
        Wagering earns a tier. A tier pays back a share of the margin you generate.
      </p>

      <section className="mt-6 rounded-xl border border-gray-200 p-5 dark:border-white/10">
        <div className="flex items-baseline justify-between">
          <span
            className="text-lg font-semibold"
            style={{ color: progress.tier.accent }}
          >
            {progress.tier.name}
          </span>
          <span className="text-sm text-gray-500 dark:text-neutral-400">
            {wagered.toFixed(2)} wagered
          </span>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress.progress * 100}%`,
              backgroundColor: progress.tier.accent,
            }}
          />
        </div>

        <p className="mt-2 text-xs text-gray-500 dark:text-neutral-400">
          {progress.next
            ? `${progress.remaining.toFixed(2)} more to reach ${progress.next.name}`
            : "Top tier reached."}
        </p>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-gray-500 dark:text-neutral-400">Rakeback rate</dt>
            <dd className="font-semibold tabular-nums">
              {(progress.tier.rakebackBps / 100).toFixed(2)}%
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 dark:text-neutral-400">Rakeback earned</dt>
            <dd className="font-semibold tabular-nums">{rakeback.toFixed(4)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 dark:text-neutral-400">Referred volume</dt>
            <dd className="font-semibold tabular-nums">{referredVolume.toFixed(2)}</dd>
          </div>
        </dl>

        <p className="mt-3 text-[11px] text-gray-400">
          Rakeback is a share of gross gaming revenue, not of turnover — {HOUSE_EDGE_BPS / 100}%
          of every stake is the platform fee, and your tier returns a slice of that.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Tiers</h2>
        <div className="space-y-2">
          {VIP_TIERS.map((tier) => (
            <div
              key={tier.level}
              className={`rounded-xl border p-4 ${
                tier.level === progress.tier.level
                  ? "border-orange-500 bg-orange-500/5"
                  : "border-gray-200 dark:border-white/10"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-medium" style={{ color: tier.accent }}>
                  {tier.name}
                </span>
                <span className="text-xs tabular-nums text-gray-500 dark:text-neutral-400">
                  {tier.threshold.toLocaleString()}+ wagered
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">
                {tier.perks.join(" · ")}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 p-5 dark:border-white/10">
        <h2 className="text-sm font-semibold">Affiliate</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">
          You have referred {referredCount.toString()} bettor
          {referredCount === 1n ? "" : "s"} and earn{" "}
          {AFFILIATE_REVENUE_SHARE_BPS / 100}% of the revenue their bets generate. Sportsbook
          bets placed through this front end additionally credit its affiliate address on
          Azuro, which pays out separately.
        </p>
        {address && (
          <p className="mt-3 break-all rounded-lg bg-gray-50 p-2 font-mono text-[11px] dark:bg-white/5">
            {typeof window !== "undefined" ? window.location.origin : ""}?ref={address}
          </p>
        )}
      </section>
    </main>
  );
}
