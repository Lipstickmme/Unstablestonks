import { useState } from "react";
import { ArrowDown, Settings2, Zap, Lock } from "lucide-react";
import { formatUSD, type TokenRow } from "@/lib/mock-data";

export function SwapPanel({ token }: { token: TokenRow }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.5");
  const [slip, setSlip] = useState(1);

  const amtNum = parseFloat(amount) || 0;
  const ethPrice = 3400;
  const usd = side === "buy" ? amtNum * ethPrice : amtNum * token.price;
  const outTokens = side === "buy" ? usd / token.price : amtNum;
  const impact = Math.min(9, (usd / (token.liquidityEth * ethPrice)) * 100);

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
        <button className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface-elevated">
          <Settings2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-2">
        <div className="rounded-xl border border-border bg-background p-3">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>You pay</span>
            <span>Balance: 2.481 ETH</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="num flex-1 bg-transparent text-2xl font-light outline-none"
            />
            <div className="flex items-center gap-1.5 rounded-full bg-surface-elevated px-2.5 py-1 text-xs font-medium">
              <div className="h-4 w-4 rounded-full bg-primary/70" />
              {side === "buy" ? "WETH" : token.symbol}
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="num">≈ {formatUSD(usd)}</span>
            <div className="flex gap-1">
              {["25%", "50%", "MAX"].map((p) => (
                <button key={p} className="rounded px-1.5 py-0.5 text-[10px] hover:bg-surface-elevated">{p}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-center -my-3.5 relative z-10">
          <div className="rounded-lg border border-border bg-surface p-1.5">
            <ArrowDown className="h-3.5 w-3.5" />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background p-3">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>You receive</span>
            <span>1 {token.symbol} = {formatUSD(token.price)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="num flex-1 text-2xl font-light">
              {outTokens.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-surface-elevated px-2.5 py-1 text-xs font-medium">
              <span className="text-base">{token.logo}</span>
              {side === "buy" ? token.symbol : "WETH"}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 rounded-lg border border-dashed border-border p-2.5 text-[11px]">
        <Row label="Price impact" value={<span className={impact > 3 ? "text-warn" : "text-muted-foreground"}>{impact.toFixed(2)}%</span>} />
        <Row label="Slippage" value={
          <div className="flex items-center gap-1">
            {[0.5, 1, 3].map((s) => (
              <button key={s} onClick={() => setSlip(s)}
                className={`rounded px-1.5 py-0.5 text-[10px] ${slip === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{s}%</button>
            ))}
          </div>
        } />
        <Row label="Pool" value={<span className="num">RH-Uni v3 · 1% fee</span>} />
        <Row label="Router" value={<span className="num">0xCaf6…5cb2</span>} />
        <Row label="Liquidity" value={
          <span className="inline-flex items-center gap-1 text-bull">
            <Lock className="h-2.5 w-2.5" /> Locked
          </span>
        } />
      </div>

      <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
        <Zap className="h-4 w-4" />
        {side === "buy" ? "Buy" : "Sell"} {token.symbol}
      </button>
      <p className="mt-2 text-center text-[10px] text-muted-foreground">
        Non-custodial · direct wallet signature · never routed off-chain.
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
