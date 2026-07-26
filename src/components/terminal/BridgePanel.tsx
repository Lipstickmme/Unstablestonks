import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import { ArrowRight, Loader2, ExternalLink, Zap } from "lucide-react";
import { CHAINS, CHAIN_ORDER, type ChainKey } from "@/config/chains";
import { useChain } from "@/lib/chain-context";
import { useWallet } from "@/lib/wallet";
import { getBridgeQuote, executeBridge, type BridgeQuote } from "@/lib/bridge";

/**
 * Cross-chain top-up. Deliberately minimal: pick a source chain and an amount,
 * press one button, sign. The routing steps Relay returns are never shown —
 * only the wallet prompts and a single status line.
 */
/**
 * `bare` drops the card chrome and heading so the panel can sit inside the
 * header's bridge dialog, which supplies its own.
 */
export function BridgePanel({ bare = false }: { bare?: boolean } = {}) {
  const { chain, chainKey } = useChain();
  const wallet = useWallet();

  const sources = CHAIN_ORDER.filter((k) => k !== chainKey);
  const [from, setFrom] = useState<ChainKey>(sources[0] ?? "robinhood");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const src = CHAINS[from];
  const amt = parseFloat(amount) || 0;

  // Switching the terminal to the chain currently selected as the source would
  // leave origin === destination, which Relay rejects with a bare "no route".
  // Move the selection to another chain instead.
  useEffect(() => {
    if (from === chainKey && sources.length) setFrom(sources[0]);
  }, [from, chainKey, sources]);

  // Live quote, debounced.
  useEffect(() => {
    if (!wallet.address || amt <= 0) {
      setQuote(null);
      return;
    }
    let cancel = false;
    setQuoting(true);
    const id = setTimeout(async () => {
      const q = await getBridgeQuote({
        user: wallet.address as `0x${string}`,
        from,
        to: chainKey,
        amount: parseUnits(amount, src.nativeCurrency.decimals).toString(),
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
  }, [wallet.address, amount, amt, from, chainKey, src.nativeCurrency.decimals]);

  async function onBridge() {
    setStatus(null);
    setTxHash(null);
    if (!wallet.address) {
      wallet.connect();
      return;
    }
    // The route starts on the SOURCE chain, so the wallet must be there.
    if (wallet.chainId !== src.id) {
      const ok = await wallet.ensureChain(src);
      if (!ok) {
        setStatus(`Switch your wallet to ${src.name} to start the bridge.`);
        return;
      }
    }
    if (!quote?.ok) {
      setStatus(quote?.reason ?? "Enter an amount to get a route.");
      return;
    }
    const client = wallet.getWalletClient(src);
    if (!client) {
      setStatus("Wallet unavailable.");
      return;
    }

    setBusy(true);
    try {
      const hash = await executeBridge({
        quote,
        walletClient: client,
        account: wallet.address,
        from,
        onProgress: (p) => setStatus(p.message),
      });
      if (hash) setTxHash(hash);
    } catch (e) {
      setStatus(e instanceof Error ? e.message.split("\n")[0] : "Bridge failed.");
    } finally {
      setBusy(false);
    }
  }

  const label = !wallet.address
    ? "Connect wallet"
    : busy
      ? "Confirm in wallet…"
      : `Bridge to ${chain.shortName}`;

  return (
    <section className={bare ? "" : "card-surface p-4"}>
      {!bare && (
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Bridge in funds</h3>
          <span className="chip !py-0 text-[9px]">via Relay</span>
        </div>
      )}

      <div className={`flex items-center gap-2 text-xs ${bare ? "" : "mt-3"}`}>
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value as ChainKey)}
          className="rounded-lg border border-border bg-background px-2 py-1.5 outline-none"
        >
          {sources.map((k) => (
            <option key={k} value={k}>
              {CHAINS[k].name}
            </option>
          ))}
        </select>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{chain.name}</span>
      </div>

      <div className="mt-2 rounded-xl border border-border bg-background p-3">
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>You send</span>
          <span>{src.nativeCurrency.symbol}</span>
        </div>
        <input
          value={amount}
          inputMode="decimal"
          placeholder="0.0"
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="num mt-1 w-full bg-transparent text-2xl font-light outline-none"
        />
      </div>

      <div className="mt-2 space-y-1 rounded-lg border border-dashed border-border p-2.5 text-[11px]">
        <Row
          label="You receive"
          value={
            <span className="num">
              {quoting
                ? "…"
                : quote?.ok
                  ? `${quote.amountOut} ${chain.nativeCurrency.symbol}`
                  : "—"}
            </span>
          }
        />
        <Row
          label="Arrives in"
          value={
            <span className="num">
              {quote?.ok && quote.etaSeconds
                ? `~${Math.max(1, Math.round(quote.etaSeconds / 60))} min`
                : "—"}
            </span>
          }
        />
      </div>

      <button
        onClick={onBridge}
        disabled={busy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        {label}
      </button>

      {status && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {status}
          {txHash && (
            <a
              href={`${src.explorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              view <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </p>
      )}
      <p className="mt-2 text-center text-[10px] text-muted-foreground">
        Non-custodial · settled by Relay · funds go straight to your wallet.
      </p>
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
