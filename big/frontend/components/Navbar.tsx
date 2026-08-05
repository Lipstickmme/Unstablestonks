"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAccount, useReadContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { DarkModeToggle } from "./DarkModeToggle";
import { CONTRACT_ADDRESS, isValidContractAddress } from "@/lib/contract";
import { BIG_MARKET_ABI } from "@/lib/abi";

export function Navbar() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { address, isConnected } = useAccount();

  const { data: owner } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "owner",
    query: { enabled: isValidContractAddress() && isConnected },
  });

  const isOwner = !!(owner && address && typeof owner === "string" && owner.toLowerCase() === address.toLowerCase());

  const navItems: Array<{ href: string; label: string; tag?: string; external?: boolean; ownerOnly?: boolean }> = [
    { href: "/sports", label: "Sports" },
    { href: "/casino/crash", label: "RugRush" },
    { href: "/", label: "Predictions" },
    { href: "/wallet", label: "Wallet" },
    { href: "/portfolio", label: "Portfolio" },
    { href: "/create", label: "Create" },
    { href: "/whitelist", label: "Whitelist", ownerOnly: true },
  ];

  const visible = navItems.filter((item) => !item.ownerOnly || isOwner);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 dark:border-white/10 bg-[var(--bg)]/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 lg:px-6 overflow-visible">
        <div className="flex items-center justify-between h-20">
          <div className="flex items-center gap-8 overflow-visible">
            <Link href="/" className="flex items-center gap-2 overflow-visible">
              <div className="relative flex flex-col items-start overflow-visible -mt-2">
                <div className="flex items-center gap-2">
                  <Image src="/logo.png" alt="BIG Market" width={420} height={108} className="h-[108px] w-auto object-contain" priority />
                  <span className="text-2xl" aria-label="Nigeria flag">🇳🇬</span>
                </div>
                <span className="px-2 py-0.5 text-[12px] leading-none font-semibold rounded bg-orange-500 text-white -mt-1">
                  Beta
                </span>
              </div>
            </Link>
            <div className="hidden md:flex items-center gap-1">
              {visible.map((item) => {
                const active = pathname === item.href;
                const linkClass = `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-orange-500/20 dark:bg-white/10 text-orange-700 dark:text-white"
                    : "text-gray-600 dark:text-neutral-400 hover:text-orange-500 dark:hover:text-orange-400 hover:bg-gray-100 dark:hover:bg-white/5"
                }`;
                if (item.external) {
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`relative group ${linkClass}`}
                    >
                      {item.label}
                      {item.tag && (
                        <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {item.tag}
                        </span>
                      )}
                    </a>
                  );
                }
                return (
                  <Link key={item.href} href={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <DarkModeToggle />
            <div className="hidden md:block">
              <ConnectButton />
            </div>
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen((o) => !o)}
              className="md:hidden p-2 rounded-lg text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10"
              aria-label="Menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isMobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {typeof document !== "undefined" &&
        isMobileMenuOpen &&
        createPortal(
          <>
            <div
              className="fixed inset-0 bg-black/50 z-[10002] md:hidden"
              style={{ top: 0, left: 0, right: 0, bottom: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              aria-hidden
            />
            <div
              className="fixed top-0 right-0 h-full w-72 max-w-[85vw] bg-[var(--bg)] border-l border-gray-200 dark:border-white/10 z-[10003] md:hidden flex flex-col shadow-2xl"
              style={{ transform: "translateX(0)" }}
              role="dialog"
              aria-label="Menu"
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-white/10">
                <span className="font-semibold text-[var(--fg)]">Menu</span>
                <button type="button" onClick={() => setIsMobileMenuOpen(false)} className="p-2 rounded-lg text-gray-500 dark:text-neutral-400 hover:text-[var(--fg)]" aria-label="Close">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {visible.map((item) => {
                  const active = pathname === item.href;
                  const linkClass = `block px-4 py-3 rounded-lg text-sm font-medium ${active ? "bg-orange-500/20 dark:bg-white/10 text-orange-700 dark:text-white" : "text-gray-600 dark:text-neutral-400 hover:text-orange-500 dark:hover:text-orange-400 hover:bg-gray-100 dark:hover:bg-white/5"}`;
                  if (item.external) {
                    return (
                      <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" className={linkClass} onClick={() => setIsMobileMenuOpen(false)}>
                        {item.label} {item.tag && <span className="text-amber-400 text-xs">({item.tag})</span>}
                      </a>
                    );
                  }
                  return (
                    <Link key={item.href} href={item.href} className={linkClass} onClick={() => setIsMobileMenuOpen(false)}>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
              <div className="p-4 border-t border-gray-200 dark:border-white/10">
                <ConnectButton />
              </div>
            </div>
          </>,
          document.body
        )}
    </nav>
  );
}
