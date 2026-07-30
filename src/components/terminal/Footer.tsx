import { Link } from "@tanstack/react-router";
import { MessageCircle, Send } from "lucide-react";
import { COMMUNITY, baseBotUrl } from "@/config/links";
import { BRAND_IMAGE_URL } from "@/config/brand";

/**
 * Site footer.
 *
 * The community links are the same ones the whitelist quest sends people to —
 * imported from one place rather than retyped, so a channel move updates both
 * the quest and the footer at once and they can never disagree.
 *
 * On mobile it sits above the tab bar, which the app-shell padding already
 * accounts for.
 */

/** X's mark isn't in lucide, and the brand is the logo — so it's drawn here. */
function XIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const SOCIALS = [
  { href: COMMUNITY.x, label: "X", icon: <XIcon className="h-4 w-4" />, handle: "@Unstablestonks" },
  {
    href: COMMUNITY.telegramChannel,
    label: "Telegram channel",
    icon: <Send className="h-4 w-4" />,
    handle: "Announcements",
  },
  {
    href: COMMUNITY.telegramGroup,
    label: "Telegram group",
    icon: <MessageCircle className="h-4 w-4" />,
    handle: "Chat",
  },
];

export function Footer() {
  return (
    <footer className="mt-2 border-t border-border">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-3 py-6 sm:px-5 sm:py-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <img
              src={BRAND_IMAGE_URL}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 flex-shrink-0 rounded-lg object-cover"
            />
            <div>
              <div className="text-sm font-medium">UnstableStonks</div>
              <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-muted-foreground">
                A non-custodial multichain launchpad terminal. Every figure is pulled live from the
                chain and its indexers — nothing is simulated.
              </p>
            </div>
          </div>

          <nav className="flex flex-wrap gap-2">
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noreferrer"
                aria-label={s.label}
                className="tap inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {s.icon}
                <span className="flex flex-col leading-tight">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-[10px] text-muted-foreground">{s.handle}</span>
                </span>
              </a>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
          <Link to="/" search={{ view: "all" }} className="hover:text-foreground">
            Terminal
          </Link>
          <Link to="/" search={{ view: "watch" }} className="hover:text-foreground">
            Watchlist
          </Link>
          <Link to="/" search={{ view: "portfolio" }} className="hover:text-foreground">
            Portfolio
          </Link>
          <a href={baseBotUrl()} target="_blank" rel="noreferrer" className="hover:text-foreground">
            Trade on BasedBot
          </a>
          <span className="ml-auto">Not financial advice. Trade at your own risk.</span>
        </div>
      </div>
    </footer>
  );
}
