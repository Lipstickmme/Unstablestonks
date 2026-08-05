"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract, usePublicClient } from "wagmi";
import { readContract } from "wagmi/actions";
import { useConfig } from "wagmi";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ContractWarning } from "@/components/ContractWarning";
import { SuccessToast } from "@/components/SuccessToast";
import { CONTRACT_ADDRESS, CATEGORIES, type Category, type EventData, formatEther, isValidContractAddress, parseEther, sanitizeErrorMessage, formatAddress } from "@/lib/contract";
import { fetchRecentBetLogs, type BetLogEntry } from "@/lib/fetchActivity";
import { bytesToDataUrl, hexToBytes } from "@/lib/imageCompression";
import { format } from "date-fns";
import { BIG_MARKET_ABI } from "@/lib/abi";

const EVENTS_PER_PAGE = 10;

export default function HomePage() {
  const { address, isConnected } = useAccount();
  const [selectedCategory, setSelectedCategory] = useState<Category>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [eventsData, setEventsData] = useState<(EventData & { id: number })[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [hiddenEvents, setHiddenEvents] = useState<number[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showResolvedOnly, setShowResolvedOnly] = useState(false);
  const [quickBetAmount, setQuickBetAmount] = useState<Record<number, string>>({});
  const [quickBetOutcome, setQuickBetOutcome] = useState<Record<number, number>>({});
  const [activeBetEvent, setActiveBetEvent] = useState<number | null>(null);
  const [successToast, setSuccessToast] = useState<{ message: string; txHash?: string } | null>(null);
  const [recentActivity, setRecentActivity] = useState<BetLogEntry[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [unhiddenEvents, setUnhiddenEvents] = useState<number[]>([]);
  const config = useConfig();
  const publicClient = usePublicClient();

  const { data: eventCount, refetch: refetchEventCount, isLoading: isLoadingCount, error: countError } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "eventCount",
    query: { 
      enabled: isValidContractAddress(),
      refetchInterval: 5000, // Refetch every 5 seconds
    },
  });

  const { data: owner } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "owner",
    query: {
      enabled: isValidContractAddress(),
    },
  });

  const isOwner = !!(owner && address && typeof owner === "string" && owner.toLowerCase() === address.toLowerCase());

  const { data: quickBetHash, writeContract: placeQuickBet, isPending: isQuickBetting, error: quickBetError } = useWriteContract();
  const { isLoading: isQuickBetConfirming, isSuccess: quickBetSuccess, error: quickBetTxError } = useWaitForTransactionReceipt({ hash: quickBetHash });

  useEffect(() => {
    if (quickBetError) {
      alert(sanitizeErrorMessage(quickBetError));
      setActiveBetEvent(null);
    }
  }, [quickBetError]);

  useEffect(() => {
    if (quickBetTxError) {
      alert(sanitizeErrorMessage(quickBetTxError));
      setActiveBetEvent(null);
    }
  }, [quickBetTxError]);

  useEffect(() => {
    if (quickBetSuccess && quickBetHash) {
      setSuccessToast({ message: "🎯 Quick bet submitted!", txHash: quickBetHash });
      setActiveBetEvent(null);
    }
  }, [quickBetSuccess, quickBetHash]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("hiddenEvents");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setHiddenEvents(parsed);
        }
      } catch (e) {
        console.warn("Could not parse hiddenEvents store", e);
      }
    }
    const unstored = localStorage.getItem("unhiddenEvents");
    if (unstored) {
      try {
        const parsed = JSON.parse(unstored);
        if (Array.isArray(parsed)) {
          setUnhiddenEvents(parsed);
        }
      } catch (e) {
        console.warn("Could not parse unhiddenEvents store", e);
      }
    }
  }, []);

  const globalHiddenEvents = (process.env.NEXT_PUBLIC_HIDDEN_EVENTS || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
  const hiddenList = Array.from(new Set([...globalHiddenEvents, ...hiddenEvents]));
  // Owner can "unhide" locally; unhiddenEvents overrides so Unhide works
  const effectiveHiddenList = hiddenList.filter((id) => !unhiddenEvents.includes(id));

  const totalEvents = eventCount ? Number(eventCount) : 0;
  const totalPages = Math.ceil(totalEvents / EVENTS_PER_PAGE);

  // Calculate which events to fetch
  // Events are 0-indexed, so if eventCount is 3, we have events 0, 1, 2
  const startIndex = (currentPage - 1) * EVENTS_PER_PAGE;
  const endIndex = Math.min(startIndex + EVENTS_PER_PAGE, totalEvents);
  const eventIds = totalEvents > 0 
    ? Array.from({ length: endIndex - startIndex }, (_, i) => startIndex + i)
    : [];

  // Fetch events individually to avoid multicall timeout with large bytes fields
  useEffect(() => {
    if (!isValidContractAddress() || totalEvents === 0 || eventIds.length === 0) {
      setEventsData([]);
      return;
    }

    const fetchEvents = async () => {
      setIsLoadingEvents(true);
      const fetchedEvents: (EventData & { id: number })[] = [];

      // Fetch events one at a time to avoid timeout
      for (const id of eventIds) {
        try {
          const data = await readContract(config, {
            address: CONTRACT_ADDRESS,
            abi: BIG_MARKET_ABI,
            functionName: "getEvent",
            args: [BigInt(id)],
          });

          let eventData: EventData;
          
          if (Array.isArray(data)) {
            const [
              title,
              category,
              imageData,
              context,
              endTime,
              outcomes,
              pools,
              totalPool,
              resolved,
              winningOutcome,
              creator,
            ] = data;
            eventData = {
              title,
              category,
              imageData: imageData as `0x${string}`,
              context,
              endTime,
              outcomes,
              pools,
              totalPool,
              resolved,
              winningOutcome,
              creator: creator as `0x${string}`,
            };
          } else {
            eventData = data as unknown as EventData;
          }

          // Validate event
          if (eventData.title && eventData.title.trim() !== "" && 
              eventData.creator && eventData.creator !== "0x0000000000000000000000000000000000000000") {
            fetchedEvents.push({
              id,
              ...eventData,
            });
          }
        } catch (error) {
          console.warn(`Error fetching event ${id}:`, error);
          // Continue with other events
        }
      }

      setEventsData(fetchedEvents);
      setIsLoadingEvents(false);
    };

    fetchEvents();
  }, [eventIds.join(","), totalEvents, config]);

  const events = eventsData
    .filter((e) => {
      if (selectedCategory !== "All" && e.category !== selectedCategory) return false;
      if (searchQuery && !e.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (!showResolvedOnly && e.resolved) return false;
      if (showResolvedOnly && !e.resolved) return false;
      if (effectiveHiddenList.includes(e.id) && !isOwner) return false;
      return true;
    })
    .reverse();

  // Dashboard: populate recent activity from same contract logs
  useEffect(() => {
    if (!publicClient || !isValidContractAddress()) return;
    let cancelled = false;
    setIsLoadingActivity(true);
    fetchRecentBetLogs(publicClient, { limit: 50 })
      .then((logs) => {
        if (!cancelled) setRecentActivity(logs);
      })
      .catch(() => {
        if (!cancelled) setRecentActivity([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingActivity(false);
      });
    return () => { cancelled = true; };
  }, [publicClient]);

  useEffect(() => {
    if (events.length === 0) return;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % events.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [events.length]);

  const toggleHideEvent = (id: number) => {
    if (!isOwner) return;
    const isCurrentlyHidden = hiddenList.includes(id);
    if (isCurrentlyHidden) {
      setUnhiddenEvents((prev) => {
        const next = prev.includes(id) ? prev : [...prev, id];
        if (typeof window !== "undefined") {
          localStorage.setItem("unhiddenEvents", JSON.stringify(next));
        }
        return next;
      });
      setHiddenEvents((prev) => {
        const next = prev.filter((ev) => ev !== id);
        if (typeof window !== "undefined") {
          localStorage.setItem("hiddenEvents", JSON.stringify(next));
        }
        return next;
      });
    } else {
      setUnhiddenEvents((prev) => {
        const next = prev.filter((ev) => ev !== id);
        if (typeof window !== "undefined") {
          localStorage.setItem("unhiddenEvents", JSON.stringify(next));
        }
        return next;
      });
      setHiddenEvents((prev) => {
        const next = prev.includes(id) ? prev : [...prev, id];
        if (typeof window !== "undefined") {
          localStorage.setItem("hiddenEvents", JSON.stringify(next));
        }
        return next;
      });
    }
  };

  const handleQuickBet = (event: EventData & { id: number }) => {
    if (!isConnected) {
      alert("Connect your wallet to place a quick bet");
      return;
    }
    if (event.resolved) {
      alert("This event is already resolved");
      return;
    }
    if (Date.now() / 1000 >= Number(event.endTime)) {
      alert("This event has ended");
      return;
    }

    const amount = quickBetAmount[event.id] || "";
    const outcomeIndex = quickBetOutcome[event.id] ?? 0;

    if (!amount || parseFloat(amount) <= 0) {
      alert("Enter a valid POL amount");
      return;
    }

    setActiveBetEvent(event.id);
    try {
      placeQuickBet({
        address: CONTRACT_ADDRESS,
        abi: BIG_MARKET_ABI,
        functionName: "placeBet",
        args: [BigInt(event.id), BigInt(outcomeIndex)],
        value: parseEther(amount),
      });
    } catch (err) {
      console.error("Quick bet failed", err);
      setActiveBetEvent(null);
    }
  };


  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 lg:px-6 py-8">
        <ContractWarning />

        {events.length > 0 && (
          <div className="mb-8">
            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/5 p-6 min-h-[22rem]">
              <div className="absolute right-0 top-0 w-40 h-40 bg-orange-500/20 blur-3xl rounded-full pointer-events-none" />
              <div className="absolute left-0 bottom-0 w-32 h-32 bg-amber-500/10 blur-3xl rounded-full pointer-events-none" />
              {events[currentSlide % events.length] && (() => {
                const spotlight = events[currentSlide % events.length];
                const imageUrl = spotlight.imageData && spotlight.imageData !== "0x" 
                  ? bytesToDataUrl(hexToBytes(spotlight.imageData))
                  : null;
                return (
                  <div key={currentSlide} className="relative flex flex-col md:flex-row md:items-center gap-6 animate-slide-in">
                    {imageUrl && (
                      <div className="w-full md:w-40 h-24 md:h-28 rounded-lg overflow-hidden border border-white/10">
                        <img src={imageUrl} alt={spotlight.title} className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 text-xs rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
                          Spotlight
                        </span>
                        <span className="px-2 py-1 text-[11px] rounded-full bg-white/10 text-neutral-300 border border-white/10">
                          {spotlight.resolved ? "Resolved" : "Live"}
                        </span>
                      </div>
                      <h2 className="text-xl md:text-2xl font-semibold text-white leading-tight break-words">
                        {spotlight.title}
                      </h2>
                      <p className="text-sm text-neutral-400">
                        Ends {format(new Date(Number(spotlight.endTime) * 1000), "PPpp")} · {formatEther(spotlight.totalPool)} POL
                      </p>
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/event/${spotlight.id}`}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-colors"
                        >
                          View event
                        </Link>
                        {spotlight.resolved && (
                          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            🏁 {spotlight.outcomes[Number(spotlight.winningOutcome)]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
              <div className="absolute top-4 right-4 flex gap-2">
                {events.slice(0, 5).map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentSlide(idx)}
                    className={`w-2.5 h-2.5 rounded-full transition-all ${currentSlide % events.length === idx ? "bg-orange-500 scale-110" : "bg-white/40"}`}
                    aria-label={`Go to slide ${idx + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Dashboard: recent activity from same contract logs */}
        {(recentActivity.length > 0 || isLoadingActivity) && (
          <div className="mb-8 rounded-xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Recent activity</h2>
            {isLoadingActivity ? (
              <p className="text-neutral-400 text-sm">Loading…</p>
            ) : (
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {recentActivity.slice(0, 20).map((entry, idx) => {
                  const ev = eventsData.find((e) => e.id === entry.eventId);
                  const title = ev?.title ?? `Event #${entry.eventId}`;
                  const outcomeLabel = ev?.outcomes?.[entry.outcome] ?? `#${entry.outcome}`;
                  return (
                    <li key={`${entry.eventId}-${idx}`} className="flex items-center justify-between text-sm py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-neutral-300 truncate flex-1 mr-2">{title}</span>
                      <span className="text-orange-400 shrink-0">{outcomeLabel}</span>
                      <span className="text-white font-medium shrink-0 ml-2">{formatEther(entry.amount)} POL</span>
                      <span className="text-neutral-500 text-xs shrink-0 ml-2">{formatAddress(entry.user)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="mb-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white">Trend & Prediction Market</h1>
          </div>
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.filter((cat) => cat !== "All").map((cat) => (
                <button
                  key={cat}
                  onClick={() => { setSelectedCategory(cat as Category); setCurrentPage(1); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedCategory === cat ? "bg-orange-500 text-white" : "bg-white/5 border border-white/10 text-neutral-300 hover:text-orange-400 hover:border-orange-500/50"
                  }`}
                >
                  {cat}
                </button>
              ))}
              <button
                onClick={() => { setSelectedCategory("All" as Category); setCurrentPage(1); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedCategory === "All" ? "bg-orange-500 text-white" : "bg-white/5 border border-white/10 text-neutral-300 hover:text-orange-400 hover:border-orange-500/50"
                }`}
              >
                All
              </button>
            </div>
          </div>
          
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <input
              type="text"
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-white placeholder-neutral-500"
            />
            <button
              onClick={() => { setShowResolvedOnly((prev) => !prev); setCurrentPage(1); }}
              className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors border ${
                showResolvedOnly ? "bg-amber-500/20 text-amber-400 border-amber-500/40" : "bg-white/5 text-neutral-400 border-white/10 hover:text-amber-400 hover:border-amber-500/30"
              }`}
            >
              {showResolvedOnly ? "Showing resolved" : "Show resolved"}
            </button>
          </div>
        </div>

        {countError && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4">
            <p className="text-red-300 text-sm">{sanitizeErrorMessage(countError)}</p>
            <button onClick={() => refetchEventCount()} className="mt-2 text-sm text-red-400 hover:text-red-300 underline">
              Try again
            </button>
          </div>
        )}

        {isLoadingCount && (
          <div className="py-12 text-center text-neutral-400 text-sm">Loading…</div>
        )}

        {!isLoadingCount && !countError && (
          <>
            {isLoadingEvents && totalEvents > 0 && (
              <div className="text-center py-12 text-gray-600 dark:text-gray-400">
                Loading events...
              </div>
            )}

            {events.length === 0 && !isLoadingEvents ? (
              <div className="py-12 text-center text-neutral-400 text-sm">
                {totalEvents === 0 ? "No events yet. Create one to get started." : "No events match your filters."}
                <span className="block mt-1 text-neutral-500">Total: {totalEvents}</span>
              </div>
            ) : events.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
              {events.map((event) => {
                const imageUrl = event.imageData && event.imageData !== "0x" 
                  ? bytesToDataUrl(hexToBytes(event.imageData))
                  : null;
                
                const outcomePercentages = event.outcomes.map((_, idx) => {
                  const pool = Number(event.pools[idx]);
                  const total = Number(event.totalPool);
                  return total > 0 ? (pool / total) * 100 : 0;
                });
                
                const topOutcomes = event.outcomes
                  .map((outcome, idx) => ({
                    outcome,
                    percentage: outcomePercentages[idx],
                    pool: Number(event.pools[idx]),
                  }))
                  .sort((a, b) => b.percentage - a.percentage)
                  .slice(0, 2);

                const chosenOutcome = quickBetOutcome[event.id] ?? 0;
                const isBetting = activeBetEvent === event.id && (isQuickBetting || isQuickBetConfirming);
                const winningLabel = event.resolved ? event.outcomes[Number(event.winningOutcome)] : null;
                const isHidden = effectiveHiddenList.includes(event.id);
                const cardSpacing = event.resolved ? "p-4 space-y-3" : "p-5 space-y-4";
                
                return (
                  <div
                    key={event.id}
                    className="relative overflow-hidden rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.07] transition-colors"
                  >
                    <div className={`relative ${cardSpacing}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {imageUrl && (
                            <div className="w-24 h-24 md:w-28 md:h-28 rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
                              <img src={imageUrl} alt={event.title} className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
                              {event.category}
                            </span>
                            <span className={`text-[11px] px-2 py-1 rounded-full border ${event.resolved ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-white/10 text-neutral-300 border-white/10"}`}>
                              {event.resolved ? "Resolved" : "Live"}
                            </span>
                            {winningLabel && (
                              <span className="text-[11px] px-2 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                🏁 {winningLabel}
                              </span>
                            )}
                            {isHidden && isOwner && (
                              <span className="text-[11px] px-2 py-1 rounded-full bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 border border-gray-800">
                                Hidden from users
                              </span>
                            )}
                          </div>
                        </div>
                        {isOwner && (
                          <button
                            onClick={() => toggleHideEvent(event.id)}
                            className="text-xs px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-900 hover:text-white dark:hover:bg-white dark:hover:text-gray-900 transition-colors"
                          >
                            {isHidden ? "Unhide" : "Hide"}
                          </button>
                        )}
                      </div>

                      <h3 className="text-sm md:text-base font-semibold font-heading text-gray-900 dark:text-gray-50 leading-snug h-[6rem] md:h-[6.5rem] overflow-y-auto pr-1">
                        <Link href={`/event/${event.id}`} className="hover:underline">
                          {event.title}
                        </Link>
                      </h3>
                      
                      {/* Polymarket-style stacked bar */}
                      {event.totalPool > 0n && (
                        <div className="space-y-1">
                          <div className="w-full h-3 rounded-full overflow-hidden flex bg-white/10">
                            {event.outcomes.map((_, idx) => {
                              const pct = outcomePercentages[idx] ?? 0;
                              const barColors = ["#ea580c", "#2563eb", "#16a34a", "#9333ea"];
                              if (pct <= 0) return null;
                              return (
                                <div
                                  key={idx}
                                  className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
                                  style={{ width: `${pct}%`, backgroundColor: barColors[idx % barColors.length] }}
                                  title={`${event.outcomes[idx]} ${pct.toFixed(1)}%`}
                                />
                              );
                            })}
                          </div>
                          <div className="flex justify-between text-[11px] text-neutral-500">
                            {topOutcomes.slice(0, 2).map((item, idx) => (
                              <span key={idx}>{item.outcome} {item.percentage.toFixed(0)}%</span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="space-y-3 min-h-[3rem]">
                        {topOutcomes.map((item, idx) => {
                          const barColors = ['from-orange-500 to-pink-500', 'from-blue-500 to-cyan-500', 'from-green-500 to-lime-500', 'from-purple-500 to-indigo-500'];
                          return (
                            <div key={idx}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-gray-800 dark:text-gray-200 flex-1 truncate mr-2 font-medium">{item.outcome}</span>
                                <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                                  {item.percentage.toFixed(1)}%
                                </span>
                              </div>
                              <div className="w-full bg-white/10 rounded-full h-2.5 overflow-hidden">
                                <div
                                  className={`h-full bg-gradient-to-r ${barColors[idx % barColors.length]} transition-all duration-500 rounded-full`}
                                  style={{ width: `${item.percentage}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                        {event.outcomes.length > 2 ? (
                          <div className="text-[11px] text-neutral-500 pt-1">+{event.outcomes.length - 2} more</div>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-[11px] text-neutral-400 pt-2">
                        <div className="flex items-center gap-1">
                          <span>💰</span>
                          {formatEther(event.totalPool)} POL pool
                        </div>
                        <div className="text-right">
                          Ends {format(new Date(Number(event.endTime) * 1000), "MMM d")}
                        </div>
                      </div>
                      {event.resolved && (
                        <div className="flex items-center justify-between text-xs text-neutral-400">
                          <Link href={`/event/${event.id}`} className="text-orange-400 hover:underline font-medium">View event →</Link>
                          <span>Claim payouts</span>
                        </div>
                      )}

                      {!event.resolved && (
                        <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
                          <div className="flex items-center justify-between text-xs text-neutral-400">
                            <span>Quick stake</span>
                            <span className="text-[11px] px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">On-chain</span>
                          </div>
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {event.outcomes.map((outcome, idx) => (
                              <button
                                key={idx}
                                onClick={() => setQuickBetOutcome((prev) => ({ ...prev, [event.id]: idx }))}
                                className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                                  chosenOutcome === idx ? "bg-orange-500 text-white border-orange-500" : "bg-white/5 text-neutral-300 border-white/10 hover:border-orange-500/50"
                                }`}
                              >
                                {outcome}
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              value={quickBetAmount[event.id] || ""}
                              onChange={(e) => setQuickBetAmount((prev) => ({ ...prev, [event.id]: e.target.value }))}
                              placeholder="POL"
                              className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                            />
                            <button
                              onClick={() => handleQuickBet(event)}
                              disabled={isBetting}
                              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isBetting ? "…" : "Stake"}
                            </button>
                          </div>
                          <div className="flex items-center justify-between text-xs text-neutral-400">
                            <Link href={`/event/${event.id}`} className="text-orange-400 hover:underline font-medium">View event →</Link>
                            <span>{format(new Date(Number(event.endTime) * 1000), "MMM d, HH:mm")}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Previous
                </button>
                <span className="text-gray-600">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Next
                </button>
              </div>
            )}
          </>
            ) : null}
          </>
        )}

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

