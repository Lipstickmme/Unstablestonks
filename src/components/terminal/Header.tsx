import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { useWatchlist } from "@/lib/watchlist";
import { ChainSwitcher } from "./ChainSwitcher";
import { WalletButton } from "./WalletButton";
import { BridgeModal } from "./BridgeModal";
import { WhitelistModal } from "./WhitelistModal";
import { BridgeIcon } from "@/components/brand/BridgeIcon";
import { SearchBox } from "./SearchBox";
import { TabBar } from "./TabBar";

export function Header() {
  const { count } = useWatchlist();
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [whitelistOpen, setWhitelistOpen] = useState(false);
  const routerState = useRouterState();
  const path = routerState.location.pathname;
  const search = routerState.location.search as { view?: string };
  const onHome = path === "/";
  const watchActive = onHome && search.view === "watch";

  const navBase = "rounded-full px-3 py-1 transition-colors";
  const navActive = "bg-secondary text-foreground";
  const navIdle = "text-muted-foreground hover:text-foreground";

  return (
    // The tab bar is a SIBLING of <header>, not a child. `backdrop-filter`
    // establishes a containing block for fixed descendants, so a fixed bar
    // nested inside the blurred header would anchor to the header instead of
    // the viewport and sit at the top of the page.
    <>
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
            {/* Bridging isn't token-specific, so it lives here rather than on a
              token page, and opens as a dialog exactly like quick-buy.
              Whitelist quest is framed so it reads as a badge rather than
              another tool icon.

              Both move to the mobile tab bar below the `sm` breakpoint — a
              phone header with five controls in it is the thing that stops a
              web app feeling like an app. */}
            <button
              onClick={() => setWhitelistOpen(true)}
              title="NFT whitelist — complete the tasks to claim a spot"
              aria-label="NFT whitelist"
              className="tap relative hidden rounded-full p-[1.5px] transition-transform hover:scale-105 sm:block"
              style={{
                background:
                  "linear-gradient(135deg,#e5e7eb 0%,#6b7280 30%,#1c1d21 55%,#9aa2ad 80%,#e5e7eb 100%)",
              }}
            >
              <img
                src="/unstablestonks012.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 rounded-full object-cover"
              />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
            </button>
            <button
              onClick={() => setBridgeOpen(true)}
              title="Bridge funds in"
              aria-label="Bridge funds in"
              className="tap hidden h-8 w-8 place-items-center rounded-full border border-border bg-surface text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground sm:grid"
            >
              <BridgeIcon className="h-4 w-4" />
            </button>
            <ChainSwitcher />
            <WalletButton />
          </div>
        </div>

        {/* Mobile search row */}
        <div className="border-t border-border px-3 py-2 sm:hidden">
          <SearchBox className="flex w-full" />
        </div>
      </header>

      <TabBar onBridge={() => setBridgeOpen(true)} onQuest={() => setWhitelistOpen(true)} />

      {bridgeOpen && <BridgeModal onClose={() => setBridgeOpen(false)} />}
      {whitelistOpen && <WhitelistModal onClose={() => setWhitelistOpen(false)} />}
    </>
  );
}
