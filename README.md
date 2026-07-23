# UnstableStonks

A mobile-first, non-custodial **multichain launchpad terminal**. One terminal that
switches live between three networks and pulls **real, free on-chain data** for each —
no mock feeds.

## Chains

| Chain | ID | Gas | Data | Status |
| --- | --- | --- | --- | --- |
| **Robinhood Chain** | 4663 | ETH | RPC + Blockscout (`robinhoodchain.blockscout.com`) | mainnet |
| **Stable** | 988 | gUSDT | RPC + StableScan | mainnet |
| **Arc** (Circle) | 5042002 | USDC | RPC + ArcScan | testnet |

The active chain is stored in `localStorage` and reskins the UI via a per-chain accent.

## What's real

- **On-chain data** — token registry, holders, market cap, 24h volume and transfers come
  live from each chain's Blockscout v2 API; block height and gas come straight off JSON-RPC
  via [viem](https://viem.sh). DEX price/OHLCV/trades enrich from GeckoTerminal where a chain
  is indexed. Anything a source can't provide is shown as `—`, never invented.
- **X social crawl** — a server function (`src/lib/x-social.ts`) searches X for a contract
  address: official X API v2 when `X_BEARER_TOKEN` is set (true impressions/engagement),
  Nitter fallback otherwise. Reach feeds a 0–100 social-heat score on the token page.
- **Quick swaps + fee collection** — connect any injected wallet, switch/add the chain, and
  swap. Every swap routes a **1% platform fee** to the treasury
  `0x6E53C6288Dc2C0F957Dc1F5E7d78874c3223CC96` on all chains (a plain transfer, so it works
  everywhere), then swaps the remainder through the chain's configured DEX router.

## Configuration

Everything runs against public endpoints out of the box. Copy `.env.example` to `.env` to
override RPCs, set DEX router addresses (enables the swap leg per chain), or add an X API key.

## Development

```sh
bun install
bun run dev      # local dev
bun run build    # production build
bun run lint     # eslint + prettier
```

## Built with

TanStack Start · React 19 · TypeScript · Tailwind CSS · viem · TanStack Query
