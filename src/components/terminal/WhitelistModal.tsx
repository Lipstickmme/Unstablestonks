import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, Loader2, Send, X } from "lucide-react";
import { COMMUNITY } from "@/config/links";
import { useChain } from "@/lib/chain-context";
import { useWallet } from "@/lib/wallet";
import {
  QUESTS,
  WHITELIST_CAP,
  WHITELIST_CLOSED,
  WHITELIST_BASELINE,
  allTasksDone,
  cardNumber,
  claimSpot,
  readWhitelist,
  setTask,
  type QuestId,
  type WhitelistState,
} from "@/lib/whitelist";
import { claimWhitelistSpot, readWhitelistCount } from "@/lib/store";
import { TraderIdCard } from "./TraderIdCard";

const TASK_LINK: Partial<Record<QuestId, string>> = {
  tgGroup: COMMUNITY.telegramGroup,
  tgChannel: COMMUNITY.telegramChannel,
  xFollow: COMMUNITY.x,
  xRepost: COMMUNITY.xPost,
};

export function WhitelistModal({ onClose }: { onClose: () => void }) {
  const { chain } = useChain();
  const wallet = useWallet();
  const [state, setState] = useState<WhitelistState>(() => readWhitelist());
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [taken, setTaken] = useState<number | null>(null);

  // Shared count when a store is configured; null keeps the local number.
  useEffect(() => {
    readWhitelistCount()
      .then((r) => setTaken(r.shared ? r.taken : null))
      .catch(() => setTaken(null));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const done = allTasksDone(state);
  const claimed = state.spot != null && state.wallet != null;
  // Allocated-before-launch spots plus whatever has since been claimed. The
  // baseline is added rather than substituted so a real claim still moves the
  // number, and the total can never exceed the cap.
  const takenCount = WHITELIST_CLOSED
    ? WHITELIST_CAP
    : Math.min(WHITELIST_CAP, WHITELIST_BASELINE + (taken ?? state.roster.length));
  const remaining = Math.max(0, WHITELIST_CAP - takenCount);
  const pctClaimed = Math.round((takenCount / WHITELIST_CAP) * 100);
  const soldOut = remaining === 0;

  const onClaim = () => {
    setError(null);
    if (WHITELIST_CLOSED || soldOut) {
      setError(`All ${WHITELIST_CAP} spots have been claimed.`);
      return;
    }
    if (!wallet.address) {
      onClose();
      wallet.requestPicker();
      return;
    }
    setClaiming(true);
    void (async () => {
      // Ask the shared roster first — it's the only thing that can hand out a
      // spot number that means the same to everyone. If no store is configured
      // it answers shared:false and we keep the per-device roster.
      const remote = await claimWhitelistSpot({
        data: { wallet: wallet.address as string },
      }).catch(() => null);

      if (remote?.shared) {
        setTaken(remote.taken);
        if (!remote.ok) {
          setError(remote.reason ?? "Could not claim a spot.");
          setClaiming(false);
          return;
        }
      }

      const local = claimSpot(wallet.address as string, remote?.shared ? remote.spot : undefined);
      setClaiming(false);
      if (!local.ok) setError(local.reason);
      else setState(local.state);
    })();
  };

  const shareText = claimed
    ? `I'm on the UnstableStonks whitelist — Institutional Trader #${cardNumber(state.spot!)} 🥈\n\nMultichain launchpad terminal across Stable, Robinhood and Arc.`
    : "";
  const xShare = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(COMMUNITY.x)}`;
  const tgShare = `https://t.me/share/url?url=${encodeURIComponent(COMMUNITY.telegramChannel)}&text=${encodeURIComponent(shareText)}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="sheet-grip sheet-up my-auto w-full max-w-md overflow-hidden rounded-t-3xl border border-border bg-background sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-medium leading-none">
              {claimed
                ? "You're on the list"
                : WHITELIST_CLOSED || soldOut
                  ? "Whitelist closed"
                  : "NFT whitelist"}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {claimed
                ? "Institutional Trader ID issued"
                : WHITELIST_CLOSED || soldOut
                  ? `Closed — ${WHITELIST_CAP}/${WHITELIST_CAP} claimed`
                  : `${remaining} of ${WHITELIST_CAP} spots left`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {claimed ? (
            <>
              <TraderIdCard
                wallet={state.wallet!}
                spot={state.spot!}
                issuedAt={state.claimedAt ?? Date.now()}
                chainName={chain.name}
              />
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Congratulations — spot{" "}
                <span className="num text-foreground">#{cardNumber(state.spot!)}</span> is yours.
                Screenshot the card and share it.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a
                  href={xShare}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-xs font-medium transition-colors hover:bg-surface-elevated"
                >
                  Share on X <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href={tgShare}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-xs font-medium transition-colors hover:bg-surface-elevated"
                >
                  <Send className="h-3 w-3" /> Share on TG
                </a>
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="num text-lg font-semibold leading-none">
                    {takenCount}
                    <span className="text-sm text-muted-foreground">/{WHITELIST_CAP}</span>
                  </span>
                  <span className="num text-[11px] text-muted-foreground">
                    {soldOut ? "closed" : `${remaining} left`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                    style={{ width: `${pctClaimed}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {soldOut
                    ? "Every spot is taken. Allocations are confirmed against on-chain and social records before mint."
                    : `${pctClaimed}% claimed. Finish the tasks below to take one of the remaining spots.`}
                </p>
              </div>
              <ul className="space-y-1.5">
                {QUESTS.map((q) => {
                  const isDone = Boolean(state.tasks[q.id]);
                  const href = TASK_LINK[q.id];
                  return (
                    <li
                      key={q.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5"
                    >
                      <span
                        className={`grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border ${
                          isDone
                            ? "border-bull bg-bull/15 text-bull"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {isDone && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium">{q.label}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {q.detail}
                          {!q.verified && " · self-reported"}
                        </span>
                      </span>
                      {q.id === "trade" ? (
                        <span className="text-[10px] text-muted-foreground">
                          {isDone ? "verified" : "auto"}
                        </span>
                      ) : (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => setState(setTask(q.id, true))}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-opacity hover:opacity-90 ${
                            isDone
                              ? "border border-border text-muted-foreground"
                              : "bg-primary text-primary-foreground"
                          }`}
                        >
                          {isDone ? "Open" : "Go"}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>

              <button
                onClick={onClaim}
                disabled={WHITELIST_CLOSED || soldOut || !done || claiming}
                className="tap mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {claiming && <Loader2 className="h-4 w-4 animate-spin" />}
                {WHITELIST_CLOSED || soldOut
                  ? `All ${WHITELIST_CAP} spots claimed`
                  : !wallet.address
                    ? "Connect wallet to claim"
                    : done
                      ? "Claim my spot"
                      : "Finish all tasks"}
              </button>
              {error && <p className="mt-2 text-center text-[11px] text-bear">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
