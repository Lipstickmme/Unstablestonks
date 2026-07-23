import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { ChainSwitcher } from "./ChainSwitcher";
import { WalletButton } from "./WalletButton";

export function Header() {
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
          <button className="rounded-full bg-secondary px-3 py-1 text-foreground">Terminal</button>
          <button className="rounded-full px-3 py-1 text-muted-foreground hover:text-foreground transition-colors">
            Watchlist
          </button>
        </nav>

        <div className="ml-auto hidden max-w-md flex-1 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground sm:flex">
          <Search className="h-3.5 w-3.5" />
          <input
            className="w-full bg-transparent outline-none placeholder:text-muted-foreground/70"
            placeholder="Search token, CA, or paste address…"
          />
        </div>

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <ChainSwitcher />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
