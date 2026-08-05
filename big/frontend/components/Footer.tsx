"use client";

import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-white/10 bg-black py-6">
      <div className="max-w-7xl mx-auto px-4 lg:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-neutral-400">
          <Link href="/docs" className="hover:text-orange-400 transition-colors">
            Docs
          </Link>
          <Link href="/fairness" className="hover:text-orange-400 transition-colors">
            Provably fair
          </Link>
          <Link href="/account/vip" className="hover:text-orange-400 transition-colors">
            VIP
          </Link>
          <Link
            href="/account/responsible"
            className="hover:text-orange-400 transition-colors"
          >
            Responsible gambling
          </Link>
          <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
            18+
          </span>
        </div>
        <div className="flex items-center gap-5">
          <a
            href="https://x.com/GIBISBIG"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-400 hover:text-amber-400 transition-colors"
            aria-label="X (Twitter)"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
          <a
            href="https://t.co/fRWnGUs2ul"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-400 hover:text-amber-400 transition-colors"
            aria-label="Telegram"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
