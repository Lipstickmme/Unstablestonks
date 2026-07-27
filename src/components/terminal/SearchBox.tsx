import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, CornerDownLeft } from "lucide-react";
import { useTokens } from "@/lib/data/hooks";
import { useChain } from "@/lib/chain-context";
import { formatUSD, shortAddr } from "@/lib/format";
import type { TokenRow } from "@/lib/types";
import { TokenIcon } from "./TokenIcon";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_SUGGESTIONS = 7;

/**
 * Score a token against a query. Lower is better; -1 means no match.
 *
 * Ranking matters more than filtering here: typing "US" should surface USDT
 * before a token merely containing "us" somewhere in its name, otherwise the
 * list looks arbitrary and the first suggestion is rarely the one wanted.
 */
function rank(t: TokenRow, q: string): number {
  const sym = t.symbol.toLowerCase();
  const name = t.name.toLowerCase();
  const addr = t.address.toLowerCase();

  if (sym === q) return 0;
  if (addr === q) return 1;
  if (sym.startsWith(q)) return 2;
  if (name.startsWith(q)) return 3;
  if (sym.includes(q)) return 4;
  if (name.includes(q)) return 5;
  if (addr.includes(q)) return 6;
  return -1;
}

export function SearchBox({ className = "" }: { className?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const { chain } = useChain();
  const tokensQ = useTokens();
  const wrapRef = useRef<HTMLDivElement>(null);

  const query = q.trim().toLowerCase();
  const isAddress = ADDR_RE.test(q.trim());

  const suggestions = useMemo(() => {
    if (query.length < 1) return [] as TokenRow[];
    return (
      (tokensQ.data ?? [])
        .map((t) => ({ t, r: rank(t, query) }))
        .filter((x) => x.r >= 0)
        // Same relevance tier: the busier token is the more likely target.
        .sort((a, b) => a.r - b.r || b.t.vol24h - a.t.vol24h)
        .slice(0, MAX_SUGGESTIONS)
        .map((x) => x.t)
    );
  }, [tokensQ.data, query]);

  // A full contract address that isn't in the list is still openable — that's
  // the whole point of pasting one, and new launches are routinely not indexed.
  const showRawAddress = isAddress && !suggestions.some((t) => t.address.toLowerCase() === query);
  const rows: ({ kind: "token"; token: TokenRow } | { kind: "address"; value: string })[] = [
    ...(showRawAddress ? [{ kind: "address" as const, value: q.trim() }] : []),
    ...suggestions.map((token) => ({ kind: "token" as const, token })),
  ];

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const goToToken = (address: string) => {
    setOpen(false);
    setQ("");
    navigate({ to: "/token/$address", params: { address } });
  };

  /** Enter with nothing highlighted: filter the terminal list instead. */
  const filterList = () => {
    const v = q.trim();
    if (!v) return;
    setOpen(false);
    setQ("");
    navigate({ to: "/", search: { q: v, view: "all" } });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const picked = rows[cursor];
    if (picked?.kind === "token") goToToken(picked.token.address);
    else if (picked?.kind === "address") goToToken(picked.value);
    else filterList();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!rows.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => (c + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => (c - 1 + rows.length) % rows.length);
    }
  };

  const showPanel = open && query.length > 0;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <form
        onSubmit={submit}
        className="flex w-full items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground focus-within:border-ring"
      >
        <Search className="h-3.5 w-3.5 flex-shrink-0" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70"
          placeholder="Search symbol, name, or paste CA…"
          aria-label="Search tokens"
          aria-expanded={showPanel}
          autoComplete="off"
          spellCheck={false}
        />
      </form>

      {showPanel && (
        <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
          {rows.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-muted-foreground">
              {tokensQ.isLoading
                ? "Loading tokens…"
                : `No match on ${chain.name}. Press Enter to search the full list, or paste a contract address.`}
            </div>
          ) : (
            <ul role="listbox">
              {rows.map((row, i) => {
                const active = i === cursor;
                if (row.kind === "address") {
                  return (
                    <li key="raw-address">
                      <button
                        type="button"
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => goToToken(row.value)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                          active ? "bg-surface-elevated" : ""
                        }`}
                      >
                        <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-secondary text-[9px]">
                          CA
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">Open contract</span>
                          <span className="num block text-[10px] text-muted-foreground">
                            {shortAddr(row.value)}
                          </span>
                        </span>
                        <CornerDownLeft className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </li>
                  );
                }
                const t = row.token;
                return (
                  <li key={t.address}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => goToToken(t.address)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                        active ? "bg-surface-elevated" : ""
                      }`}
                    >
                      <TokenIcon url={t.logoUrl} symbol={t.symbol} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{t.symbol}</span>
                          <span className="truncate text-[11px] text-muted-foreground">
                            {t.name}
                          </span>
                        </span>
                        <span className="num block text-[10px] text-muted-foreground">
                          {shortAddr(t.address)}
                        </span>
                      </span>
                      <span className="num flex-shrink-0 text-[11px]">
                        {t.price > 0 ? formatUSD(t.price) : "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  onClick={filterList}
                  className="w-full border-t border-border px-3 py-2 text-left text-[10px] text-muted-foreground hover:bg-surface-elevated"
                >
                  Filter the terminal list for “{q.trim()}”
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
