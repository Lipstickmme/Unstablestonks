import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Search, Star } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { useWatchlist } from "@/lib/watchlist";
import { ChainSwitcher } from "./ChainSwitcher";
import { WalletButton } from "./WalletButton";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

function SearchBox({ className = "" }: { className?: string }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if (ADDR_RE.test(v)) {
      navigate({ to: "/token/$address", params: { address: v } });
    } else {
      navigate({ to: "/", search: { q: v, view: "all" } });
    }
    setQ("");
  };

  return (
    <form
      onSubmit={submit}
      className={`items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground ${className}`}
    >
      <Search className="h-3.5 w-3.5 flex-shrink-0" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70"
        placeholder="Search symbol, name, or paste CA…"
      />
    </form>
  );
}

export function Header() {
  const { count } = useWatchlist();
  const routerState = useRouterState();
  const path = routerState.location.pathname;
  const search = routerState.location.search as { view?: string };
  const onHome = path === "/";
  const watchActive = onHome && search.view === "watch";

  const navBase = "rounded-full px-3 py-1 transition-colors";
  const navActive = "bg-secondary text-foreground";
  const navIdle = "text-muted-foreground hover:text-foreground";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 sm:gap-4 sm:px-5">
        <Link to="/" className="flex items-center">
          <span className="hidden sm:block">
            <Logo />
          </span>
          <span className="sm:hidden">
            <Logo compact />
          </span>
        </Link>

        <nav className="ml-1 hidden items-center gap-1 rounded-full border border-border bg-surface p-1 text-xs md:flex">
          <Link
            to="/"
            search={{ view: "all" }}
            className={`${navBase} ${onHome && !watchActive ? navActive : navIdle}`}
          >
            Terminal
          </Link>
          <Link
            to="/"
            search={{ view: "watch" }}
            className={`${navBase} inline-flex items-center gap-1 ${watchActive ? navActive : navIdle}`}
          >
            <Star className={`h-3 w-3 ${watchActive ? "fill-current" : ""}`} />
            Watchlist
            {count > 0 && <span className="num text-[10px] text-muted-foreground">{count}</span>}
          </Link>
        </nav>

        <SearchBox className="ml-auto hidden max-w-md flex-1 sm:flex" />

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <ChainSwitcher />
          <WalletButton />
        </div>
      </div>

      {/* Mobile search row */}
      <div className="border-t border-border px-3 py-2 sm:hidden">
        <SearchBox className="flex w-full" />
      </div>
    </header>
  );
}
