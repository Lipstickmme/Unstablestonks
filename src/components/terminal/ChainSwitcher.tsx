import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";
import { CHAIN_ORDER, CHAINS } from "@/config/chains";
import { useChain } from "@/lib/chain-context";

export function ChainSwitcher() {
  const { chainKey, chain, setChainKey } = useChain();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-surface-elevated transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="live-dot" />
        <span className="font-mono">{chain.shortName}</span>
        <span className="hidden sm:inline text-muted-foreground">· {chain.id}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        >
          {CHAIN_ORDER.map((key) => {
            const c = CHAINS[key];
            const active = key === chainKey;
            return (
              <button
                key={key}
                role="option"
                aria-selected={active}
                onClick={() => {
                  setChainKey(key);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-elevated ${
                  active ? "bg-surface-elevated" : ""
                }`}
              >
                <span
                  className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-md font-mono text-xs font-bold text-black"
                  style={{ background: c.accent }}
                >
                  {c.badge}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.name}</span>
                    {!c.live && (
                      <span className="chip border-warn/40 bg-warn/10 text-warn !py-0 text-[9px]">
                        testnet
                      </span>
                    )}
                    {active && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {c.tagline}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground/70">
                    chain {c.id} · gas {c.gasToken}
                  </span>
                </span>
              </button>
            );
          })}
          <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
            Data is pulled live per chain from RPC + block explorer.
          </div>
        </div>
      )}
    </div>
  );
}
