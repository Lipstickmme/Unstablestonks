"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { parseEther, parseUnits } from "viem";

import {
  isRugRushConfigured,
  RUG_RUSH_ABI,
  RUG_RUSH_ADDRESS,
} from "@/lib/games/crash/abi";
import {
  type OnChainRound,
  type Phase,
  type Position,
  resolvePhase,
  resolvePosition,
  RoundState,
} from "@/lib/games/crash/engine";
import { generateToken, type TokenIdentity } from "@/lib/games/crash/tokens";

/** Poll cadence while a round is live. Short, because the phase can flip at any block. */
const LIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 6_000;

/** Repaint the curve at ~30fps; the contract's tick is 100ms so this is more than enough. */
const FRAME_MS = 33;

type RawRound = {
  serverSeedHash: `0x${string}`;
  serverSeed: `0x${string}`;
  clientSeed: string;
  startedAt: bigint;
  revealDeadline: bigint;
  rugX18: bigint;
  totalStaked: bigint;
  totalPaid: bigint;
  state: number;
};

export const useRugRush = () => {
  const { address } = useAccount();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const configured = isRugRushConfigured();

  const contract = { address: RUG_RUSH_ADDRESS, abi: RUG_RUSH_ABI } as const;

  const { data: roundCount } = useReadContract({
    ...contract,
    functionName: "roundCount",
    query: { enabled: configured, refetchInterval: IDLE_POLL_MS },
  });

  // roundCount is the next id, so the live round is one behind it.
  const roundId = roundCount !== undefined && roundCount > 0n ? roundCount - 1n : undefined;

  const { data: rawRound, refetch: refetchRound } = useReadContract({
    ...contract,
    functionName: "getRound",
    args: roundId !== undefined ? [roundId] : undefined,
    query: { enabled: configured && roundId !== undefined, refetchInterval: LIVE_POLL_MS },
  });

  const { data: rawPosition, refetch: refetchPosition } = useReadContract({
    ...contract,
    functionName: "getPosition",
    args: roundId !== undefined && address ? [roundId, address] : undefined,
    query: {
      enabled: configured && roundId !== undefined && Boolean(address),
      refetchInterval: LIVE_POLL_MS,
    },
  });

  const { data: maxPayout } = useReadContract({
    ...contract,
    functionName: "maxPayout",
    query: { enabled: configured },
  });

  const { data: minStake } = useReadContract({
    ...contract,
    functionName: "minStake",
    query: { enabled: configured },
  });

  const { data: bankroll } = useReadContract({
    ...contract,
    functionName: "bankroll",
    query: { enabled: configured, refetchInterval: IDLE_POLL_MS },
  });

  const round: OnChainRound | null = useMemo(() => {
    if (!rawRound || roundId === undefined) {
      return null;
    }

    const raw = rawRound as unknown as RawRound;

    return {
      roundId,
      serverSeedHash: raw.serverSeedHash,
      serverSeed: raw.serverSeed,
      clientSeed: raw.clientSeed,
      startedAt: raw.startedAt,
      revealDeadline: raw.revealDeadline,
      rugX18: raw.rugX18,
      totalStaked: raw.totalStaked,
      totalPaid: raw.totalPaid,
      state: raw.state as RoundState,
    };
  }, [rawRound, roundId]);

  const position: Position | null = useMemo(() => {
    if (!rawPosition) {
      return null;
    }

    const raw = rawPosition as unknown as Position;

    return raw.stake > 0n ? raw : null;
  }, [rawPosition]);

  // The token is derived from the commit hash, which is public from the moment betting
  // opens — so the card can render before anyone knows where the rug is.
  const token: TokenIdentity | null = useMemo(() => {
    if (!round || round.state === RoundState.None) {
      return null;
    }

    return generateToken(round.serverSeedHash, round.clientSeed, round.roundId);
  }, [round]);

  // Local clock so the curve animates smoothly between polls.
  const [now, setNow] = useState(() => Date.now());
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (round?.state !== RoundState.Running) {
      return;
    }

    let last = 0;

    const tick = (timestamp: number) => {
      if (timestamp - last >= FRAME_MS) {
        last = timestamp;
        setNow(Date.now());
      }

      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, [round?.state]);

  const phase: Phase = useMemo(() => resolvePhase(round, token, now), [round, token, now]);

  const outcome = useMemo(
    () => resolvePosition(round, position, (maxPayout as bigint | undefined) ?? 0n),
    [round, position, maxPayout],
  );

  const refresh = async () => {
    await Promise.all([refetchRound(), refetchPosition()]);
  };

  const buyIn = async (stakeEther: string, autoSellTarget?: number) => {
    if (roundId === undefined) {
      throw new Error("No round is open");
    }

    await writeContractAsync({
      ...contract,
      functionName: "buyIn",
      args: [
        roundId,
        autoSellTarget && autoSellTarget > 1 ? parseUnits(String(autoSellTarget), 18) : 0n,
      ],
      value: parseEther(stakeEther),
    });
    await refresh();
  };

  const sell = async () => {
    if (roundId === undefined) {
      throw new Error("No round is open");
    }

    await writeContractAsync({ ...contract, functionName: "sell", args: [roundId] });
    await refresh();
  };

  const settle = async (targetRoundId?: bigint) => {
    const id = targetRoundId ?? roundId;

    if (id === undefined) {
      throw new Error("No round to settle");
    }

    await writeContractAsync({ ...contract, functionName: "settle", args: [id] });
    await refresh();
  };

  return {
    configured,
    roundId,
    round,
    token,
    phase,
    position,
    outcome,
    bankroll: (bankroll as bigint | undefined) ?? 0n,
    minStake: (minStake as bigint | undefined) ?? 0n,
    maxPayout: (maxPayout as bigint | undefined) ?? 0n,
    isWriting,
    buyIn,
    sell,
    settle,
    refresh,
  };
};
