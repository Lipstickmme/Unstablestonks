import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  formatNum,
  formatUSD,
  shortAddr,
  type OnchainToken,
} from "@/lib/onchain";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Users, Zap } from "lucide-react";
import { Soon, TokenIcon } from "./common";

type SortKey = "mcap" | "vol24h" | "holders" | "price";

export function TokenTable({ tokens }: { tokens: OnchainToken[] }) {
  const [sort, setSort] = useState<SortKey>("vol24h");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    let r = tokens;
    if (query) {
      const q = query.toLowerCase();
      r = r.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.address.toLowerCase().includes(q),
      );
    }
    return [...r].sort((a, b) => {
      const av = a[sort] as number;
      const bv = b[sort] as number;
      return dir === "desc" ? bv - av : av - bv;
    });
  }, [tokens, sort, dir, query]);

  function toggleSort(k: SortKey) {
    if (sort === k) setDir(dir === "desc" ? "asc" : "desc");
    else {
      setSort(k);
      setDir("desc");
    }
  }

  const H = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors ${right ? "ml-auto" : ""}`}
    >
      {label}
      {sort === k && (dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
    </button>
  );

  return (
    <section className="card-surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-1 text-xs">
          <span className="rounded-full bg-secondary px-3 py-1.5 font-medium">Live tokens</span>
          <span className="chip">{rows.length}</span>
          <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            filters <Soon label="soon" />
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter symbol, name, or CA…"
            className="w-56 rounded-full border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-ring"
          />
          <span className="chip">
            <span className="live-dot" /> Blockscout
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-elevated/40 text-left">
              <th className="px-4 py-2.5 w-[26%]">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Token</span>
              </th>
              <th className="px-2 py-2.5 text-right"><H k="price" label="Price" right /></th>
              <th className="px-2 py-2.5 text-right"><H k="mcap" label="Mkt cap" right /></th>
              <th className="px-2 py-2.5 text-right"><H k="vol24h" label="V·24h" right /></th>
              <th className="px-2 py-2.5 text-right"><H k="holders" label="Holders" right /></th>
              <th className="px-2 py-2.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                  Graduation <Soon label="soon" />
                </span>
              </th>
              <th className="px-2 py-2.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                  Social <Soon label="soon" />
                </span>
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted-foreground">Trade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.address} className="group border-b border-border/60 hover:bg-surface-elevated/60 transition-colors">
                <td className="px-4 py-3">
                  <Link
                    to="/token/$address"
                    params={{ address: t.address }}
                    className="flex items-center gap-3"
                  >
                    <TokenIcon iconUrl={t.iconUrl} symbol={t.symbol} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{t.symbol}</span>
                        <span className="text-xs text-muted-foreground truncate">{t.name}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="num">{shortAddr(t.address)}</span>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            navigator.clipboard.writeText(t.address);
                          }}
                          className="opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <a
                          href={`https://robinhoodchain.blockscout.com/token/${t.address}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  </Link>
                </td>
                <td className="px-2 py-3 num text-right text-xs">{formatUSD(t.price)}</td>
                <td className="px-2 py-3 num text-right text-xs">{formatUSD(t.mcap)}</td>
                <td className="px-2 py-3 num text-right text-xs">{formatUSD(t.vol24h)}</td>
                <td className="px-2 py-3 num text-right text-xs inline-flex items-center gap-1 justify-end w-full">
                  <Users className="h-3 w-3 text-muted-foreground" /> {formatNum(t.holders)}
                </td>
                <td className="px-2 py-3">
                  <Soon />
                </td>
                <td className="px-2 py-3">
                  <Soon />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to="/token/$address"
                    params={{ address: t.address }}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    <Zap className="h-3 w-3" /> View
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-xs text-muted-foreground">
                  Loading tokens from Blockscout…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
