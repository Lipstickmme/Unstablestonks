"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { base, chiliz, polygon, polygonAmoy, spicy } from "wagmi/chains";
import type { Chain } from "viem";

import { BetslipProvider } from "@/lib/betslip";

/**
 * Networks the app can run on.
 *
 * Polygon carries the prediction market and the deepest Azuro liquidity; Chiliz is the
 * fan-token chain, where bets settle in WCHZ. Testnets are only offered when the operator
 * opts in, so a production build cannot quietly point a bettor at Amoy.
 */
const showTestnets = process.env.NEXT_PUBLIC_SHOW_TESTNETS === "true";

const mainnets = [polygon, chiliz, base];
const testnets = [polygonAmoy, spicy];

const chains = (showTestnets ? [...mainnets, ...testnets] : mainnets) as unknown as readonly [
  Chain,
  ...Chain[],
];

const config = getDefaultConfig({
  appName: "BIG",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID",
  chains,
  ssr: true,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <BetslipProvider>{children}</BetslipProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
