import { useEffect, useMemo, useState } from "react";
import { ArrowDown, Settings2, Zap, Loader2, ExternalLink } from "lucide-react";
import { formatCompactToken, formatUSD } from "@/lib/format";
import type { TokenRow } from "@/lib/types";
import { useChain } from "@/lib/chain-context";
import { useWallet } from "@/lib/wallet";
import {
  executeSwap,
  feePreview,
  quoteSwap,
  swapEnabled,
  PLATFORM_FEE_BPS,
  type SwapQuote,
} from "@/lib/swap";
import { getNativeBalance, getErc20Balance } from "@/lib/data/rpc";
import { markTradeComplete } from "@/lib/whitelist";
import { trackEvent } from "@/lib/store";

/**
 * Amount for a 25% / 50% / MAX button.
 *
 * MAX on a buy leaves a slice of the balance behind for gas — on these chains
 * the gas token IS the asset being spent, so a literal 100% produced a swap that
 * could never be paid for. Formatted as a plain decimal because Number.toString
 * emits exponent notation for small balances, which the amount field and
 * parseUnits both reject.
 */
function presetAmount(balance: number, pct: number): string {
  const raw = pct === 1 ? balance * 0.99 : balance * pct;
  if (!isFinite(raw) || raw <= 0) return "";
  return raw.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

export function SwapPanel({
  token,
  defaultSide = "buy",
  onNeedsWallet,
}: {
  token: TokenRow;
  defaultSide?: "buy" | "sell";
  /**
   * Called when the panel needs a wallet and doesn't have one. Dialogs pass
   * their close handler so the popup gets out of the way and the header's
   * picker takes over.
   */
  onNeedsWallet?: () => void;
}) {
  const { chain, chainKey } = useChain();
  const wallet = useWallet();
  const [side, setSide] = useState<"buy" | "sell">(defaultSide);
  const [amount, setAmount] = useState("");
  const [slipBps, setSlipBps] = useState(100);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tokenAddr = token.address as `0x${string}`;
  const tokenDecimals = token.decimals ?? 18;
  const amtNum = parseFloat(amount) || 0;
  const enabled = swapEnabled(chain);
  const wrongChain = wallet.address != null && wallet.chainId !== chain.id;
  const inputSymbol = side === "buy" ? chain.nativeCurrency.symbol : token.symbol;
  const outputSymbol = side === "buy" ? token.symbol : chain.nativeCurrency.symbol;

  // Balance of the input asset.
  useEffect(() => {
    let cancel = false;
    setBalance(null);
    if (!wallet.address) return;
    const load = async () => {
      const bal =
        side === "buy"
          ? await getNativeBalance(chainKey, wallet.address as `0x${string}`)
          : await getErc20Balance(
              chainKey,
              tokenAddr,
              wallet.address as `0x${string}`,
              tokenDecimals,
            );
      if (!cancel) setBalance(bal);
    };
    load();
    return () => {
      cancel = true;
    };
  }, [wallet.address, side, chainKey, tokenAddr, tokenDecimals]);

  // Live quote (debounced).
  useEffect(() => {
    if (!enabled || amtNum <= 0) {
      setQuote(null);
      return;
    }
    let cancel = false;
    setQuoting(true);
    const id = setTimeout(async () => {
      const q = await quoteSwap(chainKey, side, amtNum, tokenAddr, tokenDecimals, slipBps);
      if (!cancel) {
        setQuote(q);
        setQuoting(false);
      }
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(id);
    };
  }, [enabled, amtNum, side, chainKey, tokenAddr, tokenDecimals, slipBps]);

  const fee = useMemo(() => feePreview(amtNum), [amtNum]);
  const usdIn = side === "buy" ? amtNum * 0 : amtNum * token.price; // native USD price unknown per-chain; skip
  const outEstimate = quote?.ok ? quote.amountOut : side === "buy" && token.price > 0 ? 0 : 0;

  async function onAction() {
    setStatus(null);
    setTxHash(null);
    const account = wallet.address;
    if (!account) {
      // Don't run a second connect flow from in here. Connecting has one home —
      // the header button, which already knows about every discovered wallet and
      // the mobile deep links. Close whatever dialog we're in and point there.
      onNeedsWallet?.();
      wallet.requestPicker();
      return;
    }
    if (wallet.chainId !== chain.id) {
      const ok = await wallet.ensureChain(chain);
      if (!ok) {
        setStatus(`Switch your wallet to ${chain.name} to continue.`);
        return;
      }
      // Fall through on success: returning here made a successful network
      // switch swallow the click, so the trade needed a second press.
    }
    if (!enabled) return;
    if (!quote?.ok) {
      setStatus(quote?.reason ?? "Enter an amount to get a quote.");
      return;
    }
    const client = wallet.getWalletClient(chain);
    if (!client) {
      setStatus("Wallet unavailable.");
      return;
    }
    setBusy(true);
    setStatus("Confirm the fee + swap in your wallet…");
    try {
      const res = await executeSwap({
        chainKey,
        walletClient: client,
        account: account as `0x${string}`,
        side,
        amountIn: amtNum,
        token: tokenAddr,
        tokenDecimals,
        minOut: quote.minOut,
        feeTier: quote.feeTier,
        route: quote.route,
      });
      setTxHash(res.swapTxHash ?? res.feeTxHash ?? null);
      setStatus("Submitted. Track it on the explorer.");
      // The one whitelist task we can actually observe.
      if (res.swapTxHash) {
        markTradeComplete();
        // A counter, nothing more — no address, no amount. Silent when no
        // shared store is configured.
        void trackEvent({ data: { name: `swap-${chainKey}` } }).catch(() => {});
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message.split("\n")[0] : "Swap failed.");
    } finally {
      setBusy(false);
    }
  }

  const actionLabel = !wallet.address
    ? "Connect wallet"
    : wrongChain
      ? `Switch to ${chain.shortName}`
      : !enabled
        ? "Unavailable on this chain"
        : busy
          ? "Confirm in wallet…"
          : `${side === "buy" ? "Buy" : "Sell"} ${token.symbol}`;

  return (
    <section className="card-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1 text-xs">
          <button
            onClick={() => setSide("buy")}
            className={`rounded-full px-4 py-1 font-medium ${side === "buy" ? "bg-bull text-black" : "text-muted-foreground"}`}
          >
            Buy
          </button>
          <button
            onClick={() => setSide("sell")}
            className={`rounded-full px-4 py-1 font-medium ${side === "sell" ? "bg-bear text-white" : "text-muted-foreground"}`}
          >
            Sell
          </button>
        </div>
        <button className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-elevated hover:text-foreground">
          <Settings2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-2">
        <div className="rounded-xl border border-border bg-background p-3">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>You pay</span>
            <span>
              Balance: {balance != null ? formatCompactToken(balance) : "—"} {inputSymbol}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <input
              value={amount}
              inputMode="decimal"
              placeholder="0.0"
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="num flex-1 bg-transparent text-2xl font-light outline-none"
            />
            <div className="flex items-center gap-1.5 rounded-full bg-surface-elevated px-2.5 py-1 text-xs font-medium">
              <div className="h-4 w-4 rounded-full bg-primary/70" />
              {inputSymbol}
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="num">{usdIn > 0 ? `≈ ${formatUSD(usdIn)}` : " "}</span>
            <div className="flex gap-1">
              {[0.25, 0.5, 1].map((p) => (
                <button
                  key={p}
                  onClick={() => balance != null && setAmount(presetAmount(balance, p))}
                  className="rounded px-1.5 py-0.5 text-[10px] hover:bg-surface-elevated"
                >
                  {p === 1 ? "MAX" : `${p * 100}%`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="relative z-10 -my-3.5 flex justify-center">
          <div className="rounded-lg border border-border bg-surface p-1.5">
            <ArrowDown className="h-3.5 w-3.5" />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background p-3">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>You receive (est.)</span>
            {token.price > 0 && (
              <span>
                1 {token.symbol} = {formatUSD(token.price)}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="num flex-1 text-2xl font-light">
              {quoting ? "…" : quote?.ok ? formatCompactToken(outEstimate) : "0.0"}
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-surface-elevated px-2.5 py-1 text-xs font-medium">
              {outputSymbol}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 rounded-lg border border-dashed border-border p-2.5 text-[11px]">
        <Row
          label={`Platform fee (${(PLATFORM_FEE_BPS / 100).toFixed(2)}%)`}
          value={
            <span className="num">
              {fee > 0 ? `${formatCompactToken(fee)} ${inputSymbol}` : "—"}
            </span>
          }
        />
        <Row
          label="Min received"
          value={
            <span className="num">
              {quote?.ok ? `${formatCompactToken(quote.minOut)} ${outputSymbol}` : "—"}
            </span>
          }
        />
        <Row
          label="Slippage"
          value={
            <div className="flex items-center gap-1">
              {[50, 100, 300].map((s) => (
                <button
                  key={s}
                  onClick={() => setSlipBps(s)}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${slipBps === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {s / 100}%
                </button>
              ))}
            </div>
          }
        />
        <Row
          label="Route"
          value={
            <span className="num">
              {quote?.ok && quote.routeLabel
                ? side === "buy"
                  ? quote.routeLabel.replace(/[^→]+$/, token.symbol)
                  : `${token.symbol}${quote.routeLabel.replace(/^[^→]+/, "")}`
                : "—"}
            </span>
          }
        />
      </div>

      {!enabled && (
        <p className="mt-2 rounded-lg border border-warn/30 bg-warn/10 p-2 text-[11px] text-warn">
          Trading isn't available on {chain.name} yet.
        </p>
      )}

      <button
        onClick={onAction}
        disabled={busy || (Boolean(wallet.address) && !wrongChain && !enabled)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        {actionLabel}
      </button>

      {!status && wallet.error && (
        <p className="mt-2 text-center text-[11px] text-bear">{wallet.error}</p>
      )}
      {status && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {status}
          {txHash && (
            <a
              href={`${chain.explorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              view <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </p>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {value}
    </div>
  );
}
