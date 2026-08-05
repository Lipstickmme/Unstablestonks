# BIG — gap analysis and build-out

What BIG was missing measured against two references: the **Azuro Protocol v3** stack
(`gem.azuro.org`, `github.com/Azuro-protocol`) and the feature set a **stake.com-class**
operator is expected to ship. Then what this change set closes, and what it does not.

## Sources

Read directly from the protocol's own repositories rather than the rendered docs
(`gem.azuro.org` is blocked by this environment's egress policy):

| Repo | What it gave |
| --- | --- |
| `Azuro-protocol/gem-docs` | the docs site source — API reference, guides, live-betting tutorial |
| `Azuro-protocol/toolkit` | v6.4.0 — chain config, contract addresses, endpoint paths, EIP-712 shapes |
| `Azuro-protocol/dictionaries` | the 128-sport catalogue, 41 markets, 83 selections, 17,348 outcomes |
| `Azuro-protocol/Azuro-v2-public` | Solidity interfaces |
| `Azuro-protocol/public-config`, `sdk`, `example-app` | reference wiring |

---

## 1. Where BIG started

A single parimutuel prediction-market contract on Polygon Amoy plus a Next.js front end.
Roughly 4,000 lines. Concretely:

- One `BigMarketV4` UUPS proxy. Native-token stakes, pooled per outcome, 2% platform fee.
- Create / bet / resolve / claim, an owner-managed creator whitelist, referral counters.
- Categories including a `Sports` string — but **no sports feed of any kind**. Nothing
  fetched fixtures, nothing quoted odds. The sportsbook was a link to an external site.

So the honest starting position is not "football-only": it is **no book at all**, and a
prediction market that could strand user funds. Both are addressed below.

---

## 2. Gaps against Azuro Protocol v3

### 2.1 No protocol integration — CLOSED

Nothing in the repo spoke to Azuro. The whole client is new (`frontend/lib/azuro/`):

| Area | What was missing | Now |
| --- | --- | --- |
| Feed | no games, leagues, or fixtures | `feed.ts` — navigation, sport tree, games-by-filter, search, conditions |
| Odds | none; parimutuel pools only | `odds.ts` — 1e12 fixed-point, decimal/American/fractional, margin |
| Bet placement | n/a | `bet.ts` — EIP-712 `ClientBetData`, relayer order submission, status collapse |
| Combos | n/a | `createComboBet` + `ClientComboBetData`, with the 0.99-per-leg fee modifier |
| Live betting | n/a | `socket.ts` — WebSocket condition/game subscriptions with re-subscribe on reconnect |
| Cashout | n/a | `cashout.ts` — availability, quote, `CashOutOrder` signing, submission |
| Freebets | n/a | `freebet.ts` — bonus fetch plus client-side restriction checks |
| Slippage | n/a | `calcMinOdds` — signs a floor price so relay-time drift cannot fill worse |
| Affiliate | n/a | affiliate address signed into every bet's `clientData` (GGR accrues to the operator) |

**Architecture note.** v3 bets are not transactions. The bettor signs typed data, Azuro's
relayer submits it, and the relayer's fee is taken **in the bet token** — so the ERC-20
approval must cover `stake + relayerFee`, to the **Relayer** contract, not Core. The
betslip does this and shows the fee before asking for a signature.

### 2.2 Sport coverage — CLOSED

Azuro already solves "more than football", and the solution is its dictionaries: the feed
is keyed by sport id, and there are **128 of them** — 66 traditional sports plus 62
esports titles. Nothing needed inventing.

`lib/azuro/sports.ts` is generated from `dictionaries/sports.json` (regenerate with
`npm run gen:sports`). The navigation renders whatever the feed reports as having open
markets, split across Azuro's two hubs (`sports` / `esports`), with live counts. **No code
path special-cases a sport.** Adding coverage is Azuro listing a sport, not a change here.

That spans football, basketball, tennis, cricket, MMA, boxing, F1, horse racing, darts,
snooker, table tennis, volleyball, handball, baseball, ice hockey, all four rugby codes,
chess, politics — and CS:GO, Dota 2, League of Legends, Valorant, Rocket League and the
rest.

### 2.3 Still open

- **Wave / Azuro Score.** The loyalty programme endpoints (`/waves/*`) are unused. Worth
  adding if the operator joins the programme.
- **v2 legacy subgraph.** Only the v3 REST + bets subgraph is wired. Historical v2 bets
  would need the legacy live feed.
- **Social login / account abstraction.** `sdk-social-aa-connector` exists upstream; this
  build stays wallet-first.
- **Predefined combos.** `getPredefinedCombo` is implemented in `feed.ts` but not surfaced
  in the UI yet.

---

## 3. Gaps against stake.com-class operations

| Capability | Before | Now |
| --- | --- | --- |
| Fiat on-ramp | none — user needed POL already | `lib/ramp/` — Transak, MoonPay, Mercuryo |
| Fiat off-ramp | none | same abstraction, `direction: "offramp"` |
| Webhook handling | none | `app/api/ramp/webhook/[provider]` — **signature-verified** per provider |
| Casino games | none | RugRush (below) |
| Provable fairness | none | on-chain commit-reveal + a browser-side verifier at `/fairness` |
| VIP / rakeback | none | `lib/platform/vip.ts` — 6 tiers, rakeback on **GGR**, not turnover |
| Affiliate revenue share | referral counters only | 25% GGR share, plus Azuro affiliate accrual |
| Responsible gambling | **none** | `lib/platform/responsible.ts` + `/account/responsible` |
| KYC / jurisdiction | none | `lib/platform/kyc.ts` — tiered limits, restricted-country gate |
| Multi-chain | Polygon only | Polygon, Chiliz, Base (+ Amoy, Spicy behind a flag) |

Two things worth calling out because they are easy to get wrong:

**Responsible gambling is not decoration.** Tightening a limit applies immediately;
loosening one waits 24 hours. Self-exclusion has **no code path in the module that lifts
it early** — that is the point. It is currently keyed to a wallet address in
`localStorage`, which is a genuinely weak binding (a new wallet is a new profile). The page
says so, and `setResponsibleGamblingStore()` is the seam for a server-side store. **A
licensed deployment must use it.**

**Rakeback pays a share of house edge, not turnover.** At a 2% margin, paying a share of
turnover would hand back more than the book earns.

---

## 4. Gaps in the prediction market itself

Reading `BigMarketV4` against its own claims turned up three ways user funds could be
stranded. All three are fixed in `BigMarketV5`, which is storage-append-only on V4 and
covered by tests.

### 4.1 Nobody backed the winning outcome — funds permanently stranded

V4's `claimPayout`:

```solidity
if (eventData.totalPool > 0 && winningBet > 0) {
    uint256 winningPool = eventData.pools[eventData.winningOutcome];
    require(winningPool > 0, "No bets on winning outcome");
    payout = (eventData.totalPool * winningBet) / winningPool;
}
claimed[eventId][msg.sender] = true;
```

If the winning outcome has **no** backers, every caller has `winningBet == 0`, skips the
branch, gets marked `claimed`, and receives nothing. The entire pool sits in the contract
with no function that can ever release it. Not a griefing edge case — a three-way market
where the underdog wins does it.

**V5:** `_applyResolution` detects an empty winning pool at settlement and converts the
event to cancelled, making every stake refundable.

### 4.2 No cancellation path

V4 had no way to abandon an unresolvable market. An ambiguous question or an abandoned
match locked its pool forever.

**V5:** `cancelEvent(eventId, reason)` + `claimRefund(eventId)`.

### 4.3 Resolution was instant, unilateral, and final

`resolveEvent` was one owner call and payouts opened immediately. No window, no recourse.

**V5:** `proposeResolution` → dispute window (default 6h) → `finalizeResolution`, which is
**permissionless** so payouts do not depend on the operator returning. Inside the window
anyone can bond a challenge (`disputeResolution`); a failed challenge forfeits the bond,
a successful one refunds it. Resolver is now a role distinct from admin.

### 4.4 Also added

- **Early exit** (`sellPosition`) — withdraw at cost minus a 5% fee before the close.
  Deliberately *not* framed as a priced buy-back: a parimutuel pool has no price until it
  closes. Exits shut 10 minutes before the end time, where late information would
  otherwise let sharp money pick off the remaining pool.
- **Creator fees** — a quarter of the platform fee, taken **out of the fee**, not out of
  the bettor's stake.
- **Batch claims** — `claimPayoutBatch` skips unclaimable entries instead of reverting.
- **`previewPayout`** — what a position is worth before claiming.

---

## 5. RugRush — the crash game

A crash game where **each round is a simulated token launch**: the curve is the token's
market cap going parabolic, the crash is the rug.

**Fairness.** The operator commits `keccak256(serverSeed)` before betting opens and reveals
the seed afterwards. The rug is `keccak256(serverSeed, clientSeed, roundId)` mapped onto a
1/x distribution, with a 1-in-101 instant rug as the house edge (~0.99%). The identical
derivation ships in Solidity (`RugRush.rugMultiplier`) and TypeScript
(`lib/games/crash/fairness.ts`), and a test asserts they agree bit-for-bit across the curve
and the rug.

**The twist, and its honesty constraint.** Each round's token — name, ticker, supply,
badges like `LP LOCKED` or `DEV HOLDS 12%`, and the launch events that scroll past the
chart — is derived from the **public commit hash**, never from the secret seed. That
separation is load-bearing, not bookkeeping: the rug comes from a seed that cannot be
derived from its own hash, so **no badge or event carries information about when the rug
lands.** A token marked `LP LOCKED` is no safer than one marked `BUNDLED`. The UI says so
under the chart. Getting this backwards would make the game's flavour a lie about its odds.

**Trust model, stated plainly in the contract:**

- The operator **cannot** change the rug after committing — the reveal is hash-checked.
- The operator **can** refuse to reveal. Past `revealDeadline` anyone voids the round and
  every stake refunds in full.
- Sell price comes from block time, so a sell cannot be repriced after the fact — but
  block granularity means a congested chain can fill a sell lower than the number on
  screen. That is a real risk and the UI must not hide it.
- Max win is `min(maxPayout, 20% of bankroll)`, snapshotted per position at buy-in so a
  later winner cannot shrink an earlier one's payout.

---

## 6. Chiliz

Azuro's own toolkit marks Chiliz deprecated. The contracts are deployed and the feed still
answers for `ChilizWCHZ`, so it is kept as a first-class network here rather than dropped:

- Chiliz (88) and Spicy (88882) in the chain registry with their Azuro v3 addresses.
- Bets settle in **WCHZ**, but wallets hold native CHZ — so the wallet page wraps and
  unwraps 1:1 in-app instead of sending users to a DEX.
- Hardhat networks + ChilizScan (Blockscout) verification config.
- `NEXT_PUBLIC_DEFAULT_CHAIN=chiliz` opens the app on Chiliz.

---

## 7. What was and was not verified

**Verified here:**

- 25 contract tests pass (`npm test` in `contracts/`), including Solidity↔TypeScript
  parity for the crash curve and rug derivation, and each stranded-funds fix.
- `tsc --noEmit` clean; `next build` succeeds across all 15 routes.

**Not verified here — and worth saying plainly:** `api.onchainfeed.org`,
`thegraph.onchainfeed.org` and `gem.azuro.org` are all blocked by this environment's egress
policy, so **no call was made against a live Azuro endpoint.** The client is written from
the toolkit's own source — endpoint paths, request bodies, and EIP-712 type definitions
were transcribed from `Azuro-protocol/toolkit@6.4.0` — but response shapes have not been
observed against the running API. Expect to shake out field-level mismatches on first
connection.

Likewise no contract is deployed and no ramp provider key is configured; providers without
keys are hidden rather than shown broken.

## 8. Known-open items

- Server-side responsible-gambling and KYC stores (currently client-side).
- Durable ramp transaction store — `lib/ramp/store.server.ts` ships an explicitly
  non-durable in-memory default.
- Wave / Azuro Score integration.
- ERC-20 stakes for the prediction market (V5 is still native-token).
- A second casino game to justify the `/casino` namespace.
