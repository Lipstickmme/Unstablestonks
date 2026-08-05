"use client";

import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useReadContract, useSignTypedData, useWriteContract } from "wagmi";

import { useAzuroChainId, useBetLimits, useBetToken, useRelayerFee } from "@/hooks/useAzuro";
import { useBetslip } from "@/lib/betslip";
import {
  buildClientData,
  calcMinOdds,
  createBet,
  createComboBet,
  type CreateBetResponse,
  ERC20_ABI,
  formatOdds,
  getChainData,
  getBetTypedData,
  getComboBetTypedData,
  selectionKey,
} from "@/lib/azuro";

type SubmitState =
  | { kind: "idle" }
  | { kind: "approving" }
  | { kind: "signing" }
  | { kind: "submitting" }
  | { kind: "done"; orders: CreateBetResponse[] }
  | { kind: "error"; message: string };

export function Betslip() {
  const chainId = useAzuroChainId();
  const betToken = useBetToken();
  const { address } = useAccount();
  const betslip = useBetslip();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const { data: relayerFee } = useRelayerFee();
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  const selections = useMemo(
    () => betslip.items.map(({ conditionId, outcomeId }) => ({ conditionId, outcomeId })),
    [betslip.items],
  );
  const { data: limits } = useBetLimits(selections);

  const relayer = getChainData(chainId).contracts.relayer;

  const { data: balance } = useReadContract({
    address: betToken.address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: betToken.address,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, relayer] : undefined,
    query: { enabled: Boolean(address) },
  });

  const feeAmount = relayerFee ? BigInt(relayerFee.relayerFeeAmount) : 0n;

  // The relayer takes its fee out of the same token as the stake, so the approval has to
  // cover stake + fee for every order in the slip.
  const requiredAllowance = useMemo(() => {
    if (!betslip.items.length) {
      return 0n;
    }

    if (betslip.mode === "combo") {
      const stake = Number(betslip.comboStake) || 0;

      return stake > 0 ? parseUnits(String(stake), betToken.decimals) + feeAmount : 0n;
    }

    return betslip.items.reduce((total, item) => {
      const stake = Number(betslip.stakes[selectionKey(item)]) || 0;

      return stake > 0
        ? total + parseUnits(String(stake), betToken.decimals) + feeAmount
        : total;
    }, 0n);
  }, [betslip.items, betslip.mode, betslip.comboStake, betslip.stakes, betToken.decimals, feeAmount]);

  const needsApproval = allowance !== undefined && requiredAllowance > (allowance as bigint);
  const hasBalance =
    balance === undefined || (balance as bigint) >= requiredAllowance;

  const busy = ["approving", "signing", "submitting"].includes(state.kind);
  const canSubmit =
    Boolean(address) &&
    betslip.items.length > 0 &&
    requiredAllowance > 0n &&
    hasBalance &&
    !busy &&
    betslip.oddsChanges.length === 0;

  const submit = async () => {
    if (!address || !relayerFee) {
      return;
    }

    try {
      if (needsApproval) {
        setState({ kind: "approving" });
        await writeContractAsync({
          address: betToken.address,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [relayer, requiredAllowance],
        });
        await refetchAllowance();
      }

      const clientData = buildClientData({
        chainId,
        relayerFeeAmount: relayerFee.relayerFeeAmount,
      });

      setState({ kind: "signing" });

      if (betslip.mode === "combo") {
        const bet = {
          selections,
          amount: parseUnits(betslip.comboStake, betToken.decimals),
          minOdds: calcMinOdds(betslip.comboOdds, betslip.slippage),
          nonce: BigInt(Date.now()),
        };
        const typedData = getComboBetTypedData(address, clientData, bet);
        const signature = await signTypedDataAsync(typedData as never);

        setState({ kind: "submitting" });
        const order = await createComboBet({ account: address, clientData, bet, signature });

        setState({ kind: "done", orders: [order] });
        betslip.clear();
        return;
      }

      // Singles are independent orders — one signature each.
      const orders: CreateBetResponse[] = [];

      for (const [index, item] of betslip.items.entries()) {
        const stake = Number(betslip.stakes[selectionKey(item)]) || 0;

        if (stake <= 0) {
          continue;
        }

        const bet = {
          conditionId: item.conditionId,
          outcomeId: item.outcomeId,
          amount: parseUnits(String(stake), betToken.decimals),
          minOdds: calcMinOdds(item.odds, betslip.slippage),
          // Nonces must differ within a batch signed in the same millisecond.
          nonce: BigInt(Date.now()) + BigInt(index),
        };

        setState({ kind: "signing" });
        const signature = await signTypedDataAsync(
          getBetTypedData(address, clientData, bet) as never,
        );

        setState({ kind: "submitting" });
        orders.push(await createBet({ account: address, clientData, bet, signature }));
      }

      setState({ kind: "done", orders });
      betslip.clear();
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not place the bet",
      });
    }
  };

  if (!betslip.items.length) {
    return (
      <div className="rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-white/10 dark:text-neutral-400">
        Your betslip is empty. Tap any price to add a selection.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/10">
        <h2 className="text-sm font-semibold">Betslip ({betslip.items.length})</h2>
        <button
          type="button"
          onClick={betslip.clear}
          className="text-xs text-gray-500 hover:text-red-500"
        >
          Clear
        </button>
      </header>

      {betslip.items.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200 p-2 dark:border-white/10">
          {(["single", "combo"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={mode === "combo" && !betslip.isComboAllowed}
              onClick={() => betslip.setMode(mode)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                betslip.mode === mode
                  ? "bg-orange-500 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-white/5"
              }`}
            >
              {mode === "combo" ? `Combo ${formatOdds(betslip.comboOdds)}` : "Singles"}
            </button>
          ))}
        </div>
      )}

      {betslip.comboBlockedReason && betslip.items.length > 1 && (
        <p className="px-4 pt-3 text-xs text-amber-500">{betslip.comboBlockedReason}</p>
      )}

      <ul className="divide-y divide-gray-200 dark:divide-white/10">
        {betslip.items.map((item) => {
          const key = selectionKey(item);

          return (
            <li key={key} className="space-y-2 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.outcomeTitle}</p>
                  <p className="truncate text-[11px] text-gray-500 dark:text-neutral-400">
                    {item.marketTitle} · {item.gameTitle}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatOdds(item.odds)}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove selection"
                    onClick={() => betslip.remove(item.conditionId, item.outcomeId)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    ×
                  </button>
                </div>
              </div>

              {betslip.mode === "single" && (
                <div className="flex items-center gap-2">
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={betslip.stakes[key] ?? ""}
                    onChange={(event) => betslip.setStake(key, event.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-1.5 text-sm dark:border-white/10"
                  />
                  <span className="shrink-0 text-xs text-gray-500">{betToken.symbol}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {betslip.mode === "combo" && (
        <div className="flex items-center gap-2 border-t border-gray-200 px-4 py-3 dark:border-white/10">
          <input
            inputMode="decimal"
            placeholder="Combo stake"
            value={betslip.comboStake}
            onChange={(event) => betslip.setComboStake(event.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-1.5 text-sm dark:border-white/10"
          />
          <span className="shrink-0 text-xs text-gray-500">{betToken.symbol}</span>
        </div>
      )}

      {betslip.oddsChanges.length > 0 && (
        <div className="border-t border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Odds moved on {betslip.oddsChanges.length} selection
            {betslip.oddsChanges.length > 1 ? "s" : ""}.
          </p>
          <button
            type="button"
            onClick={betslip.acceptOddsChanges}
            className="mt-2 rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white"
          >
            Accept new odds
          </button>
        </div>
      )}

      <div className="space-y-2 border-t border-gray-200 px-4 py-3 text-xs dark:border-white/10">
        <div className="flex justify-between text-gray-500 dark:text-neutral-400">
          <span>Total stake</span>
          <span className="tabular-nums">
            {betslip.totalStake.toFixed(2)} {betToken.symbol}
          </span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Potential payout</span>
          <span className="tabular-nums text-emerald-500">
            {betslip.totalPayout.toFixed(2)} {betToken.symbol}
          </span>
        </div>
        {relayerFee && (
          <div className="flex justify-between text-gray-500 dark:text-neutral-400">
            <span>Relayer fee</span>
            <span className="tabular-nums">
              {relayerFee.beautyRelayerFeeAmount} {relayerFee.symbol}
            </span>
          </div>
        )}
        {limits?.maxBet !== undefined && (
          <div className="flex justify-between text-gray-500 dark:text-neutral-400">
            <span>Max stake</span>
            <span className="tabular-nums">
              {limits.maxBet.toFixed(2)} {betToken.symbol}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-gray-500 dark:text-neutral-400">
          <label htmlFor="slippage">Odds slippage</label>
          <select
            id="slippage"
            value={betslip.slippage}
            onChange={(event) => betslip.setSlippage(Number(event.target.value))}
            className="rounded border border-gray-200 bg-transparent px-2 py-1 dark:border-white/10"
          >
            {[1, 2, 5, 10].map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="px-4 pb-4">
        {!hasBalance && (
          <p className="mb-2 text-xs text-red-500">
            Not enough {betToken.symbol}. Top up from the wallet page.
          </p>
        )}
        {state.kind === "error" && <p className="mb-2 text-xs text-red-500">{state.message}</p>}
        {state.kind === "done" && (
          <p className="mb-2 text-xs text-emerald-500">
            {state.orders.length} order{state.orders.length > 1 ? "s" : ""} placed.
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state.kind === "approving" && `Approving ${betToken.symbol}…`}
          {state.kind === "signing" && "Sign in your wallet…"}
          {state.kind === "submitting" && "Placing bet…"}
          {!busy && (needsApproval ? `Approve & place bet` : "Place bet")}
        </button>

        {balance !== undefined && (
          <p className="mt-2 text-center text-[11px] text-gray-400">
            Balance: {formatUnits(balance as bigint, betToken.decimals)} {betToken.symbol}
          </p>
        )}
      </div>
    </div>
  );
}
