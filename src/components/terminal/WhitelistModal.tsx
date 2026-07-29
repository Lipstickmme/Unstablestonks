import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, Loader2, Send, X } from "lucide-react";
import { COMMUNITY } from "@/config/links";
import { useChain } from "@/lib/chain-context";
import { useWallet } from "@/lib/wallet";
import {
  QUESTS,
  WHITELIST_CAP,
  allTasksDone,
  cardNumber,
  claimSpot,
  readWhitelist,
  setTask,
  type QuestId,
  type WhitelistState,
} from "@/lib/whitelist";
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
  const remaining = Math.max(0, WHITELIST_CAP - state.roster.length);

  const onClaim = () => {
    setError(null);
    if (!wallet.address) {
      onClose();
      wallet.requestPicker();
      return;
    }
    setClaiming(true);
    const res = claimSpot(wallet.address);
    setClaiming(false);
    if (!res.ok) setError(res.reason);
    else setState(res.state);
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
        className="fade-up my-auto w-full max-w-md overflow-hidden rounded-t-2xl border border-border bg-background sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-medium leading-none">
              {claimed ? "You're on the list" : "NFT whitelist"}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {claimed
                ? "Institutional Trader ID issued"
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
                disabled={!done || claiming}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {claiming && <Loader2 className="h-4 w-4 animate-spin" />}
                {!wallet.address
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
