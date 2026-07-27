import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import { ArrowDown, Loader2, ExternalLink, Zap } from "lucide-react";
import { PLATFORM_FEE_BPS } from "@/config/chains";
import { BRIDGE_CHAINS, bridgeChain, type BridgeChain } from "@/config/bridge-chains";
import { useChain } from "@/lib/chain-context";
import { useWallet } from "@/lib/wallet";
import {
  getBridgeQuote,
  executeBridge,
  availableRails,
  NATIVE,
  type BridgeQuote,
  type BridgeRail,
} from "@/lib/bridge";
import { bridgeViaCctp } from "@/lib/cctp";
import { BrandImage } from "@/components/brand/BrandImage";

/**
 * Move funds between any two supported chains.
 *
 * Both ends are selectable. This used to fix the destination to whichever chain
 * the terminal was on and offer only the other two as sources, so the route
 * people actually need — Ethereum in — did not exist at all.
 *
 * The rail is chosen for the user (see availableRails) and the routing stays
 * out of the way: pick two chains, enter an amount, sign.
 */
export function BridgePanel({
  bare = false,
  onNeedsWallet,
}: {
  bare?: boolean;
  /** See SwapPanel — hands connecting back to the header button. */
  onNeedsWallet?: () => void;
} = {}) {
  const { chainKey } = useChain();
  const wallet = useWallet();

  // Default route: bring funds in from Ethereum to whatever is on screen.
  const [fromKey, setFromKey] = useState("ethereum");
  const [toKey, setToKey] = useState<string>(chainKey);
  const [pinned, setPinned] = useState(false);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rails, setRails] = useState<BridgeRail[] | null>(null);
  const [railNote, setRailNote] = useState<string | null>(null);

  const src = bridgeChain(fromKey) as BridgeChain;
  const dst = bridgeChain(toKey) as BridgeChain;
  const amt = parseFloat(amount) || 0;

  // Follow the terminal's chain as the destination until the user overrides it.
  useEffect(() => {
    if (!pinned) setToKey(chainKey);
  }, [chainKey, pinned]);

  // Never let both ends be the same chain.
  useEffect(() => {
    if (fromKey !== toKey) return;
    const other = BRIDGE_CHAINS.find((c) => c.key !== toKey);
    if (other) setFromKey(other.key);
  }, [fromKey, toKey]);

  // Which rails are live for this pair. Re-probed on every pair change, so a
  // route that opens upstream appears without a redeploy.
  useEffect(() => {
    let cancel = false;
    setRails(null);
    setRailNote(null);
    availableRails(fromKey, toKey).then((r) => {
      if (cancel) return;
      setRails(r.rails);
      setRailNote(r.reason ?? null);
    });
    return () => {
      cancel = true;
    };
  }, [fromKey, toKey]);

  const rail: BridgeRail | null = rails?.[0] ?? null;
  const cctpOnly = rail === "cctp";
  const noRoute = rails != null && rails.length === 0;

  // CCTP always moves USDC; Relay moves the source chain's native asset.
  const sendSymbol = cctpOnly ? "USDC" : src?.nativeCurrency.symbol;
  const sendDecimals = cctpOnly ? (src?.usdc?.decimals ?? 6) : (src?.nativeCurrency.decimals ?? 18);

  // Live Relay quote, debounced. CCTP is 1:1 and needs no quote.
  useEffect(() => {
    if (!wallet.address || amt <= 0 || rail !== "relay") {
      setQuote(null);
      return;
    }
    let cancel = false;
    setQuoting(true);
    const id = setTimeout(async () => {
      const q = await getBridgeQuote({
        user: wallet.address as `0x${string}`,
        from: fromKey,
        to: toKey,
        amount: parseUnits(amount, sendDecimals).toString(),
        originCurrency: NATIVE,
        destinationCurrency: NATIVE,
      });
      if (!cancel) {
        setQuote(q);
        setQuoting(false);
      }
    }, 450);
    return () => {
      cancel = true;
      clearTimeout(id);
    };
  }, [wallet.address, amount, amt, fromKey, toKey, rail, sendDecimals]);

  async function onBridge() {
    setStatus(null);
    setTxHash(null);
    const account = wallet.address;
    if (!account) {
      onNeedsWallet?.();
      wallet.requestPicker();
      return;
    }
    // The route starts on the SOURCE chain, so the wallet must be there.
    if (wallet.chainId !== src.id) {
      const ok = await wallet.ensureChain(src);
      if (!ok) {
        setStatus(`Switch your wallet to ${src.name} to start the transfer.`);
        return;
      }
    }
    const client = wallet.getWalletClient(src);
    if (!client) {
      setStatus("Wallet unavailable.");
      return;
    }

    setBusy(true);
    try {
      if (cctpOnly) {
        const hash = await bridgeViaCctp({
          from: src,
          to: dst,
          amount: parseUnits(amount, src.usdc?.decimals ?? 6),
          account,
          sourceWallet: client,
          destinationWallet: async () => {
            const ok = await wallet.ensureChain(dst);
            return ok ? wallet.getWalletClient(dst) : null;
          },
          onProgress: (p) => setStatus(p.message),
        });
        if (hash) setTxHash(hash);
      } else {
        if (!quote?.ok) {
          setStatus(quote?.reason ?? "Enter an amount to get a route.");
          return;
        }
        const hash = await executeBridge({
          quote,
          walletClient: client,
          account,
          from: src,
          onProgress: (p) => setStatus(p.message),
        });
        if (hash) setTxHash(hash);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message.split("\n")[0] : "Transfer failed.");
    } finally {
      setBusy(false);
    }
  }

  const label = !wallet.address
    ? "Connect wallet"
    : busy
      ? "Confirm in wallet…"
      : noRoute
        ? "Route not open yet"
        : `Bridge to ${dst?.shortName ?? ""}`;

  const feePct = (PLATFORM_FEE_BPS / 100).toFixed(2);

  return (
    <section className={bare ? "" : "card-surface p-4"}>
      {!bare && (
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Bridge in funds</h3>
          <span className="chip !py-0 text-[9px]">
            {rail === "cctp" ? "via Circle CCTP" : rail === "relay" ? "via Relay" : "checking…"}
          </span>
        </div>
      )}

      {/* From */}
      <div className={`rounded-xl border border-border bg-background p-3 ${bare ? "" : "mt-3"}`}>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>From</span>
          <span>{sendSymbol}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <input
            value={amount}
            inputMode="decimal"
            placeholder="0.0"
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="num min-w-0 flex-1 bg-transparent text-2xl font-light outline-none"
          />
          <ChainSelect value={fromKey} exclude={toKey} onChange={setFromKey} />
        </div>
      </div>

      <div className="relative z-10 -my-3.5 flex justify-center">
        <button
          onClick={() => {
            setPinned(true);
            setFromKey(toKey);
            setToKey(fromKey);
          }}
          title="Reverse direction"
          className="rounded-lg border border-border bg-surface p-1.5 transition-colors hover:bg-surface-elevated"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* To */}
      <div className="rounded-xl border border-border bg-background p-3">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>To</span>
          <span className="num">
            {quoting
              ? "…"
              : cctpOnly
                ? amt > 0
                  ? `${(amt * (1 - PLATFORM_FEE_BPS / 10_000)).toFixed(4)} USDC`
                  : "—"
                : quote?.ok
                  ? `${quote.amountOut} ${quote.amountOutSymbol ?? dst?.nativeCurrency.symbol}`
                  : "—"}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-end">
          <ChainSelect
            value={toKey}
            exclude={fromKey}
            onChange={(k) => {
              setPinned(true);
              setToKey(k);
            }}
          />
        </div>
      </div>

      <div className="mt-2 space-y-1 rounded-lg border border-dashed border-border p-2.5 text-[11px]">
        <Row
          label={`Fee (${feePct}%)`}
          value={
            <span className="num">
              {cctpOnly
                ? amt > 0
                  ? `${(amt * (PLATFORM_FEE_BPS / 10_000)).toFixed(4)} USDC`
                  : "—"
                : (quote?.appFeeFormatted ?? "—")}
            </span>
          }
        />
        <Row
          label="Arrives in"
          value={
            <span className="num">
              {cctpOnly
                ? "~1–15 min"
                : quote?.ok && quote.etaSeconds
                  ? `~${Math.max(1, Math.round(quote.etaSeconds / 60))} min`
                  : "—"}
            </span>
          }
        />
      </div>

      <button
        onClick={onBridge}
        disabled={busy || noRoute}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        {label}
      </button>

      {!status && wallet.error && (
        <p className="mt-2 text-center text-[11px] text-bear">{wallet.error}</p>
      )}
      {status && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {status}
          {txHash && (
            <a
              href={`${src?.explorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              view <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </p>
      )}
      {noRoute && railNote && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">{railNote}</p>
      )}
      <p className="mt-2 text-center text-[10px] text-muted-foreground">
        Funds go straight to your wallet.
      </p>
    </section>
  );
}

/** Chain picker with the logo, used on both ends of the transfer. */
function ChainSelect({
  value,
  exclude,
  onChange,
}: {
  value: string;
  exclude?: string;
  onChange: (key: string) => void;
}) {
  const c = bridgeChain(value);
  return (
    <div className="relative flex flex-shrink-0 items-center gap-1.5 rounded-full bg-surface-elevated px-2.5 py-1 text-xs font-medium">
      <BrandImage
        src={c?.logoUrl}
        alt={c?.name ?? ""}
        className="h-4 w-4 rounded-full object-cover"
        fallback={<span className="h-4 w-4 rounded-full bg-primary/60" />}
      />
      {c?.shortName ?? value}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Chain"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {BRIDGE_CHAINS.filter((x) => x.key !== exclude).map((x) => (
          <option key={x.key} value={x.key}>
            {x.name}
          </option>
        ))}
      </select>
    </div>
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
