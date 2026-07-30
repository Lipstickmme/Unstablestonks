import { Link, useRouterState } from "@tanstack/react-router";
import { LineChart, Star, Wallet } from "lucide-react";
import { BridgeIcon } from "@/components/brand/BridgeIcon";
import { useWatchlist } from "@/lib/watchlist";

/**
 * Mobile tab bar — the single change that makes this read as an app rather than
 * a website on a phone.
 *
 * Fixed to the bottom edge, above the home indicator, with the same five
 * destinations a Telegram mini app would put there. Navigation goes through the
 * route's own search params rather than local state, so a tab survives a reload
 * and can be linked to; the two that open dialogs call up instead.
 *
 * Hidden from the `sm` breakpoint up, where the header nav already does this job
 * and a bottom bar would just eat vertical space.
 */
export function TabBar({ onBridge, onQuest }: { onBridge: () => void; onQuest: () => void }) {
  const { count } = useWatchlist();
  const routerState = useRouterState();
  const path = routerState.location.pathname;
  const search = routerState.location.search as { view?: string };
  const onHome = path === "/";
  const view = onHome ? (search.view ?? "all") : "";

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl sm:hidden">
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-1 pt-1">
        <TabLink to="all" active={view === "all"} icon={<LineChart className="h-5 w-5" />}>
          Terminal
        </TabLink>
        <TabLink
          to="watch"
          active={view === "watch"}
          icon={<Star className={`h-5 w-5 ${view === "watch" ? "fill-current" : ""}`} />}
          badge={count || undefined}
        >
          Watchlist
        </TabLink>
        <TabLink to="portfolio" active={view === "portfolio"} icon={<Wallet className="h-5 w-5" />}>
          Portfolio
        </TabLink>

        <TabButton onClick={onBridge} icon={<BridgeIcon className="h-5 w-5" />}>
          Bridge
        </TabButton>
        <TabButton
          onClick={onQuest}
          icon={
            // Same framed-picture treatment as the header, scaled down.
            <span
              className="relative block rounded-[5px] p-[1.5px]"
              style={{
                background:
                  "linear-gradient(135deg,#e5e7eb 0%,#6b7280 30%,#1c1d21 55%,#9aa2ad 80%,#e5e7eb 100%)",
              }}
            >
              <span className="block rounded-[3.5px] bg-background p-[1.5px]">
                <img
                  src="/unstablestonks012.png"
                  alt=""
                  width={17}
                  height={17}
                  className="block h-[17px] w-[17px] rounded-[2px] object-cover"
                />
              </span>
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
          }
        >
          Quest
        </TabButton>
      </div>
    </nav>
  );
}

const shell =
  "tap relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-medium";

function TabLink({
  to,
  active,
  icon,
  badge,
  children,
}: {
  to: "all" | "watch" | "portfolio";
  active: boolean;
  icon: React.ReactNode;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      to="/"
      search={{ view: to }}
      className={`${shell} ${active ? "text-primary" : "text-muted-foreground"}`}
    >
      {/* The active pill pops in behind the icon rather than sliding, which
          would need shared layout state for a 200ms effect. */}
      {active && <span className="tab-pop absolute inset-x-2 inset-y-0 rounded-xl bg-secondary" />}
      <span className="relative">
        {icon}
        {badge != null && badge > 0 && (
          <span className="num absolute -right-2 -top-1 rounded-full bg-primary px-1 text-[8px] font-semibold leading-[14px] text-primary-foreground">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      <span className="relative">{children}</span>
    </Link>
  );
}

function TabButton({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className={`${shell} text-muted-foreground`}>
      <span className="relative">{icon}</span>
      <span className="relative">{children}</span>
    </button>
  );
}
