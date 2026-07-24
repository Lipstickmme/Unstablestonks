import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2, Zap, ExternalLink, Wallet, Info } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";
import {
  STABLE_CHAINS,
  createStableSdk,
  findUsdcRoutes,
  executeUsdcRoute,
  type StableChain,
  type StableQuote,
  type RouteView,
} from "@/lib/stable-bridge";

// Cross-chain USDC transfers on the "Stable" tab, powered by Circle CCTP via
// @stable-io/sdk. Real route finding + on-chain execution through the connected
// wallet; gasless (fees in USDC) supported.
export function StableBridge() {
  const { address, connect, getProvider } = useWallet();
  const [source, setSource] = useState<StableChain>("Base");
  const [target, setTarget] = useState<StableChain>("Arbitrum");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [gasless, setGasless] = useState(true);
  const [quote, setQuote] = useState<StableQuote | null>(null);
  const [selected, setSelected] = useState<RouteView | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);

  const to = (recipient || address || "") as `0x${string}`;
  const canQuote =
    Boolean(address) && parseFloat(amount) > 0 && source !== target && to.length === 42;

  async function getQuote() {
    setQuote(null);
    setSelected(null);
    setHash(null);
    const provider = getProvider();
    if (!provider || !address) {
      await connect();
      return;
    }
    setQuoting(true);
    try {
      const sdk = await createStableSdk(provider, address);
      const q = await findUsdcRoutes(sdk, {
        sourceChain: source,
        targetChain: target,
        amount,
        sender: address,
        recipient: to,
        gasless,
      });
      setQuote(q);
      setSelected(q.cheapest);
    } catch (e) {
      toast.error(e instanceof Error ? e.message.split("\n")[0] : "Couldn't find a route.");
    } finally {
      setQuoting(false);
    }
  }

  async function transfer() {
    const provider = getProvider();
    if (!provider || !address || !selected) return;
    setBusy(true);
    setHash(null);
    try {
      const sdk = await createStableSdk(provider, address);
      toast("Confirm the transfer in your wallet…");
      const res = await executeUsdcRoute(sdk, selected.route);
      if (!res.ok) {
        toast.error(res.reason ?? "Transfer failed.");
        return;
      }
      setHash(res.hash ?? null);
      toast.success("USDC transfer submitted via Circle CCTP.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message.split("\n")[0] : "Transfer failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <section className="card-surface fade-up p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">Stable · USDC transfers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Move native USDC across chains with Circle's Cross-Chain Transfer Protocol.
            </p>
          </div>
          <span className="chip">
            <span className="live-dot" /> CCTP
          </span>
        </div>

        {/* From / To chains */}
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <ChainSelect label="From" value={source} onChange={setSource} exclude={target} />
          <div className="pb-2.5 text-muted-foreground">
            <ArrowRight className="h-4 w-4" />
          </div>
          <ChainSelect label="To" value={target} onChange={setTarget} exclude={source} />
        </div>

        {/* Amount */}
        <div className="mt-3 rounded-xl border border-border bg-background p-3">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Amount</span>
            <span>USDC</span>
          </div>
          <input
            value={amount}
            inputMode="decimal"
            placeholder="0.0"
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="num mt-1 w-full bg-transparent text-2xl font-light outline-none"
          />
        </div>

        {/* Recipient */}
        <div className="mt-2 rounded-xl border border-border bg-background p-3">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Recipient</span>
            {address && (
              <button
                onClick={() => setRecipient(address)}
                className="text-primary hover:underline"
              >
                use my address
              </button>
            )}
          </div>
          <input
            value={recipient}
            placeholder={address ? shortAddr(address) : "0x… destination address"}
            onChange={(e) => setRecipient(e.target.value.trim())}
            className="num mt-1 w-full bg-transparent text-sm outline-none"
          />
        </div>

        {/* Gasless toggle */}
        <label className="mt-3 flex items-center justify-between rounded-lg border border-dashed border-border p-2.5 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Info className="h-3.5 w-3.5" /> Gasless — pay fees in USDC (no native gas)
          </span>
          <input
            type="checkbox"
            checked={gasless}
            onChange={(e) => setGasless(e.target.checked)}
            className="h-4 w-4 accent-[var(--primary)]"
          />
        </label>

        {/* Quotes */}
        {quote && (
          <div className="mt-4 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Routes</div>
            <RouteCard
              view={quote.cheapest}
              badge="Cheapest"
              active={selected?.route === quote.cheapest.route}
              onSelect={() => setSelected(quote.cheapest)}
            />
            {!quote.sameRoute && (
              <RouteCard
                view={quote.fastest}
                badge="Fastest"
                active={selected?.route === quote.fastest.route}
                onSelect={() => setSelected(quote.fastest)}
              />
            )}
          </div>
        )}

        {/* Action */}
        {!address ? (
          <button
            onClick={() => connect()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <Wallet className="h-4 w-4" /> Connect wallet
          </button>
        ) : !quote ? (
          <button
            onClick={getQuote}
            disabled={!canQuote || quoting}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {quoting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {quoting ? "Finding routes…" : "Find route"}
          </button>
        ) : (
          <button
            onClick={transfer}
            disabled={busy || !selected}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {busy ? "Confirm in wallet…" : `Send ${amount || ""} USDC → ${target}`}
          </button>
        )}

        {hash && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Submitted · <span className="num">{shortAddr(hash)}</span>{" "}
            <a
              href={`https://usdc.range.org/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              track <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </p>
        )}

        <p className="mt-3 text-center text-[10px] text-muted-foreground">
          Non-custodial · native USDC burn-and-mint via Circle CCTP (@stable-io/sdk). Your wallet
          must be on the source chain to sign.
        </p>
      </section>
    </div>
  );
}

function ChainSelect({
  label,
  value,
  onChange,
  exclude,
}: {
  label: string;
  value: StableChain;
  onChange: (c: StableChain) => void;
  exclude: StableChain;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as StableChain)}
        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
      >
        {STABLE_CHAINS.filter((c) => c !== exclude).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

function RouteCard({
  view,
  badge,
  active,
  onSelect,
}: {
  view: RouteView;
  badge: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-xl border p-3 text-left transition-colors ${
        active ? "border-primary bg-primary/5" : "border-border hover:bg-surface-elevated"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="chip !py-0 text-[9px]">{badge}</span>
        <span className="num text-xs text-muted-foreground">{view.corridor}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span>
          <span className="text-muted-foreground text-xs">est. cost </span>
          <span className="num font-medium">{view.cost}</span>
        </span>
        <span>
          <span className="text-muted-foreground text-xs">~ </span>
          <span className="num font-medium">{view.duration}</span>
        </span>
      </div>
    </button>
  );
}
