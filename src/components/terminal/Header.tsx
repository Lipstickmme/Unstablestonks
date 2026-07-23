import { Link } from "@tanstack/react-router";
import { Wallet, Search, Command } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-5">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground font-mono text-sm font-bold">
            P
          </div>
          <span className="font-mono text-sm font-medium tracking-tight">
            pons<span className="text-muted-foreground">/terminal</span>
          </span>
        </Link>

        <nav className="ml-4 flex items-center gap-1 rounded-full border border-border bg-surface p-1 text-xs">
          <button className="rounded-full px-3 py-1 text-muted-foreground hover:text-foreground transition-colors">
            Explore
          </button>
          <button className="rounded-full bg-secondary px-3 py-1 text-foreground">
            Terminal
          </button>
          <button className="rounded-full px-3 py-1 text-muted-foreground hover:text-foreground transition-colors">
            Watchlist
          </button>
        </nav>

        <div className="ml-auto flex flex-1 max-w-md items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          <input
            className="w-full bg-transparent outline-none placeholder:text-muted-foreground/70"
            placeholder="Search token, CA, or paste address…"
          />
          <kbd className="flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
            <Command className="h-2.5 w-2.5" /> K
          </kbd>
        </div>

        <div className="flex items-center gap-2">
          <span className="chip">
            <span className="live-dot" />
            <span className="font-mono">RH · 4663</span>
          </span>
          <button className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-elevated transition-colors">
            <Wallet className="h-3.5 w-3.5" />
            <span className="font-mono">0x2537…C579</span>
          </button>
        </div>
      </div>
    </header>
  );
}
