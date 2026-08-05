"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useReadContracts, usePublicClient } from "wagmi";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SuccessToast } from "@/components/SuccessToast";
import { CONTRACT_ADDRESS, formatEther, parseEther, formatAddress, isValidContractAddress, type EventData, sanitizeErrorMessage } from "@/lib/contract";
import { fetchBetLogs, type BetLogEntryWithBlock } from "@/lib/fetchActivity";
import { bytesToDataUrl, hexToBytes } from "@/lib/imageCompression";
import { format } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { BIG_MARKET_ABI } from "@/lib/abi";

const COLORS = ["#ea580c", "#f97316", "#fbbf24", "#f59e0b", "#d97706", "#b45309"];

export default function EventPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = BigInt(Number(params.id));
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [betAmount, setBetAmount] = useState("");
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [winningOutcome, setWinningOutcome] = useState(0);
  const [successToast, setSuccessToast] = useState<{ message: string; txHash?: string } | null>(null);
  const [stakers, setStakers] = useState<{ address: string; total: bigint }[]>([]);
  const [stakerBalances, setStakerBalances] = useState<Record<string, bigint>>({});
  const [activityLogs, setActivityLogs] = useState<{ user: `0x${string}`; outcome: number; amount: bigint; blockNumber?: bigint; timestamp?: bigint }[]>([]);
  const [chartData, setChartData] = useState<{ time: number; [key: string]: number }[]>([]);
  const [isLoadingStakers, setIsLoadingStakers] = useState(false);
  const [stakersError, setStakersError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: eventData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "getEvent",
    args: [eventId],
    query: { refetchInterval: 10000 },
  });

  const { data: owner } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "owner",
  });

  const isOwner = owner && address && typeof owner === 'string' && address.toLowerCase() === owner.toLowerCase();
  const referralFromUrl = searchParams.get("ref");
  const validReferral = referralFromUrl && /^0x[a-fA-F0-9]{40}$/.test(referralFromUrl) ? (referralFromUrl as `0x${string}`) : undefined;

  const event = eventData as unknown as EventData | undefined;

  // Get user bets for all outcomes
  const userBetContracts = event
    ? event.outcomes.map((_, idx) => ({
        address: CONTRACT_ADDRESS,
        abi: BIG_MARKET_ABI as any,
        functionName: "bets" as const,
        args: [eventId, address || "0x", BigInt(idx)],
      }))
    : [];

  const { data: userBetsData } = useReadContracts({
    contracts: userBetContracts as any,
    query: { refetchInterval: 10000 },
  });

  const userBets = userBetsData?.map((r) => (r.status === 'success' ? (r.result as bigint) : 0n)) || [];

  const { data: hasClaimed } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "claimed",
    args: [eventId, address || "0x"],
    query: { enabled: !!address, refetchInterval: 10000 },
  });

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

  const { data: betHash, writeContract: placeBet, isPending: isBetting, error: betError } = useWriteContract();
  const { isLoading: isBetConfirming, isSuccess: betSuccess, error: betTxError } = useWaitForTransactionReceipt({ hash: betHash });

  const { data: claimHash, writeContract: claimPayout, isPending: isClaiming, error: claimError } = useWriteContract();
  const { isLoading: isClaimConfirming, isSuccess: claimSuccess, error: claimTxError } = useWaitForTransactionReceipt({ hash: claimHash });

  const { data: resolveHash, writeContract: resolveEvent, isPending: isResolving, error: resolveError } = useWriteContract();
  const { isLoading: isResolveConfirming, isSuccess: resolveSuccess, error: resolveTxError } = useWaitForTransactionReceipt({ hash: resolveHash });

  // V5 settles in two steps: a resolver proposes, a dispute window runs, then anyone can
  // finalise. `resolutions` carries that state.
  const { data: resolution, refetch: refetchResolution } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "getResolution",
    args: [eventId],
    query: { enabled: isValidContractAddress() },
  });

  useEffect(() => {
    if (betError) {
      alert(sanitizeErrorMessage(betError));
    }
  }, [betError]);

  useEffect(() => {
    if (betTxError) {
      alert(sanitizeErrorMessage(betTxError));
    }
  }, [betTxError]);

  useEffect(() => {
    if (betSuccess && betHash) {
      setSuccessToast({ 
        message: "🎉 Stake placed successfully! Your prediction is now live on the blockchain!", 
        txHash: betHash 
      });
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    }
  }, [betSuccess, betHash]);

  useEffect(() => {
    if (claimError) {
      alert(sanitizeErrorMessage(claimError));
    }
  }, [claimError]);

  useEffect(() => {
    if (claimTxError) {
      alert(sanitizeErrorMessage(claimTxError));
    }
  }, [claimTxError]);

  useEffect(() => {
    if (claimSuccess && claimHash) {
      setSuccessToast({ 
        message: "💰 Payout claimed! Your winnings have been sent to your wallet!", 
        txHash: claimHash 
      });
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    }
  }, [claimSuccess, claimHash]);

  useEffect(() => {
    if (resolveError) {
      alert(sanitizeErrorMessage(resolveError));
    }
  }, [resolveError]);

  useEffect(() => {
    if (resolveTxError) {
      alert(sanitizeErrorMessage(resolveTxError));
    }
  }, [resolveTxError]);

  useEffect(() => {
    if (resolveSuccess && resolveHash) {
      setSuccessToast({
        message: "✅ Result submitted! Payouts open once the dispute window closes.",
        txHash: resolveHash,
      });
      refetchResolution();
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    }
  }, [resolveSuccess, resolveHash, refetchResolution]);

  // Build chart from current contract state (always works)
  useEffect(() => {
    if (!event?.outcomes?.length || event.totalPool === 0n) return;
    const now = Math.floor(Date.now() / 1000);
    const endTime = Number(event.endTime);
    // Create two points: market open (endTime minus some duration) and now
    const startTime = endTime > now ? now - 3600 : endTime - 86400;
    const pts: { time: number; [key: string]: number }[] = [];
    for (const t of [startTime, now]) {
      const p: { time: number; [key: string]: number } = { time: t };
      event.outcomes.forEach((_, i) => {
        p[`outcome${i}`] = event.totalPool > 0n ? Number((event.pools[i] * 10000n) / event.totalPool) / 100 : 0;
      });
      pts.push(p);
    }
    setChartData(pts);
  }, [event?.outcomes?.length, event?.totalPool, event?.endTime]);

  // Fetch stakers and activity from logs, with contract-read fallback
  useEffect(() => {
    if (!publicClient || !isValidContractAddress() || !event?.outcomes?.length) {
      if (!isValidContractAddress()) setStakersError("Invalid contract configuration");
      setIsLoadingStakers(false);
      return;
    }
    let cancelled = false;
    setStakersError(null);
    setIsLoadingStakers(true);

    (async () => {
      try {
        let logs: { eventId: number; user: `0x${string}`; outcome: number; amount: bigint }[] = [];

        // Try logs with progressively smaller ranges, then fall back to empty
        try {
          logs = await fetchBetLogs(publicClient, { eventId }, { maxBlockRange: 10n, maxLookback: 500n });
        } catch {
          try {
            logs = await fetchBetLogs(publicClient, { eventId }, { maxBlockRange: 5n, maxLookback: 100n });
          } catch {
            // Logs failed entirely; activity/stakers will show "from contract" pools only
            logs = [];
          }
        }
        if (cancelled) return;

        if (logs.length > 0) {
          const totals = new Map<string, bigint>();
          for (const { user, amount } of logs) {
            totals.set(user, (totals.get(user) ?? 0n) + amount);
          }
          const ranked = Array.from(totals.entries())
            .map(([addr, total]) => ({ address: addr, total }))
            .sort((a, b) => (a.total === b.total ? 0 : a.total > b.total ? -1 : 1))
            .slice(0, 25);
          if (!cancelled) {
            // Render stakers/activity immediately for low latency.
            setStakers(ranked);
            setActivityLogs([...logs].reverse());
          }
          // Fetch balances in background for only top entries.
          void (async () => {
            const balances = await Promise.all(
              ranked.slice(0, 12).map(async (e) => {
                try {
                  const b = await publicClient.getBalance({ address: e.address as `0x${string}` });
                  return [e.address, b] as const;
                } catch {
                  return [e.address, 0n] as const;
                }
              })
            );
            if (!cancelled) setStakerBalances(Object.fromEntries(balances));
          })();

          // Try to build time-series chart from logs
          try {
            const withBlock = logs as BetLogEntryWithBlock[];
            const sorted = [...withBlock].sort((a, b) =>
              a.blockNumber !== b.blockNumber ? Number(a.blockNumber - b.blockNumber) : a.logIndex - b.logIndex
            );
            const outcomeCount = event.outcomes.length;
            const pools = new Array(outcomeCount).fill(0n);
            let total = 0n;
            const pts: { time: number; [k: string]: number }[] = [];
            const fallbackStart = Math.floor(Date.now() / 1000) - Math.max(sorted.length, 2) * 30;
            for (let idx = 0; idx < sorted.length; idx++) {
              const log = sorted[idx];
              const outIdx = log.outcome;
              if (outIdx >= 0 && outIdx < pools.length) {
                pools[outIdx] += log.amount;
                total += log.amount;
              }
              const t = log.timestamp ? Number(log.timestamp) : fallbackStart + idx * 30;
              if (t > 0) {
                const pcts: { time: number; [k: string]: number } = { time: t };
                event.outcomes.forEach((_, i) => {
                  pcts[`outcome${i}`] = total > 0n ? Number((pools[i] * 10000n) / total) / 100 : 0;
                });
                pts.push(pcts);
              }
            }
            const now = Math.floor(Date.now() / 1000);
            const nowPcts: { time: number; [k: string]: number } = { time: now };
            event.outcomes.forEach((_, i) => {
              nowPcts[`outcome${i}`] = event.totalPool > 0n ? Number((event.pools[i] * 10000n) / event.totalPool) / 100 : 0;
            });
            pts.push(nowPcts);
            if (!cancelled && pts.length > 1) setChartData(pts);
          } catch {
            // Chart from logs failed - keep contract-based chart
          }
        } else {
          // No logs: show pool breakdown from contract as activity
          const contractActivity: { user: `0x${string}`; outcome: number; amount: bigint }[] = [];
          event.outcomes.forEach((_, idx) => {
            const pool = event.pools[idx];
            if (pool > 0n) {
              contractActivity.push({ user: "0x0000000000000000000000000000000000000000" as `0x${string}`, outcome: idx, amount: pool });
            }
          });
          if (!cancelled) {
            setActivityLogs(contractActivity);
            setStakers([]);
            setStakerBalances({});
          }
        }
      } catch (err) {
        if (!cancelled) {
          setStakersError(null); // Don't show error - chart still works from contract data
        }
      } finally {
        if (!cancelled) setIsLoadingStakers(false);
      }
    })();

    return () => { cancelled = true; };
  }, [publicClient, eventId, event?.outcomes?.length, refreshKey]);

  useEffect(() => {
    const interval = setInterval(() => setRefreshKey((k) => k + 1), 15000);
    return () => clearInterval(interval);
  }, []);

  if (!event) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 lg:px-6 py-8">
          <p className="py-12 text-center text-gray-500 dark:text-neutral-400">Event not found</p>
        </main>
      </div>
    );
  }

  const imageUrl =
    event.imageData && event.imageData !== "0x"
      ? bytesToDataUrl(hexToBytes(event.imageData))
      : null;

  const handlePlaceBet = () => {
    if (!isConnected) {
      alert("Please connect your wallet");
      return;
    }

    if (!betAmount || parseFloat(betAmount) <= 0) {
      alert("Please enter a valid bet amount");
      return;
    }

    if (event.resolved) {
      alert("Event is already resolved");
      return;
    }

    if (Date.now() / 1000 >= Number(event.endTime)) {
      alert("Event has ended");
      return;
    }

    placeBet({
      address: CONTRACT_ADDRESS,
      abi: BIG_MARKET_ABI,
      functionName: validReferral && (!address || validReferral.toLowerCase() !== address.toLowerCase()) ? "placeBetWithReferrer" : "placeBet",
      args:
        validReferral && (!address || validReferral.toLowerCase() !== address.toLowerCase())
          ? [eventId, BigInt(selectedOutcome), validReferral]
          : [eventId, BigInt(selectedOutcome)],
      value: parseEther(betAmount),
    });
  };

  const handleClaimPayout = () => {
    if (!isConnected) {
      alert("Please connect your wallet");
      return;
    }

    claimPayout({
      address: CONTRACT_ADDRESS,
      abi: BIG_MARKET_ABI,
      functionName: "claimPayout",
      args: [eventId],
    });
  };

  const handlePropose = () => {
    if (!isOwner) {
      alert("Only a resolver can propose a result");
      return;
    }

    resolveEvent({
      address: CONTRACT_ADDRESS,
      abi: BIG_MARKET_ABI,
      functionName: "proposeResolution",
      args: [eventId, BigInt(winningOutcome)],
    });
  };

  // Finalising is permissionless once the dispute window has passed — anyone can push a
  // settled market over the line, so payouts do not depend on the operator coming back.
  const handleFinalize = () => {
    resolveEvent({
      address: CONTRACT_ADDRESS,
      abi: BIG_MARKET_ABI,
      functionName: "finalizeResolution",
      args: [eventId],
    });
  };

  // 0 None, 1 Proposed, 2 Disputed, 3 Final — mirrors BigMarketV5.ResolutionState.
  const resolutionData = resolution as
    | {
        winningOutcome: bigint;
        finalizeAfter: bigint;
        state: number;
      }
    | undefined;
  const resolutionState = Number(resolutionData?.state ?? 0);
  const proposedOutcome = Number(resolutionData?.winningOutcome ?? 0n);
  const disputeSecondsLeft = resolutionData
    ? Math.max(0, Number(resolutionData.finalizeAfter) - Math.floor(Date.now() / 1000))
    : 0;

  const totalUserBet = userBets.reduce((sum, bet) => sum + bet, 0n);
  const winningOutcomeIndex = Number(event.winningOutcome);
  const winningPool = event.pools[winningOutcomeIndex] ?? 0n;
  const userWinningBet = event.resolved ? userBets[winningOutcomeIndex] ?? 0n : 0n;
  const estimatedPayout =
    event.resolved && event.totalPool > 0n && winningPool > 0n
      ? (event.totalPool * userWinningBet) / winningPool
      : 0n;
  const winningOutcomeLabel = event.outcomes[winningOutcomeIndex] ?? "Pending";
  const referralLink =
    address && typeof window !== "undefined"
      ? `${window.location.origin}/event/${params.id}?ref=${address}`
      : "";
  const userVolume = Array.isArray(userStats) ? (userStats[0] as bigint) : 0n;
  const userPoints = Array.isArray(userStats) ? (userStats[1] as bigint) : 0n;
  const userReferrer = Array.isArray(userStats) ? (userStats[2] as `0x${string}`) : undefined;
  const refVolume = Array.isArray(referralStats) ? (referralStats[0] as bigint) : 0n;
  const refPoints = Array.isArray(referralStats) ? (referralStats[1] as bigint) : 0n;
  const refUsers = Array.isArray(referralStats) ? Number(referralStats[2] as bigint) : 0;

  return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <Navbar />
      <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => router.back()}
            className="text-gray-600 dark:text-gray-400 hover:text-orange-600 dark:hover:text-orange-400"
          >
            ← Back
          </button>
          {isConnected && (isOwner === true || (address && address.toLowerCase() === event.creator.toLowerCase())) && !event.resolved && event.totalPool === 0n && (
            <Link
              href={`/edit/${params.id}`}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm"
            >
              Edit Event
            </Link>
          )}
        </div>

        {/* Two Column Layout - Polymarket Style */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Title Section */}
            <div className="flex items-start gap-4">
              {imageUrl && (
                <div className="w-24 h-24 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                  <img src={imageUrl} alt={event.title} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 leading-tight mb-2">{event.title}</h1>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {formatEther(event.totalPool)} POL Vol.
                </div>
              </div>
            </div>

            {event.resolved && (
              <div className="bg-gradient-to-r from-green-500/15 via-emerald-400/10 to-cyan-400/10 border border-green-200 dark:border-green-700 rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-300 text-sm font-semibold">
                  <span className="text-lg">🏁</span>
                  Event resolved
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="px-3 py-1 rounded-full bg-green-100 dark:bg-green-800/40 text-green-800 dark:text-green-200 text-xs font-semibold">
                    Winning outcome
                  </span>
                  <span className="text-lg font-semibold text-gray-900 dark:text-gray-50">{winningOutcomeLabel}</span>
                  <span className="text-xs px-2 py-1 rounded bg-gray-900 text-white dark:bg-white dark:text-gray-900">
                    Payouts open
                  </span>
                </div>
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  Total pool: <span className="font-semibold">{formatEther(event.totalPool)} POL</span>
                </div>
              </div>
            )}

            {/* Predicted Outcome */}
            {event.totalPool > 0n && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">PREDICTED</div>
                {(() => {
                  const maxPool = Math.max(...event.pools.map(p => Number(p)));
                  const maxIndex = event.pools.findIndex(p => Number(p) === maxPool);
                  const percentage = (maxPool / Number(event.totalPool)) * 100;
                  return (
                    <div className="text-2xl font-semibold text-blue-700 dark:text-blue-400">
                      {event.outcomes[maxIndex]} {percentage.toFixed(1)}%
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Polymarket-style probability chart (multi-line over time) */}
            {event.totalPool > 0n && (
              <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Market probability</h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-3">
                  {event.outcomes.map((outcome, idx) => {
                    const pct = Number(event.pools[idx]) / Number(event.totalPool) * 100;
                    return (
                      <span key={idx} className="flex items-center gap-1.5 text-gray-700 dark:text-neutral-400">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        {outcome} <span className="font-semibold text-gray-900 dark:text-white">{pct.toFixed(1)}%</span>
                      </span>
                    );
                  })}
                </div>
                {chartData.length > 0 ? (
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis
                          dataKey="time"
                          type="number"
                          domain={["dataMin", "dataMax"]}
                          tickFormatter={(ts) => format(new Date(ts * 1000), "MMM d")}
                          stroke="#9ca3af"
                          fontSize={11}
                        />
                        <YAxis domain={[0, 100]} unit="%" stroke="#9ca3af" fontSize={11} tickFormatter={(v) => `${v}%`} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
                          labelFormatter={(ts) => format(new Date(ts * 1000), "PPpp")}
                          formatter={(value: number) => [`${value.toFixed(1)}%`, ""]}
                        />
                        <Legend />
                        {event.outcomes.map((outcome, idx) => (
                          <Line
                            key={idx}
                            type="monotone"
                            dataKey={`outcome${idx}`}
                            name={outcome}
                            stroke={COLORS[idx % COLORS.length]}
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-32 flex items-center justify-center text-gray-500 dark:text-neutral-400 text-sm">
                    {isLoadingStakers ? "Loading chart…" : "No history yet"}
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-white/10 flex justify-between text-xs text-gray-500 dark:text-neutral-500">
                  <span>Total volume</span>
                  <span className="font-semibold text-gray-700 dark:text-neutral-300">{formatEther(event.totalPool)} POL</span>
                </div>
              </div>
            )}

            {/* Probability Breakdown - Simplified */}
            <div className="space-y-2">
              {event.outcomes.map((outcome, idx) => {
                const percentage = event.totalPool > 0n 
                  ? (Number(event.pools[idx]) / Number(event.totalPool)) * 100 
                  : 0;
                return (
                  <div key={idx} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <div 
                      className="w-3 h-3 rounded-full flex-shrink-0" 
                      style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                    />
                    <span className="text-gray-700 dark:text-gray-300 flex-1 font-medium">{outcome}</span>
                    <span className="text-gray-900 dark:text-gray-100 font-semibold">{percentage.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>

            {/* Context */}
            {event.context && (
              <div className="text-gray-700 dark:text-gray-300 text-sm whitespace-pre-wrap leading-relaxed">
                {event.context}
              </div>
            )}

            {/* Activity: who staked what (from contract logs, same as portfolio) */}
            <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Activity</h3>
                <div className="flex items-center gap-2">
                  {isLoadingStakers && (
                    <span className="inline-flex h-4 w-4 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
                  )}
                  {activityLogs.length > 0 && (
                    <span className="text-xs text-gray-500 dark:text-neutral-400 bg-gray-200 dark:bg-white/5 px-2.5 py-1 rounded-full">{activityLogs.length} stakes</span>
                  )}
                </div>
              </div>
              {activityLogs.length === 0 && isLoadingStakers ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="h-8 w-8 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
                  <p className="text-sm text-gray-500 dark:text-neutral-400">Syncing activity…</p>
                </div>
              ) : activityLogs.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500 dark:text-neutral-400">No activity yet. Refreshing automatically…</p>
              ) : (
                <ul className="space-y-2 max-h-80 overflow-y-auto">
                  {activityLogs.map((entry, idx) => (
                    <li key={idx} className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-white dark:bg-white/5 border border-gray-100 dark:border-white/5">
                      <span className="font-mono text-sm text-gray-800 dark:text-gray-200 truncate" title={entry.user}>{formatAddress(entry.user)}</span>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 shrink-0">{event.outcomes[entry.outcome] ?? `#${entry.outcome}`}</span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white shrink-0">{formatEther(entry.amount)} POL</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Stakers</h3>
                <div className="flex items-center gap-2">
                  {isLoadingStakers && (
                    <span className="inline-flex h-4 w-4 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
                  )}
                  {stakers.length > 0 && (
                    <span className="text-xs text-neutral-400 bg-white/5 px-2.5 py-1 rounded-full">Top {stakers.length}</span>
                  )}
                </div>
              </div>
              {stakers.length === 0 && isLoadingStakers ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="h-8 w-8 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
                  <p className="text-sm text-neutral-400">Syncing stakers…</p>
                </div>
              ) : stakers.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-400">No stakes yet. Refreshing automatically…</p>
              ) : (
                <div className="space-y-2">
                  {stakers.map((staker, idx) => (
                    <div key={staker.address} className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors border border-gray-100 dark:border-transparent">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-orange-600 dark:text-orange-400 text-xs font-semibold">{idx + 1}</span>
                        <span className="font-mono text-sm text-gray-900 dark:text-white truncate" title={staker.address}>{formatAddress(staker.address)}</span>
                      </div>
                      <div className="flex gap-4 shrink-0 text-right">
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatEther(staker.total)} POL</p>
                          <p className="text-xs text-gray-500 dark:text-neutral-500">Staked</p>
                        </div>
                        <div className="border-l border-gray-200 dark:border-white/10 pl-4">
                          <p className="text-sm text-gray-700 dark:text-neutral-300">{formatEther(stakerBalances[staker.address] ?? 0n)} POL</p>
                          <p className="text-xs text-gray-500 dark:text-neutral-500">Balance</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {stakers.length > 0 && (
                <p className="mt-4 pt-4 border-t border-gray-200 dark:border-white/10 text-xs text-gray-500 dark:text-neutral-500">On-chain balances; may update with a delay.</p>
              )}
            </div>
          </div>

          {/* Right Column - Trading Panel */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-4">
              {/* Trading Panel */}
              {!event.resolved && Date.now() / 1000 < Number(event.endTime) && isConnected ? (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    {imageUrl && (
                      <div className="w-8 h-8 rounded-md bg-gray-100 dark:bg-gray-700 overflow-hidden flex-shrink-0">
                        <img src={imageUrl} alt={event.title} className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {event.outcomes[selectedOutcome]}
                      </div>
                    </div>
                  </div>

                  {/* Stake Buttons */}
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {event.outcomes.map((outcome, idx) => {
                      const percentage = event.totalPool > 0n 
                        ? (Number(event.pools[idx]) / Number(event.totalPool)) * 100 
                        : 50;
                      const price = (100 - percentage).toFixed(1);
                      return (
                        <button
                          key={idx}
                          onClick={() => setSelectedOutcome(idx)}
                          className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                            selectedOutcome === idx
                              ? "bg-green-600 text-white"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                          }`}
                        >
                          {idx === 0 ? "Yes" : "No"} {price}¢
                        </button>
                      );
                    })}
                  </div>

                  {/* Amount Input */}
                  <div className="mb-4">
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Amount</label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={betAmount}
                      onChange={(e) => setBetAmount(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-gray-100 text-sm"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => setBetAmount("1")}
                        className="flex-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-300"
                      >
                        +1 POL
                      </button>
                      <button
                        onClick={() => setBetAmount("10")}
                        className="flex-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-300"
                      >
                        +10 POL
                      </button>
                      <button
                        onClick={() => setBetAmount("100")}
                        className="flex-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-300"
                      >
                        +100 POL
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={handlePlaceBet}
                    disabled={isBetting || isBetConfirming || !betAmount}
                    className="w-full px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isBetting || isBetConfirming ? "Predicting..." : "Predict Event"}
                  </button>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">2% platform fee applies</p>
                </div>
              ) : event.resolved ? (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm font-semibold mb-3">
                    <span>🎉</span> Winner locked in
                  </div>
                  <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">Winning outcome:</div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-3">{winningOutcomeLabel}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Total pool: <span className="font-semibold text-gray-900 dark:text-gray-100">{formatEther(event.totalPool)} POL</span>
                  </div>
                </div>
              ) : !isConnected ? (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-center shadow-sm">
                  <p className="text-sm text-gray-600 dark:text-gray-400">Connect wallet to place bets</p>
                </div>
              ) : null}

              {/* Referral + points */}
              {isConnected && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Referral & Points</h3>
                  {validReferral && (
                    <p className="text-xs text-green-700 dark:text-green-300">
                      Referral detected: {formatAddress(validReferral)}
                    </p>
                  )}
                  {userReferrer && userReferrer !== "0x0000000000000000000000000000000000000000" && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Your referrer: <span className="font-mono">{formatAddress(userReferrer)}</span>
                    </p>
                  )}
                  {referralLink && (
                    <div className="space-y-2">
                      <label className="text-xs text-gray-600 dark:text-gray-400">Your on-chain referral link</label>
                      <div className="flex gap-2">
                        <input
                          readOnly
                          value={referralLink}
                          className="flex-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        />
                        <button
                          onClick={() => navigator.clipboard.writeText(referralLink)}
                          className="px-2 py-1 text-xs rounded bg-orange-600 hover:bg-orange-700 text-white"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                      <p className="text-gray-500 dark:text-gray-400">Your volume</p>
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{formatEther(userVolume)} POL</p>
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                      <p className="text-gray-500 dark:text-gray-400">Your points</p>
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{userPoints.toString()}</p>
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                      <p className="text-gray-500 dark:text-gray-400">Referral volume</p>
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{formatEther(refVolume)} POL</p>
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                      <p className="text-gray-500 dark:text-gray-400">Referral points</p>
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{refPoints.toString()}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">{refUsers} users referred</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Your Bets */}
              {isConnected && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3 text-gray-900 dark:text-gray-100">Your Bets</h3>
            {totalUserBet > 0 ? (
              <div className="space-y-2 mb-4">
                {userBets.map((bet, idx) => 
                  bet > 0 ? (
                    <div key={idx} className="flex justify-between text-sm text-gray-700 dark:text-gray-300">
                      <span>{event.outcomes[idx]}:</span>
                      <span>{formatEther(bet)} POL</span>
                    </div>
                  ) : null
                )}
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between font-semibold text-gray-900 dark:text-gray-100">
                  <span>Total:</span>
                  <span>{formatEther(totalUserBet)} POL</span>
                </div>
                {event.resolved && userWinningBet > 0 && (
                  <div className="pt-2">
                    <div className="flex justify-between text-sm mb-2 text-gray-700 dark:text-gray-300">
                      <span>Estimated Payout:</span>
                      <span className="text-green-600 dark:text-green-400 font-semibold">{formatEther(estimatedPayout)} POL</span>
                    </div>
                    {!hasClaimed && (
                      <button
                        onClick={handleClaimPayout}
                        disabled={isClaiming || isClaimConfirming}
                        className="w-full mt-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
                      >
                        {isClaiming || isClaimConfirming ? "Claiming..." : "Claim Payout"}
                      </button>
                    )}
                    {hasClaimed === true && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">Payout already claimed</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-600 dark:text-gray-400 text-xs">No bets yet</p>
            )}
                </div>
              )}

              {/* Pending resolution — visible to everyone, since anyone can finalize. */}
              {!event.resolved && resolutionState === 1 && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
                  <h3 className="text-sm font-semibold mb-2 text-gray-900 dark:text-gray-100">Result proposed</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                    <span className="font-medium">{event.outcomes[proposedOutcome] ?? "—"}</span> has been
                    proposed as the winner. Payouts open once the dispute window closes.
                  </p>
                  {disputeSecondsLeft > 0 ? (
                    <p className="text-xs text-yellow-700 dark:text-yellow-300">
                      Dispute window closes in {Math.ceil(disputeSecondsLeft / 60)} minutes.
                    </p>
                  ) : (
                    <button
                      onClick={handleFinalize}
                      disabled={isResolving || isResolveConfirming}
                      className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      {isResolving || isResolveConfirming ? "Finalizing..." : "Finalize result"}
                    </button>
                  )}
                </div>
              )}

              {!event.resolved && resolutionState === 2 && (
                <div className="bg-white dark:bg-gray-800 border border-red-300 dark:border-red-800 rounded-lg p-4 shadow-sm">
                  <h3 className="text-sm font-semibold mb-2 text-red-600 dark:text-red-400">Result disputed</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    A challenge was bonded against the proposed result. An admin has to settle it
                    before payouts open.
                  </p>
                </div>
              )}

              {/* Propose a result - resolvers only */}
              {isOwner === true && !event.resolved && resolutionState === 0 && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3 text-gray-900 dark:text-gray-100">Propose result</h3>
                  {Date.now() / 1000 < Number(event.endTime) ? (
                    <div className="mb-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                      <p className="text-xs text-yellow-800 dark:text-yellow-200 font-medium mb-1">⚠️ Event has not ended yet</p>
                      <p className="text-xs text-yellow-700 dark:text-yellow-300">
                        End time: {format(new Date(Number(event.endTime) * 1000), "PPpp")}
                      </p>
                      <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                        The contract requires the end time to pass before resolution. You cannot resolve early.
                      </p>
                    </div>
                  ) : null}
                  <select
                    value={winningOutcome}
                    onChange={(e) => setWinningOutcome(Number(e.target.value))}
                    className="w-full px-3 py-2 mb-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-gray-100 text-sm"
                    disabled={Date.now() / 1000 < Number(event.endTime)}
                  >
                    {event.outcomes.map((outcome, idx) => (
                      <option key={idx} value={idx}>
                        {outcome}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handlePropose}
                    disabled={isResolving || isResolveConfirming || Date.now() / 1000 < Number(event.endTime)}
                    className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {isResolving || isResolveConfirming ? "Proposing..." : Date.now() / 1000 < Number(event.endTime) ? "Wait for end time" : "Propose result"}
                  </button>
                  {Date.now() / 1000 >= Number(event.endTime) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">
                      Event has ended. You can now resolve it.
                    </p>
                  )}
                </div>
              )}
              {/* Debug info for owner when resolve button is not showing */}
              {isOwner === true && event.resolved && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
                  <p className="text-xs text-gray-600 dark:text-gray-400 text-center">
                    ✅ Event is already resolved
                  </p>
                </div>
              )}
              {!isOwner && address && Date.now() / 1000 >= Number(event.endTime) && !event.resolved && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
                  <p className="text-xs text-gray-600 dark:text-gray-400 text-center">
                    Only the contract owner can resolve events. Your address: {formatAddress(address || "0x")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {successToast && (
          <SuccessToast
            message={successToast.message}
            txHash={successToast.txHash}
            onClose={() => setSuccessToast(null)}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

