import { useState } from "react";
import { ArrowDown, Settings2, Zap, Lock } from "lucide-react";
import { formatUSD, type OnchainToken } from "@/lib/onchain";
import { Soon } from "./common";

export function SwapPanel({ token }: { token: OnchainToken }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.5");

  const amtNum = parseFloat(amount) || 0;
  const ethPrice = 1900;
  const usd = side === "buy" ? amtNum * ethPrice : amtNum * token.price;
  const outTokens = side === "buy" ? (token.price ? usd / token.price : 0) : amtNum;

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
        <div className="flex items-center gap-2">
          <Soon label="swap coming soon" />
          <button className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface-elevated">
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2 opacity-70">
        <div className="rounded-xl border border-border bg-background p-3">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>You pay</span>
            <span>Connect wallet →</span>
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
          <div className="mt-1 text-[11px] text-muted-foreground num">≈ {formatUSD(usd)}</div>
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
              {side === "buy" ? token.symbol : "WETH"}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 rounded-lg border border-dashed border-border p-2.5 text-[11px]">
        <Row label="Pool" value={<span className="num">Uniswap V3 · 1% fee</span>} />
        <Row label="Slippage" value={<Soon label="soon" />} />
        <Row label="Router" value={<Soon label="soon" />} />
        <Row
          label="Liquidity"
          value={
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Lock className="h-2.5 w-2.5" /> <Soon label="soon" />
            </span>
          }
        />
      </div>

      <button
        disabled
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary/40 py-3 text-sm font-semibold text-primary-foreground cursor-not-allowed"
      >
        <Zap className="h-4 w-4" />
        Non-custodial swap · coming soon
      </button>
      <p className="mt-2 text-center text-[10px] text-muted-foreground">
        Wallet signing routes directly to the pool once wallet connect ships. No custody, ever.
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
