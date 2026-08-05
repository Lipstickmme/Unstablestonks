"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount, useBalance, usePublicClient, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { format } from "date-fns";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ContractWarning } from "@/components/ContractWarning";
import { SuccessToast } from "@/components/SuccessToast";
import { CONTRACT_ADDRESS, formatEther, isValidContractAddress, type EventData } from "@/lib/contract";
import { fetchBetLogs, fetchUserBetsFromContract } from "@/lib/fetchActivity";
import { BIG_MARKET_ABI } from "@/lib/abi";

type PortfolioEvent = {
  id: number;
  title: string;
  endTime: bigint;
  resolved: boolean;
  outcomes: readonly string[];
  pools: readonly bigint[];
  totalPool: bigint;
  winningOutcome: bigint;
  totalStaked: bigint;
  outcomeBreakdown: Record<number, bigint>;
  result: "Open" | "Won" | "Lost";
  estimatedPayout: bigint;
  claimed: boolean;
};

function normalizeEvent(data: unknown): EventData {
  if (Array.isArray(data)) {
    const [title, category, imageData, context, endTime, outcomes, pools, totalPool, resolved, winningOutcome, creator] = data;
    return { title, category, imageData, context, endTime, outcomes, pools, totalPool, resolved, winningOutcome, creator: creator as `0x${string}` };
  }
  return data as EventData;
}

function toErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/rate limit|429|too many requests/i.test(msg)) return "Rate limited. Try again in a moment.";
  if (/block range|query returned more than|too many logs/i.test(msg) && msg.includes("NEXT_PUBLIC")) return msg;
  if (/block range|query returned more than|too many logs/i.test(msg)) return "Block range too large. Set NEXT_PUBLIC_EVENT_LOG_START_BLOCK in Vercel to the block number when your contract was first used (e.g. first event creation).";
  return "Could not load activity. Try again.";
}

export default function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance({ address, query: { enabled: !!address } });
  const publicClient = usePublicClient();
  const [portfolioEvents, setPortfolioEvents] = useState<PortfolioEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<{ message: string; txHash?: string } | null>(null);
  const [claimingEventId, setClaimingEventId] = useState<number | null>(null);

  const { data: claimHash, writeContract: claimPayout, isPending: isClaiming } = useWriteContract();
  const { isLoading: isClaimConfirming, isSuccess: claimSuccess } = useWaitForTransactionReceipt({ hash: claimHash });
  const { data: userStats } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "getUserStats",
    args: [address || "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: 15000 },
  });
  const { data: referralStats } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "getReferralStats",
    args: [address || "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: 15000 },
  });

  useEffect(() => {
    if (claimSuccess && claimHash) {
      setSuccessToast({ message: "Payout claimed.", txHash: claimHash });
      setClaimingEventId(null);
      setTimeout(() => window.location.reload(), 2000);
    }
  }, [claimSuccess, claimHash]);

  useEffect(() => {
    if (!address || !publicClient || !isValidContractAddress()) {
      if (!address) setPortfolioEvents([]);
      return;
    }
    let cancelled = false;
    setError(null);
    setIsLoading(true);

    (async () => {
      try {
        let logs: { eventId: number; user: `0x${string}`; outcome: number; amount: bigint }[];
        try {
          logs = await fetchBetLogs(publicClient, { user: address });
        } catch {
          logs = await fetchUserBetsFromContract(publicClient, address);
        }
        if (cancelled) return;
        if (logs.length === 0) {
          const fallback = await fetchUserBetsFromContract(publicClient, address);
          if (cancelled) return;
          logs = fallback;
        }
        if (logs.length === 0) {
          setPortfolioEvents([]);
          return;
        }

        const perEvent = new Map<number, { total: bigint; outcomes: Map<number, bigint> }>();
        for (const { eventId, outcome, amount } of logs) {
          const e = perEvent.get(eventId) ?? { total: 0n, outcomes: new Map<number, bigint>() };
          e.total += amount;
          e.outcomes.set(outcome, (e.outcomes.get(outcome) ?? 0n) + amount);
          perEvent.set(eventId, e);
        }

        const eventIds = Array.from(perEvent.keys());
        const [eventData, claims] = await Promise.all([
          Promise.all(
            eventIds.map((id) =>
              publicClient
                .readContract({
                  address: CONTRACT_ADDRESS,
                  abi: BIG_MARKET_ABI,
                  functionName: "getEvent",
                  args: [BigInt(id)],
                })
                .then(normalizeEvent)
                .catch(() => null)
            )
          ),
          Promise.all(
            eventIds.map((id) =>
              publicClient
                .readContract({
                  address: CONTRACT_ADDRESS,
                  abi: BIG_MARKET_ABI,
                  functionName: "claimed",
                  args: [BigInt(id), address],
                })
                .then((c) => c as boolean)
                .catch(() => false)
            )
          ),
        ]);

        const portfolio: PortfolioEvent[] = eventIds
          .map((id, idx) => {
            const event = eventData[idx];
            const totals = perEvent.get(id);
            if (!event || !totals) return null;
            const outcomeBreakdown: Record<number, bigint> = {};
            totals.outcomes.forEach((v, k) => (outcomeBreakdown[k] = v));
            const winningIndex = Number(event.winningOutcome);
            const userWinning = outcomeBreakdown[winningIndex] ?? 0n;
            const winningPool = event.pools[winningIndex] ?? 0n;
            const estimatedPayout =
              event.resolved && userWinning > 0n && winningPool > 0n
                ? (event.totalPool * userWinning) / winningPool
                : 0n;
            const result: "Open" | "Won" | "Lost" = !event.resolved ? "Open" : userWinning > 0n ? "Won" : "Lost";
            return {
              id,
              title: event.title,
              endTime: event.endTime,
              resolved: event.resolved,
              outcomes: event.outcomes,
              pools: event.pools,
              totalPool: event.totalPool,
              winningOutcome: event.winningOutcome,
              totalStaked: totals.total,
              outcomeBreakdown,
              result,
              estimatedPayout,
              claimed: claims[idx],
            };
          })
          .filter((e): e is PortfolioEvent => e !== null);

        portfolio.sort((a, b) => Number(b.endTime - a.endTime));
        if (!cancelled) setPortfolioEvents(portfolio);
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [address, publicClient]);

  const summary = useMemo(() => {
    const totalStaked = portfolioEvents.reduce((s, e) => s + e.totalStaked, 0n);
    const claimable = portfolioEvents.reduce(
      (s, e) => (e.resolved && e.estimatedPayout > 0n && !e.claimed ? s + e.estimatedPayout : s),
      0n
    );
    return {
      totalStaked,
      claimable,
      open: portfolioEvents.filter((e) => !e.resolved).length,
      won: portfolioEvents.filter((e) => e.result === "Won").length,
      lost: portfolioEvents.filter((e) => e.result === "Lost").length,
    };
  }, [portfolioEvents]);

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 py-12">
          <p className="text-center text-neutral-400">Connect your wallet to view your portfolio.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <ContractWarning />
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 font-heading">Portfolio</h1>
          <p className="text-sm text-neutral-400 mt-1">Your stakes and results</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <p className="text-xs text-neutral-400 uppercase tracking-wider">Balance</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-white mt-1">{balance ? formatEther(balance.value) : "0"} POL</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <p className="text-xs text-neutral-400 uppercase tracking-wider">Staked</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-white mt-1">{formatEther(summary.totalStaked)} POL</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <p className="text-xs text-amber-400 uppercase tracking-wider">Claimable</p>
            <p className="text-xl font-semibold text-amber-400 mt-1">{formatEther(summary.claimable)} POL</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <p className="text-xs text-neutral-400 uppercase tracking-wider">Open / Won / Lost</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-white mt-1">{summary.open} / {summary.won} / {summary.lost}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <p className="text-xs text-neutral-400 uppercase tracking-wider">My Points</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-white mt-1">
              {Array.isArray(userStats) ? (userStats[1] as bigint).toString() : "0"}
            </p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <p className="text-xs text-neutral-400 uppercase tracking-wider">Referral Pts / Users</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-white mt-1">
              {Array.isArray(referralStats) ? (referralStats[1] as bigint).toString() : "0"} / {Array.isArray(referralStats) ? Number(referralStats[2] as bigint) : 0}
            </p>
          </div>
        </div>

        {isLoading && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && error && (
          <div className="py-12 text-center">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {!isLoading && !error && portfolioEvents.length === 0 && (
          <div className="text-center py-16 border border-white/10 rounded-xl">
            <p className="text-neutral-400">No stakes yet.</p>
            <Link href="/" className="inline-block mt-4 px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg transition-colors">
              Browse events
            </Link>
          </div>
        )}

        {!isLoading && !error && portfolioEvents.length > 0 && (
          <div className="space-y-4">
            {portfolioEvents.map((event) => (
              <div key={event.id} className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link href={`/event/${event.id}`} className="text-gray-900 dark:text-white font-semibold hover:text-orange-400 transition-colors">
                      {event.title}
                    </Link>
                    <p className="text-xs text-neutral-500 mt-1">Ends {format(Number(event.endTime) * 1000, "PPp")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full ${
                        event.result === "Won"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : event.result === "Lost"
                          ? "bg-red-500/20 text-red-400"
                          : "bg-white/10 text-neutral-300"
                      }`}
                    >
                      {event.result}
                    </span>
                    {event.resolved && event.estimatedPayout > 0n && (
                      <span className={`text-xs px-2.5 py-1 rounded-full ${event.claimed ? "bg-white/10 text-neutral-400" : "bg-amber-500/20 text-amber-400"}`}>
                        {event.claimed ? "Claimed" : "Claimable"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-neutral-500 text-xs">Staked</p>
                    <p className="text-gray-900 dark:text-white font-medium">{formatEther(event.totalStaked)} POL</p>
                  </div>
                  <div>
                    <p className="text-neutral-500 text-xs">Outcomes</p>
                    <p className="text-neutral-300">
                      {Object.entries(event.outcomeBreakdown)
                        .map(([i, amt]) => `${event.outcomes[Number(i)]}: ${formatEther(amt)}`)
                        .join(" · ")}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500 text-xs">Est. payout</p>
                    <p className="text-amber-400 font-medium">{formatEther(event.estimatedPayout)} POL</p>
                  </div>
                </div>
                {event.resolved && event.estimatedPayout > 0n && !event.claimed && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <button
                      onClick={() => {
                        setClaimingEventId(event.id);
                        claimPayout({
                          address: CONTRACT_ADDRESS,
                          abi: BIG_MARKET_ABI,
                          functionName: "claimPayout",
                          args: [BigInt(event.id)],
                        });
                      }}
                      disabled={isClaiming || isClaimConfirming || claimingEventId !== event.id}
                      className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-black font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isClaiming || isClaimConfirming ? "Claiming…" : "Claim payout"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
      {successToast && <SuccessToast message={successToast.message} txHash={successToast.txHash} onClose={() => setSuccessToast(null)} />}
    </div>
  );
}
