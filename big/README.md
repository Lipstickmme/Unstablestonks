# BIG

A multi-chain betting platform: an **Azuro-powered sportsbook**, a **prediction market**,
and a **provably-fair crash game** — with fiat rails in and out.

Runs on **Polygon**, **Chiliz** and **Base**.

> Full breakdown of what was missing and what was built: [`GAP_ANALYSIS.md`](./GAP_ANALYSIS.md)

---

## What's here

### Sportsbook — Azuro Protocol v3

Not football-only. The book renders whatever the protocol is quoting, across Azuro's whole
sport catalogue: **128 sports and esports titles**, keyed by the feed's own sport ids. No
code path special-cases a sport.

- Prematch and live markets, grouped into readable market cards
- Live odds over WebSocket, with a price flash on movement
- Singles and combos, with the protocol's per-leg fee modifier
- Slippage protection — a floor price is signed into every order
- Early cashout on open positions
- Freebets, with restrictions checked before the bettor signs
- Affiliate GGR accrues to the operator's configured address

Bets are placed by EIP-712 signature and submitted through Azuro's relayer — the bettor
sends no transaction. The relayer fee is charged **in the bet token**, so approvals cover
`stake + fee` and the betslip shows the fee before asking for a signature.

### Prediction market — `BigMarketV5`

Parimutuel markets on any question, upgraded from V4 to close three ways user funds could
get stranded:

- **Empty winning pool** no longer traps the pool — it refunds
- **Cancellation + refunds** for markets that cannot be settled
- **Propose → dispute window → finalize**, with permissionless finalisation and a bonded
  challenge path, instead of one instant owner call

Plus early exit from a position, creator fee share, and batch claims.

### RugRush — crash, with a twist

Every round is a simulated token launch. The curve is the token's market cap going
parabolic; the crash is the rug. Buy in before launch, sell before it rugs.

Provably fair by on-chain commit-reveal — the same derivation runs in Solidity and in the
browser, and `/fairness` lets anyone recompute a settled round from the revealed seed
without trusting this app.

The token's name, ticker and badges come from the round's **public commit hash**, never
from the secret seed — so none of the flavour leaks where the rug lands, and the UI says
so.

### Wallet — fiat in and out

Provider-agnostic on-ramp and off-ramp (Transak, MoonPay, Mercuryo). Money arrives as the
same token the book settles in, ready to stake. Webhooks are signature-verified per
provider. A provider with no key configured is hidden, not shown broken.

On Chiliz, where bets settle in WCHZ but wallets hold native CHZ, wrapping is done in-app.

### Platform

- **VIP tiers and rakeback** — 6 tiers, paying a share of house edge (not turnover)
- **Responsible gambling** — deposit/loss/wager limits, session limits, reality checks,
  cool-off and self-exclusion. Tightening applies immediately; loosening waits 24 hours;
  self-exclusion cannot be lifted early
- **KYC tiers and jurisdiction gating** — policy layer; verification is the provider's job

---

## Networks

| Network | Chain ID | Gas | Bet token | Status |
| --- | --- | --- | --- | --- |
| Polygon | 137 | POL | USDT | mainnet |
| Chiliz | 88 | CHZ | WCHZ | mainnet |
| Base | 8453 | ETH | WETH | mainnet |
| Polygon Amoy | 80002 | POL | USDT | testnet |
| Chiliz Spicy | 88882 | CHZ | WCHZ | testnet |

Testnets appear only when `NEXT_PUBLIC_SHOW_TESTNETS=true`.

---

## Setup

```bash
npm install          # workspaces: contracts + frontend
```

### Contracts

```bash
cd contracts
cp env.template .env          # PRIVATE_KEY, RPCs, explorer keys
npm run compile
npm test                      # 25 tests

npm run deploy                # prediction market (first deploy)
npm run upgrade-v5            # or upgrade an existing V4 proxy
npm run deploy:rugrush        # crash game + seeds the bankroll
```

Deploy to a specific network with `--network polygon|chiliz|spicy|base|amoy`.

The crash game needs a round operator running — the contract cannot drive itself:

```bash
npm run rugrush:operate -- --network chiliz
```

It commits a seed, opens betting, starts the curve, and reveals. Unrevealed seeds live in
`deployments/rugrush-seeds.json` — **treat that file as a secret**; it is gitignored. If it
is lost, affected rounds can be voided by anyone and every stake refunds in full.

### Frontend

```bash
cd frontend
cp env.template .env.local
npm run dev
```

Set at minimum:

- `NEXT_PUBLIC_CONTRACT_ADDRESS` — the prediction market proxy
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_AFFILIATE_ADDRESS` — **your** wallet, or Azuro's GGR goes nowhere
- `NEXT_PUBLIC_RUGRUSH_ADDRESS` — after deploying the crash game
- Ramp provider keys, if you want fiat rails

---

## Layout

```
contracts/
  contracts/
    BigMarketV1..V4.sol       history; V4 is the previous live implementation
    BigMarketV5.sol           current — refunds, disputes, early exit, creator fees
    RugRush.sol               provably-fair crash
  scripts/                    deploy, upgrade, ABI copy, round operator
  test/                       25 tests, incl. Solidity <-> TS fairness parity

frontend/
  lib/azuro/                  protocol client: config, feed, odds, bet, cashout, freebet, socket
  lib/games/crash/            fairness, token generator, round engine
  lib/ramp/                   on/off-ramp providers + server-side store seam
  lib/platform/               VIP, responsible gambling, KYC
  lib/betslip.tsx             betslip state, singles and combos
  hooks/                      useAzuro, useRugRush, useResponsibleGambling
  app/
    sports/, game/[gameId]/   the book
    casino/crash/             RugRush
    wallet/                   fiat in/out, wrap/unwrap
    account/vip, account/responsible
    fairness/                 independent round verifier
    api/ramp/                 session creation + signed webhooks
```

---

## A note on verification

The contracts are tested and both apps build. But `api.onchainfeed.org` and
`gem.azuro.org` are unreachable from the environment this was built in, so **no call has
been made against a live Azuro endpoint**. The client was written from
`Azuro-protocol/toolkit@6.4.0` source — endpoint paths, request bodies and EIP-712 types
transcribed directly — but response shapes have not been observed against the running API.
Expect to shake out field-level mismatches on first connection.

## License

MIT
